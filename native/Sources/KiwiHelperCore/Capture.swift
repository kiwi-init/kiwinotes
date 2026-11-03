import AVFoundation
import Foundation

public enum AudioCaptureError: Error, CustomStringConvertible {
    case noInputDevice

    public var description: String {
        switch self {
        case .noInputDevice: return "no_input_device"
        }
    }
}

/// What `AudioCapture` needs from the audio engine: `AVAudioEngine` in the helper, a fake in the tests (no mic, T590).
public protocol MicEngine: AnyObject {
    /// Installs the tap and prepares the engine, without starting the device (no mic indicator). Called once per
    /// engine. The tap hands over buffers in whatever format the device has.
    func prepare(onBuffer: @escaping (AVAudioPCMBuffer) -> Void) throws
    func start() throws
    /// Stops the device and prepares again, so the next `start` is quick.
    func stop()
    /// The engine is being replaced: stop, remove the tap and stop reporting changes. It isn't used again.
    func discard()
    /// The engine's configuration changed (another input device, another format). Main thread.
    var onConfigurationChange: (() -> Void)? { get set }
}

/// Any input format → 16 kHz mono Float32 (what Parakeet takes). The converter follows the buffers' format: a converter
/// built for the old device fails every buffer of the new one (OSStatus -1, e.g. 48 kHz built-in mic → 16 kHz Bluetooth
/// HFP), and that failure was dropped in silence, which is how the mic went dead without an error in #589 (T590).
public final class Resampler {
    public let target: AVAudioFormat
    private var converter: AVAudioConverter?

    public init(sampleRate: Double = 16_000) {
        target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false)!
    }

    public func reset() {
        converter?.reset()
    }

    /// The buffer at the target format, or nil if it can't be converted.
    public func convert(_ buffer: AVAudioPCMBuffer) -> [Float]? {
        if converter.map({ $0.inputFormat != buffer.format }) ?? true {
            converter = AVAudioConverter(from: buffer.format, to: target)
        }
        guard let converter, buffer.format.sampleRate > 0 else { return nil }
        let ratio = target.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 64
        guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return nil }
        // The converter asks for `want` frames at a time and ignores what comes past that: handing it the whole buffer
        // lost 1.6% of a 100 ms stereo 48 kHz buffer and 15% of a 1 s one. So it gets slices of what it asks for.
        var offset: AVAudioFrameCount = 0
        var error: NSError?
        converter.convert(to: out, error: &error) { want, status in
            let n = min(want, buffer.frameLength - offset)
            guard n > 0, let slice = Self.slice(buffer, from: offset, count: n) else {
                status.pointee = .noDataNow
                return nil
            }
            offset += n
            status.pointee = .haveData
            return slice
        }
        guard error == nil, let channel = out.floatChannelData?[0] else { return nil }
        return Array(UnsafeBufferPointer(start: channel, count: Int(out.frameLength)))
    }

    private static func slice(_ buffer: AVAudioPCMBuffer, from offset: AVAudioFrameCount, count: AVAudioFrameCount) -> AVAudioPCMBuffer? {
        if offset == 0, count == buffer.frameLength { return buffer }
        guard let slice = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: count) else { return nil }
        slice.frameLength = count
        let bytesPerFrame = Int(buffer.format.streamDescription.pointee.mBytesPerFrame)
        let to = slice.mutableAudioBufferList
        // Non-interleaved: one AudioBuffer per channel; interleaved: one with all of them.
        let src = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: buffer.audioBufferList))
        let dst = UnsafeMutableAudioBufferListPointer(to)
        for (s, d) in zip(src, dst) {
            guard let sData = s.mData, let dData = d.mData else { return nil }
            memcpy(dData, sData + Int(offset) * bytesPerFrame, Int(count) * bytesPerFrame)
        }
        return slice
    }
}

/// Notices a recording that stopped getting audio: the engine can die without an error or a notification when the
/// input changes (#589: no levels from 229.6 s on; the next recording "started" and got 0 samples).
public struct CaptureWatchdog: Sendable {
    /// Time for the first buffer after the engine starts (Bluetooth takes a moment to come up).
    public var firstBuffer: TimeInterval
    /// The longest gap between buffers (they come every ~20–100 ms).
    public var gap: TimeInterval
    private var since: TimeInterval?
    private var gotBuffer = false

    public init(firstBuffer: TimeInterval = 1.5, gap: TimeInterval = 1.0) {
        self.firstBuffer = firstBuffer
        self.gap = gap
    }

    /// The engine (re)started.
    public mutating func start(at t: TimeInterval) {
        since = t
        gotBuffer = false
    }

    public mutating func buffer(at t: TimeInterval) {
        since = t
        gotBuffer = true
    }

    public mutating func stop() {
        since = nil
    }

    /// A buffer came since the last `start(at:)`.
    public var hasAudio: Bool { gotBuffer }

    public func stalled(at now: TimeInterval) -> Bool {
        guard let since else { return false }
        return now - since > (gotBuffer ? gap : firstBuffer)
    }
}

/// Microphone → 16 kHz mono Float32, plus a throttled level for the waveform.
///
/// When the input changes (a Bluetooth headset connects, the person picks another mic) the engine is thrown away and
/// a new one is made: a fresh engine reads the new device's format, while the old one keeps a stale tap. Mid-recording
/// the new engine starts right away and what was captured is kept. If no audio comes for a while, the engine is
/// replaced; if the new one gives nothing either, the recording ends with `no_audio` (T590). A stall after audio came
/// back is a new one and gets its own new engine (T883).
///
/// Everything here runs on the main thread, except the buffers, which come on the engine's thread.
public final class AudioCapture {
    public static let sampleRate: Double = 16_000

    /// Levels per second for the waveform.
    public static let levelRate: Double = 30

    /// Called on a private queue, at a steady ~30 Hz while recording.
    public var onLevel: ((Float) -> Void)?

    /// The recording ended because the mic went away: `device_changed` (the new device didn't start) or `no_audio`
    /// (no buffer even after a new engine), with what was captured until then, to transcribe like a normal end
    /// (T883: losing a dictation is worse than a short text). Empty under `keptOnLoss` samples. Main thread.
    public var onLost: ((_ code: String, _ samples: [Float]) -> Void)?

    /// The least audio worth transcribing when the mic goes away: 0.3 s. Less than that is no dictation.
    public static let keptOnLoss = 4_800

    /// What happened to the engine, for the app's log (no audio in it). Main thread.
    public var onLog: ((String) -> Void)?

    /// Whether touching the input is allowed now: before the mic is granted it can bring up the system prompt.
    public var mayWarmUp: () -> Bool = { true }

    public private(set) var isRecording = false

    private let makeEngine: () -> MicEngine
    private let now: () -> TimeInterval
    private let watchdogInterval: TimeInterval?
    private var engine: MicEngine
    private var prepared = false
    /// New engines the watchdog made in a row without audio in between: one, then `no_audio`. Back to 0 once audio
    /// comes again, so a later, unrelated stall gets its own new engine (T883).
    private var stallRestarts = 0
    private var meter = LevelMeter(sampleRate: sampleRate, rate: levelRate)
    // The tap hands over ~20–100 ms at a time; the pacer spreads those levels over a 30 Hz tick.
    private let levelQueue = DispatchQueue(label: "kiwi.audio.level")
    private var pacer = LevelPacer()
    private var levelTimer: DispatchSourceTimer?
    private var watchdogTimer: DispatchSourceTimer?
    // Guarded by `samplesQueue`: the buffers come on the engine's thread.
    private let samplesQueue = DispatchQueue(label: "kiwi.audio.samples")
    private let resampler = Resampler(sampleRate: sampleRate)
    private var samples: [Float] = []
    private var capturing = false
    private var watchdog = CaptureWatchdog()
    /// Bumped when the engine is replaced: a late buffer from the old one (old format) is dropped.
    private var generation = 0

    /// - Parameter watchdogInterval: how often to check for a stall while recording; nil means only `checkStall()`
    ///   (the tests drive it with their own clock).
    public init(
        makeEngine: @escaping () -> MicEngine,
        now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
        watchdog: CaptureWatchdog = CaptureWatchdog(),
        watchdogInterval: TimeInterval? = 0.25
    ) {
        self.makeEngine = makeEngine
        self.now = now
        self.watchdog = watchdog
        self.watchdogInterval = watchdogInterval
        engine = makeEngine()
        observe(engine)
    }

    /// Gets the engine ready ahead of the next recording, so `start` only has to start it (the first syllable is
    /// what's lost while it comes up). Doesn't start the device: no mic indicator.
    public func warmUp() {
        guard !isRecording, mayWarmUp() else { return }
        do {
            try prepareEngine()
        } catch {
            replaceEngine() // `start` tries again and reports the error
        }
    }

    public func start() throws {
        guard !isRecording else { return }
        do {
            try prepareEngine()
        } catch {
            replaceEngine()
            throw error
        }
        meter.reset()
        levelQueue.sync { pacer.reset() }
        samplesQueue.sync {
            resampler.reset()
            samples.removeAll(keepingCapacity: true)
            capturing = true
            watchdog.start(at: now())
        }
        stallRestarts = 0
        do {
            try engine.start()
        } catch {
            samplesQueue.sync {
                capturing = false
                watchdog.stop()
            }
            replaceEngine()
            throw error
        }
        isRecording = true
        startTimers()
    }

    /// Stops and hands back everything recorded since `start`.
    public func stop() -> [Float] {
        guard isRecording else { return [] }
        engine.stop()
        isRecording = false
        stopTimers()
        return samplesQueue.sync {
            capturing = false
            watchdog.stop()
            defer { samples.removeAll() }
            return samples
        }
    }

    /// The input changed: the engine's configuration-change notification, or the default input device changed.
    public func inputChanged(_ why: String) {
        onLog?("input changed (\(why))\(isRecording ? " mid-recording" : ""): new engine")
        replaceEngine()
        guard isRecording else { return warmUp() }
        restartMidRecording(failing: "device_changed")
    }

    /// While recording: no audio for a while means the engine died. Replace it; if the new one gives nothing either,
    /// give up with `no_audio`.
    public func checkStall() {
        guard isRecording else { return }
        let (stalled, hadAudio) = samplesQueue.sync { (watchdog.stalled(at: now()), watchdog.hasAudio) }
        guard stalled else { return }
        // Audio came since the last (re)start: this stall is a new one, not the new engine failing too.
        if hadAudio { stallRestarts = 0 }
        guard stallRestarts == 0 else { return fail("no_audio") }
        stallRestarts += 1
        onLog?("no audio from the mic: new engine")
        replaceEngine()
        restartMidRecording(failing: "no_audio")
    }

    // MARK: Engine

    private func prepareEngine() throws {
        guard !prepared else { return }
        let generation = samplesQueue.sync { self.generation }
        try engine.prepare { [weak self] buffer in self?.process(buffer, generation: generation) }
        prepared = true
    }

    private func replaceEngine() {
        samplesQueue.sync { generation += 1 }
        engine.onConfigurationChange = nil
        engine.discard()
        engine = makeEngine()
        observe(engine)
        prepared = false
    }

    private func observe(_ engine: MicEngine) {
        engine.onConfigurationChange = { [weak self] in self?.inputChanged("engine configuration") }
    }

    /// A new engine mid-recording: keep what was captured and go on with the new device.
    private func restartMidRecording(failing code: String) {
        do {
            try prepareEngine()
            samplesQueue.sync { watchdog.start(at: now()) }
            try engine.start()
        } catch {
            onLog?("the new engine didn't start: \(error)")
            fail(code)
        }
    }

    /// Ends the recording, hands over what was captured (`onLost`), and gets a fresh engine ready for the next one.
    private func fail(_ code: String) {
        engine.stop()
        isRecording = false
        stopTimers()
        let captured = samplesQueue.sync { () -> [Float] in
            capturing = false
            watchdog.stop()
            defer { samples.removeAll() }
            return samples.count >= Self.keptOnLoss ? samples : []
        }
        replaceEngine()
        warmUp()
        onLost?(code, captured)
    }

    // MARK: Buffers

    private func process(_ buffer: AVAudioPCMBuffer, generation: Int) {
        let chunk = samplesQueue.sync { () -> [Float]? in
            guard capturing, generation == self.generation, let out = resampler.convert(buffer) else { return nil }
            watchdog.buffer(at: now())
            samples.append(contentsOf: out)
            return out
        }
        guard let chunk, !chunk.isEmpty else { return }
        // The tap calls back on one thread at a time, and buffers from an old engine stop above, so `meter` needs no lock.
        let levels = meter.push(chunk)
        if !levels.isEmpty { levelQueue.async { self.pacer.push(levels) } }
    }

    private func startTimers() {
        let timer = DispatchSource.makeTimerSource(queue: levelQueue)
        let interval = 1 / Self.levelRate
        timer.schedule(deadline: .now() + interval, repeating: interval, leeway: .milliseconds(2))
        timer.setEventHandler { [weak self] in
            guard let self, let level = self.pacer.next() else { return }
            self.onLevel?(level)
        }
        levelTimer = timer
        timer.resume()

        guard let watchdogInterval else { return }
        let check = DispatchSource.makeTimerSource(queue: .main)
        check.schedule(deadline: .now() + watchdogInterval, repeating: watchdogInterval, leeway: .milliseconds(20))
        check.setEventHandler { [weak self] in self?.checkStall() }
        watchdogTimer = check
        check.resume()
    }

    private func stopTimers() {
        levelTimer?.cancel()
        levelTimer = nil
        watchdogTimer?.cancel()
        watchdogTimer = nil
        levelQueue.sync { pacer.reset() }
    }
}
