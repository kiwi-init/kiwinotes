import AVFoundation
import Foundation
import KiwiHelperCore

enum AudioCaptureError: Error, CustomStringConvertible {
    case noInputDevice
    case converter

    var description: String {
        switch self {
        case .noInputDevice: return "no_input_device"
        case .converter: return "audio_converter"
        }
    }
}

/// Microphone → 16 kHz mono Float32 (what WhisperKit and Parakeet take), plus a throttled level for the waveform.
final class AudioCapture {
    static let sampleRate: Double = 16_000

    /// Levels per second for the waveform.
    static let levelRate: Double = 30

    /// Called on `levelQueue`, at a steady ~30 Hz while recording.
    var onLevel: ((Float) -> Void)?

    /// The input device changed mid-recording (AirPods in or out) and capture could not go on. Main thread.
    var onDeviceLost: ((String) -> Void)?

    private let engine = AVAudioEngine()
    private let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false)!
    private var converter: AVAudioConverter?
    private var meter = LevelMeter(sampleRate: sampleRate, rate: levelRate)
    // The tap hands over ~100 ms at a time; the pacer spreads those levels over a 30 Hz tick.
    private let levelQueue = DispatchQueue(label: "kiwi.audio.level")
    private var pacer = LevelPacer()
    private var levelTimer: DispatchSourceTimer?
    private let samplesQueue = DispatchQueue(label: "kiwi.audio.samples")
    private var samples: [Float] = []
    /// Guarded by `samplesQueue`: buffers that arrive while not capturing are dropped.
    private var capturing = false
    private var tapInstalled = false
    private var configObserver: NSObjectProtocol?
    private(set) var isRecording = false

    init() {
        configObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main
        ) { [weak self] _ in self?.configurationChanged() }
    }

    deinit {
        if let configObserver { NotificationCenter.default.removeObserver(configObserver) }
    }

    /// Gets the tap and the engine ready ahead of the next recording, so `start` only has to start the engine
    /// (the first syllable is what's lost while it comes up). Doesn't start the device: no mic indicator.
    /// Call only with the mic granted; touching the input node earlier can bring up the system prompt.
    func warmUp() {
        guard !isRecording else { return }
        do {
            try installTapIfNeeded()
            engine.prepare()
        } catch {
            removeTap() // `start` tries again and reports the error
        }
    }

    func start() throws {
        guard !isRecording else { return }
        try installTapIfNeeded()
        samplesQueue.sync { converter?.reset() }
        meter.reset()
        levelQueue.sync { pacer.reset() }
        samplesQueue.sync {
            samples.removeAll(keepingCapacity: true)
            capturing = true
        }
        do {
            try engine.start()
        } catch {
            samplesQueue.sync { capturing = false }
            removeTap()
            throw error
        }
        isRecording = true
        startLevelTimer()
    }

    /// Stops and hands back everything recorded since `start`. The tap stays, so the next `start` is quick.
    func stop() -> [Float] {
        guard isRecording else { return [] }
        engine.stop()
        isRecording = false
        levelTimer?.cancel()
        levelTimer = nil
        levelQueue.sync { pacer.reset() }
        let out = samplesQueue.sync {
            capturing = false
            let out = samples
            samples.removeAll()
            return out
        }
        engine.prepare()
        return out
    }

    private func installTapIfNeeded() throws {
        guard !tapInstalled else { return }
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw AudioCaptureError.noInputDevice }
        guard let converter = AVAudioConverter(from: format, to: target) else { throw AudioCaptureError.converter }
        // The tap thread reads it under the same queue, so a device change can't swap it mid-buffer.
        samplesQueue.sync { self.converter = converter }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.process(buffer)
        }
        tapInstalled = true
    }

    private func removeTap() {
        guard tapInstalled else { return }
        engine.inputNode.removeTap(onBus: 0)
        tapInstalled = false
    }

    /// macOS stopped the engine because the input device or its format changed. The old tap has the old
    /// format, so rebuild it; mid-recording, start again and keep what was already captured.
    private func configurationChanged() {
        removeTap()
        guard isRecording else { return warmUp() }
        do {
            try installTapIfNeeded()
            try engine.start()
        } catch {
            levelTimer?.cancel()
            levelTimer = nil
            isRecording = false
            samplesQueue.sync {
                capturing = false
                samples.removeAll() // what was captured before the change is discarded with the recording
            }
            onDeviceLost?("device_changed")
        }
    }

    private func process(_ buffer: AVAudioPCMBuffer) {
        guard let converter = samplesQueue.sync(execute: { self.converter }) else { return }
        let ratio = target.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 64
        guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
        var fed = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if fed {
                status.pointee = .noDataNow
                return nil
            }
            fed = true
            status.pointee = .haveData
            return buffer
        }
        guard error == nil, let channel = out.floatChannelData?[0], out.frameLength > 0 else { return }
        let chunk = UnsafeBufferPointer(start: channel, count: Int(out.frameLength))
        let kept = samplesQueue.sync { () -> Bool in
            guard capturing else { return false }
            samples.append(contentsOf: chunk)
            return true
        }
        guard kept else { return }
        // The tap calls back on one thread at a time, so `meter` needs no lock.
        let levels = meter.push(chunk)
        if !levels.isEmpty { levelQueue.async { self.pacer.push(levels) } }
    }

    private func startLevelTimer() {
        let timer = DispatchSource.makeTimerSource(queue: levelQueue)
        let interval = 1 / Self.levelRate
        timer.schedule(deadline: .now() + interval, repeating: interval, leeway: .milliseconds(2))
        timer.setEventHandler { [weak self] in
            guard let self, let level = self.pacer.next() else { return }
            self.onLevel?(level)
        }
        levelTimer = timer
        timer.resume()
    }
}
