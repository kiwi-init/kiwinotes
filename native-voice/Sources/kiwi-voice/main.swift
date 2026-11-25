// O processo da voz do gato (ADR 0014, T26732): o Qwen3-TTS do `mlx-audio-swift` atrás do protocolo do KiwiVoiceCore.
// Quem sobe e derruba é o app (app/src/bun/voice-process.ts): ele abre na 1ª fala e sai depois de um tempo parado, para
// soltar os ~4 GB do modelo. Nada aqui toca áudio: o PCM vai ao app pelo stdout.

import Foundation
import KiwiVoiceCore
import MLX
import MLXAudioCore
import MLXAudioTTS

/// O stdout é só do protocolo; uma linha por vez, mesmo com a geração e a leitura em tarefas diferentes.
///
/// O `mlx-audio-swift` escreve no stdout com `print` ("Loaded …", "Generated tokenizer.json …"). Num pipe, o stdio
/// guarda isso num buffer e o solta em qualquer ponto, até no meio de uma linha do protocolo. Por isso o protocolo sai
/// por uma cópia do stdout original, e o fd 1 passa a ser o stderr: os `print` da biblioteca vão para o log.
final class Out: @unchecked Sendable {
    private let lock = NSLock()
    private let proto: FileHandle
    init() {
        proto = FileHandle(fileDescriptor: dup(STDOUT_FILENO), closeOnDealloc: true)
        dup2(STDERR_FILENO, STDOUT_FILENO)
    }
    func send(_ e: VoiceEvent) {
        let line = encodeEvent(e) + "\n"
        lock.lock(); defer { lock.unlock() }
        proto.write(Data(line.utf8))
    }
    func log(_ s: String) { FileHandle.standardError.write(Data("[kiwi-voice] \(s)\n".utf8)) }
}

actor Engine {
    let out: Out
    var model: SpeechGenerationModel?
    var refAudio: MaterializedArray?
    var refText = ""
    var language = "portuguese"
    /// As vozes do catálogo já lidas (T27778), pelo caminho do áudio: trocar de voz não relê o arquivo nem o modelo.
    var refs: [String: MaterializedArray] = [:]
    var queue = SpeakQueue()
    var current: (id: String, task: Task<Void, Never>)?

    init(out: Out) { self.out = out }

    func handle(_ cmd: VoiceCommand) async {
        switch cmd {
        case let .load(modelDir, ref, text, lang, cacheMB):
            await load(modelDir: modelDir, ref: ref, text: text, language: lang, cacheMB: cacheMB)
        case let .speak(id, text, voice):
            queue.push(id: id, text: text, voice: voice)
            pump()
        case let .cancel(id):
            if current?.id == id { current?.task.cancel() } // o `cancelled` sai quando a geração para
            else if queue.remove(id: id) { out.send(.cancelled(id: id)) }
        case .warmup:
            queue.push(id: "", text: "Oi.")
            pump()
        case .quit:
            current?.task.cancel()
            exit(0)
        }
    }

    private func load(modelDir: String, ref: String, text: String, language: String, cacheMB: Int) async {
        let t0 = Date()
        // O teto do ADR 0014: sem ele, o cache do MLX leva o pico de ~4,2 GB a 7 GB.
        Memory.cacheLimit = cacheMB * 1024 * 1024
        do {
            let m = try await TTS.loadModel(modelRepo: modelDir)
            let (_, audio) = try loadAudioArray(from: URL(fileURLWithPath: ref), sampleRate: m.sampleRate)
            model = m; refAudio = audio; refText = text; self.language = language
            refs = [ref: audio]
            out.send(.ready(sampleRate: m.sampleRate, loadMs: Int(Date().timeIntervalSince(t0) * 1000)))
        } catch {
            out.send(.error(id: nil, message: "load: \(error)"))
        }
    }

    private func pump() {
        guard current == nil, let next = queue.next() else { return }
        guard let model, let refAudio else {
            if !next.id.isEmpty { out.send(.error(id: next.id, message: "not loaded")) }
            return pump()
        }
        // A voz da frase (T27778): a do `speak`, lida uma vez por arquivo; sem ela, a do `load`. Um áudio que não abre é o
        // erro só desta frase.
        var (vAudio, vText, vLanguage): (MaterializedArray, String, String) = (refAudio, self.refText, self.language)
        if let v = next.voice {
            if let cached = refs[v.refAudio] { vAudio = cached }
            else {
                do {
                    let (_, audio) = try loadAudioArray(from: URL(fileURLWithPath: v.refAudio), sampleRate: model.sampleRate)
                    refs[v.refAudio] = audio
                    vAudio = audio
                } catch {
                    if !next.id.isEmpty { out.send(.error(id: next.id, message: "voice: \(error)")) }
                    return pump()
                }
            }
            (vText, vLanguage) = (v.refText, v.language)
        }
        let (id, text, out, voiceAudio, refText, language) = (next.id, next.text, self.out, vAudio, vText, vLanguage)
        let task = Task {
            let t0 = Date()
            var seq = 0
            do {
                for try await ev in model.generateStream(text: text, voice: nil, refAudio: voiceAudio, refText: refText,
                                                         language: language, generationParameters: model.defaultGenerationParameters,
                                                         streamingInterval: 0.5) {
                    try Task.checkCancellation()
                    if case let .audio(chunk) = ev, !id.isEmpty {
                        out.send(.pcm(id: id, seq: seq, samples: toInt16(chunk.asArray(Float.self))))
                        seq += 1
                    }
                }
                // O `task.cancel()` acorda o `for try await` com `nil`, sem throw: o laço sai normal, e a frase foi cancelada.
                try Task.checkCancellation()
                if id.isEmpty { out.send(.warm(ms: Int(Date().timeIntervalSince(t0) * 1000))) } else { out.send(.done(id: id)) }
            } catch is CancellationError {
                if !id.isEmpty { out.send(.cancelled(id: id)) }
            } catch {
                if Task.isCancelled { if !id.isEmpty { out.send(.cancelled(id: id)) } }
                else { out.send(.error(id: id.isEmpty ? nil : id, message: "\(error)")) }
            }
            await self.finished()
        }
        current = (id, task)
    }

    private func finished() {
        current = nil
        pump()
    }
}

let out = Out()
let engine = Engine(out: out)
// O stdin fechado (o app saiu ou caiu) encerra o processo: a memória nunca fica presa sem dono.
Task.detached {
    while let line = readLine(strippingNewline: true) {
        if line.isEmpty { continue }
        do { await engine.handle(try decodeCommand(line)) }
        catch { out.send(.error(id: nil, message: "bad command: \(error)")) }
    }
    exit(0)
}
dispatchMain()
