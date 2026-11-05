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
    /// Time for the first buffer of an engine made because the input changed: a headset that just switched to HFP
    /// can take ~2.5 s to hand over audio, and 1.5 s showed "Sem áudio do microfone" right after connecting (T1248).
    /// Only that first start gets it, so a mic that dies in the normal case is still caught in 1.5 s.
    public var firstBufferAfterChange: TimeInterval
    /// The longest gap between buffers (they come every ~20–100 ms).
    public var gap: TimeInterval
    private var since: TimeInterval?
    private var gotBuffer = false
    private var allowance: TimeInterval

    public init(firstBuffer: TimeInterval = 1.5, firstBufferAfterChange: TimeInterval = 3.5, gap: TimeInterval = 1.0) {
        self.firstBuffer = firstBuffer
        self.firstBufferAfterChange = firstBufferAfterChange
        self.gap = gap
        allowance = firstBuffer
    }

    /// The engine (re)started; `afterInputChange` when it's the first start of an engine made for a new input.
    public mutating func start(at t: TimeInterval, afterInputChange: Bool = false) {
        since = t
        gotBuffer = false
        allowance = afterInputChange ? max(firstBuffer, firstBufferAfterChange) : firstBuffer
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
        return now - since > (gotBuffer ? gap : allowance)
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
/// Input changes come in bursts: connecting a Bluetooth headset switches its profile (A2DP → HFP), and the default
/// input and the engine's configuration can each change two or more times in a row. So a change only makes a new
/// engine once no other came for `inputSettle` seconds: one engine for the whole burst, not one per change (T1248).
///
/// Everything here runs on the main thread, except the buffers, which come on the engine's thread.
public final class AudioCapture {
    public static let sampleRate: Double = 16_000

    /// Levels per second for the waveform.
    public static let levelRate: Double = 30

    /// Called on a private queue, at a steady ~30 Hz while recording.
    public var onLevel: ((Float) -> Void)?

    /// Streaming consumer (meetings). Called on the engine thread with the packet's start on the uptime clock.
    /// Set before starting. With `retainSamples: false`, a long meeting never accumulates in RAM.
    public var onSamples: (([Float], TimeInterval) -> Void)?
    private let retainSamples: Bool

    /// The recording ended because the mic went away: `device_changed` (the new device didn't start) or `no_audio`
    /// (no buffer even after a new engine), with what was captured until then, to transcribe like a normal end
    /// (T883: losing a dictation is worse than a short text). Empty under `keptOnLoss` samples. Main thread.
    public var onLost: ((_ code: String, _ samples: [Float]) -> Void)?

    /// The least audio worth transcribing when the mic goes away: 0.3 s. Less than that is no dictation.
    public static let keptOnLoss = 4_800

    /// What happened to the engine, for the app's log (no audio in it). Main thread.
    public var onLog: ((String) -> Void)?
    /// How long after `start` the first audio arrived: speech before it is lost, and a short dictation that loses
    /// its first syllable comes out wrong (T985). Called once per recording, on the engine's thread.
    public var onFirstBuffer: ((_ afterStart: TimeInterval) -> Void)?

    /// Whether touching the input is allowed now: before the mic is granted it can bring up the system prompt.
    public var mayWarmUp: () -> Bool = { true }

    public private(set) var isRecording = false

    /// How long the input has to stay put before a change makes a new engine (T1248). Changes in a burst come within
    /// a few hundred ms of each other; much longer and a switch mid-recording loses more of what's said.
    public static let inputSettle: TimeInterval = 0.4

    private let makeEngine: () -> MicEngine
    private let now: () -> TimeInterval
    private let after: (TimeInterval, @escaping () -> Void) -> Void
    private let watchdogInterval: TimeInterval?
    /// Bumped by every input change: only the last one of a burst, once it settles, makes the new engine.
    private var inputChanges = 0
    /// Input changes waiting to settle, with why, for the log.
    private var pendingChanges: [String] = []
    /// The engine was made because the input changed and hasn't started yet: its first buffer gets more time.
    private var engineFromInputChange = false
    private var engine: MicEngine
    private var prepared = false
    /// New engines the watchdog made in a row without audio in between: one, then `no_audio`. Back to 0 once audio
    /// comes again, so a later, unrelated stall gets its own new engine (T883).
    ///
    /// Why one: a fresh engine reads the device from scratch, which is what fixes a stale one (#589). If the fresh
    /// one gives nothing either, the device itself is gone, and each further try is another 1.5 s of the person
    /// talking into nothing before the recording ends anyway. So the second stall in a row ends it with `no_audio`
    /// and hands over what was captured. Don't count stalls across audio again: T883 made a later stall start over.
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
    /// When `start` was called, until the first buffer of the recording arrives (`onFirstBuffer`).
    private var waitingFirstBufferSince: TimeInterval?
    private var watchdog = CaptureWatchdog()
    /// Bumped when the engine is replaced: a late buffer from the old one (old format) is dropped.
    private var generation = 0

    /// - Parameters:
    ///   - watchdogInterval: how often to check for a stall while recording; nil means only `checkStall()`
    ///     (the tests drive it with their own clock).
    ///   - after: runs the closure on the main thread after that many seconds (the tests run it on their clock).
    public init(
        makeEngine: @escaping () -> MicEngine,
        now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
        after: @escaping (TimeInterval, @escaping () -> Void) -> Void = { delay, work in
            DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
        },
        watchdog: CaptureWatchdog = CaptureWatchdog(),
        watchdogInterval: TimeInterval? = 0.25,
        retainSamples: Bool = true
    ) {
        self.makeEngine = makeEngine
        self.retainSamples = retainSamples
        self.now = now
        self.after = after
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
        // The input just changed and hasn't settled: the engine we have is for the old one. Make the new one now.
        if !pendingChanges.isEmpty { applyInputChange() }
        let afterInputChange = engineFromInputChange
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
            waitingFirstBufferSince = now()
            watchdog.start(at: now(), afterInputChange: afterInputChange)
        }
        engineFromInputChange = false
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
    /// The new engine comes once the input settles (`inputSettle`), one for a burst of changes.
    public func inputChanged(_ why: String) {
        inputChanges += 1
        pendingChanges.append(why)
        let change = inputChanges
        after(Self.inputSettle) { [weak self] in
            guard let self, change == self.inputChanges, !self.pendingChanges.isEmpty else { return }
            self.applyInputChange()
        }
    }

    private func applyInputChange() {
        let whys = pendingChanges
        pendingChanges.removeAll()
        inputChanges += 1 // a change still waiting to settle has nothing left to do
        let what = whys.count == 1 ? whys[0] : "\(whys.count) changes: \(whys.joined(separator: ", "))"
        onLog?("input changed (\(what))\(isRecording ? " mid-recording" : ""): new engine")
        replaceEngine()
        engineFromInputChange = true
        guard isRecording else { return warmUp() }
        restartMidRecording(failing: "device_changed")
    }

    /// While recording: no audio for a while means the engine died. Replace it; if the new one gives nothing either,
    /// give up with `no_audio`.
    public func checkStall() {
        // A new engine is on its way for the new input: the old one going quiet meanwhile is expected.
        guard isRecording, pendingChanges.isEmpty else { return }
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
        let afterInputChange = engineFromInputChange
        engineFromInputChange = false
        do {
            try prepareEngine()
            samplesQueue.sync { watchdog.start(at: now(), afterInputChange: afterInputChange) }
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
        var firstAfter: TimeInterval?
        let chunk = samplesQueue.sync { () -> [Float]? in
            guard capturing, generation == self.generation, let out = resampler.convert(buffer) else { return nil }
            let t = now()
            watchdog.buffer(at: t)
            if let since = waitingFirstBufferSince {
                // The buffer covers the time before it was handed over: its start is the first sound kept.
                firstAfter = max(0, t - since - Double(buffer.frameLength) / buffer.format.sampleRate)
                waitingFirstBufferSince = nil
            }
            if retainSamples { samples.append(contentsOf: out) }
            return out
        }
        if let firstAfter { onFirstBuffer?(firstAfter) }
        guard let chunk, !chunk.isEmpty else { return }
        onSamples?(chunk, now() - Double(chunk.count) / Self.sampleRate)
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
