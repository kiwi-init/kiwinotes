import AVFoundation

/// An audio file as the mic delivers it: 16 kHz mono Float. For `debug.transcribe` and `--transcribe`.
enum AudioFile {
    enum Failure: Error { case unreadable, conversion }

    static func samples16k(_ url: URL) throws -> [Float] {
        guard let file = try? AVAudioFile(forReading: url) else { throw Failure.unreadable }
        let source = file.processingFormat
        guard let input = AVAudioPCMBuffer(pcmFormat: source, frameCapacity: AVAudioFrameCount(file.length)) else {
            throw Failure.unreadable
        }
        try file.read(into: input)
        guard let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: AudioCapture.sampleRate,
                                         channels: 1, interleaved: false) else { throw Failure.conversion }
        if source.sampleRate == target.sampleRate, source.channelCount == 1, source.commonFormat == .pcmFormatFloat32 {
            return Array(UnsafeBufferPointer(start: input.floatChannelData![0], count: Int(input.frameLength)))
        }
        guard let converter = AVAudioConverter(from: source, to: target) else { throw Failure.conversion }
        let capacity = AVAudioFrameCount(Double(input.frameLength) * target.sampleRate / source.sampleRate) + 1024
        guard let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { throw Failure.conversion }
        var fed = false
        var error: NSError?
        let status = converter.convert(to: output, error: &error) { _, outStatus in
            if fed { outStatus.pointee = .endOfStream; return nil }
            fed = true
            outStatus.pointee = .haveData
            return input
        }
        guard status != .error, error == nil else { throw Failure.conversion }
        return Array(UnsafeBufferPointer(start: output.floatChannelData![0], count: Int(output.frameLength)))
    }
}
