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

    /// Called on the audio thread, about 30 times per second.
    var onLevel: ((Float) -> Void)?

    private let engine = AVAudioEngine()
    private let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false)!
    private var converter: AVAudioConverter?
    private var meter = LevelMeter()
    private let samplesQueue = DispatchQueue(label: "kiwi.audio.samples")
    private var samples: [Float] = []
    private(set) var isRecording = false

    func start() throws {
        guard !isRecording else { return }
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw AudioCaptureError.noInputDevice }
        guard let converter = AVAudioConverter(from: format, to: target) else { throw AudioCaptureError.converter }
        self.converter = converter
        meter.reset()
        samplesQueue.sync { samples.removeAll(keepingCapacity: true) }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.process(buffer)
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            throw error
        }
        isRecording = true
    }

    /// Stops and hands back everything recorded since `start`.
    func stop() -> [Float] {
        guard isRecording else { return [] }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        isRecording = false
        return samplesQueue.sync {
            let out = samples
            samples.removeAll()
            return out
        }
    }

    private func process(_ buffer: AVAudioPCMBuffer) {
        guard let converter else { return }
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
        samplesQueue.sync { samples.append(contentsOf: chunk) }
        if let level = meter.push(chunk, at: ProcessInfo.processInfo.systemUptime) {
            onLevel?(level)
        }
    }
}
