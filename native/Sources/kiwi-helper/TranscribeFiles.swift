import AVFoundation
import Foundation
import KiwiHelperCore

/// `kiwi-helper --transcribe <wav>…`: the same transcription as a dictation, on files, one JSON line per file
/// (`transcript.final`'s fields plus `sttMs`). For checking the STT without a microphone or someone speaking.
enum TranscribeFiles {
    static func run(_ paths: [String], dictionaryFile: String?, language: TranscriptionLanguage, vad: Bool,
                    ctc: Bool = false) async -> Int32 {
        let stt = Transcriber(vocabularyBoosting: ctc)
        var dictionary = TranscriptDictionary.empty
        if let dictionaryFile {
            guard let read = readDictionary(dictionaryFile) else { return 2 }
            dictionary = read
        }
        await stt.configure(language: language, dictionary: dictionary, vad: vad)
        let loadStart = ProcessInfo.processInfo.systemUptime
        do {
            try await stt.warmUp()
            if ctc { await stt.waitForBoosting() }
        } catch {
            FileHandle.standardError.write(Data("stt not ready: \(error)\n".utf8))
            return 1
        }
        FileHandle.standardError.write(Data(String(format: "loaded in %.0f ms\n", (ProcessInfo.processInfo.systemUptime - loadStart) * 1000).utf8))
        for path in paths {
            do {
                let samples = try readSamples(URL(fileURLWithPath: path))
                let started = ProcessInfo.processInfo.systemUptime
                let output = try await stt.transcribe(samples)
                let line: [String: Any] = [
                    "file": (path as NSString).lastPathComponent,
                    "text": output.text, "raw": output.raw, "lang": output.lang,
                    "durationMs": Int(Double(samples.count) / AudioCapture.sampleRate * 1000),
                    "sttMs": Int((ProcessInfo.processInfo.systemUptime - started) * 1000),
                ]
                let data = try JSONSerialization.data(withJSONObject: line, options: [.sortedKeys, .withoutEscapingSlashes])
                print(String(decoding: data, as: UTF8.self))
            } catch {
                FileHandle.standardError.write(Data("\(path): \(error)\n".utf8))
            }
        }
        return 0
    }

    /// A dictionary file: one term per line, `#` for comments. Nil (and the reason on stderr) when it can't be read.
    static func readDictionary(_ path: String) -> TranscriptDictionary? {
        guard let text = try? String(contentsOfFile: path, encoding: .utf8) else {
            FileHandle.standardError.write(Data("can't read \(path)\n".utf8))
            return nil
        }
        return TranscriptDictionary(text.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && !$0.hasPrefix("#") }.map { DictionaryEntry(term: $0) })
    }

    /// 16 kHz mono, as the mic delivers it.
    private static func readSamples(_ url: URL) throws -> [Float] {
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat
        guard format.sampleRate == AudioCapture.sampleRate, format.channelCount == 1,
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(file.length)) else {
            throw NSError(domain: "kiwi", code: 1, userInfo: [NSLocalizedDescriptionKey: "needs 16 kHz mono"])
        }
        try file.read(into: buffer)
        return Array(UnsafeBufferPointer(start: buffer.floatChannelData![0], count: Int(buffer.frameLength)))
    }
}
