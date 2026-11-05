// A fala da reunião sintética (T4926), em arquivo e sem tocar som: `AVSpeechSynthesizer.write` entrega os buffers,
// que viram WAV 16 kHz mono 16-bit. O `say` só alcança as vozes "novelty" (Eddy, Flo…), que em PT saem robóticas demais
// para o ASR; por aqui dá para usar a Siri natural (Sandra), a Luciana e a Joana, e variar o tom.
//
// Entrada (stdin): um JSON `[{"voice": "<identificador>", "pitch": 1.0, "rate": 0.5, "text": "…", "out": "<arquivo.wav>"}]`.
// Compilar: swiftc -O tts.swift -o audio/tts
import AVFoundation
import Foundation

struct Job: Decodable { let voice: String; let pitch: Float; let rate: Float; let text: String; let out: String }

let jobs = try JSONDecoder().decode([Job].self, from: FileHandle.standardInput.readDataToEndOfFile())
let synth = AVSpeechSynthesizer()
let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: true)!

for job in jobs {
    // Procura na lista: o `init(identifier:)` às vezes devolve nil para a Siri natural antes de a lista carregar.
    guard let voice = AVSpeechSynthesisVoice.speechVoices().first(where: { $0.identifier == job.voice })
        ?? AVSpeechSynthesisVoice(identifier: job.voice) else {
        FileHandle.standardError.write(Data("voz não encontrada: \(job.voice)\n".utf8))
        exit(1)
    }
    let utterance = AVSpeechUtterance(string: job.text)
    utterance.voice = voice
    utterance.pitchMultiplier = job.pitch
    utterance.rate = job.rate
    var file: AVAudioFile?
    var converter: AVAudioConverter?
    var finished = false
    synth.write(utterance) { buffer in
        guard let pcm = buffer as? AVAudioPCMBuffer else { return }
        if pcm.frameLength == 0 { finished = true; return }
        if converter == nil {
            converter = AVAudioConverter(from: pcm.format, to: target)
            file = try? AVAudioFile(forWriting: URL(fileURLWithPath: job.out), settings: target.settings,
                                    commonFormat: .pcmFormatInt16, interleaved: true)
        }
        let capacity = AVAudioFrameCount(Double(pcm.frameLength) * 16_000 / pcm.format.sampleRate) + 64
        guard let converter, let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
        var fed = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true
            status.pointee = .haveData
            return pcm
        }
        try? file?.write(from: out)
    }
    // Os buffers chegam pelo run loop principal: girar até o fim desta fala.
    let deadline = Date().addingTimeInterval(120)
    while !finished && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.02)) }
    guard finished, file != nil else {
        FileHandle.standardError.write(Data("a fala não terminou: \(job.text.prefix(40))\n".utf8))
        exit(1)
    }
}
