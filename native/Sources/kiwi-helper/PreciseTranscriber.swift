// O modo preciso (T6602, decisão do harry no #6894): o Whisper small (Q8_0) pelo transcribe.cpp, em Metal, com o
// dicionário como prompt. O app baixa o modelo quando a pessoa liga o modo e manda o caminho no `config.set {precise}`;
// daqui para a frente, os ditados saem por ele. Medido no ADR 0003: nas frases com termos técnicos, 20,5% de WER contra
// 27,4% e 32,9% do Parakeet com o CTC, a ~0,34 s por ditado.

import Foundation
import KiwiHelperCore
import TranscribeCpp

/// O modelo carregado, atrás de um lock: o `quit()` do helper roda fora do actor e precisa soltá-lo antes de sair.
/// O backend Metal aborta num assert no fim do processo (`ggml-metal-device.m:1040`) se um modelo ainda estiver vivo.
final class LoadedWhisper: @unchecked Sendable {
    private let lock = NSLock()
    private var model: TranscribeCpp.Model?
    private weak var last: TranscribeCpp.Model?

    func set(_ model: TranscribeCpp.Model?) {
        lock.withLock {
            self.model = model
            if model != nil { last = model }
        }
    }

    func get() -> TranscribeCpp.Model? { lock.withLock { model } }

    /// Solta o modelo. `true` quando ninguém mais o segura (um ditado em curso segura), e o processo pode sair limpo.
    func release() -> Bool {
        lock.withLock {
            model = nil
            return last == nil
        }
    }
}

actor PreciseTranscriber {
    enum Failure: Error {
        case notLoaded
        case notWhisper
    }

    nonisolated let loaded = LoadedWhisper()
    private var path: String?
    private var backendsReady = false

    var isLoaded: Bool { loaded.get() != nil }

    /// Carrega o GGUF (mapeado do disco, sem cópia). Outro caminho troca o modelo; o mesmo não faz nada.
    func load(path: String) throws {
        if self.path == path, loaded.get() != nil { return }
        if !backendsReady {
            try Transcribe.initBackends()
            backendsReady = true
        }
        let model = try TranscribeCpp.Model(path: path, options: ModelOptions(backend: .metal))
        guard model.arch.localizedCaseInsensitiveContains("whisper") else { throw Failure.notWhisper }
        loaded.set(model)
        self.path = path
    }

    func unload() {
        _ = loaded.release()
        path = nil
    }

    /// O texto do Whisper, com o loop de repetição desfeito e antes do pós-processamento do dicionário. Sem dica de
    /// idioma: com `pt` fixo, o inglês piora (ADR 0003), e sem ela o Whisper detecta sozinho.
    func transcribe(_ samples: [Float], terms: [String]) async throws -> String {
        guard let model = loaded.get() else { throw Failure.notLoaded }
        guard !samples.isEmpty else { return "" }
        // Uma sessão por ditado, como o VoiceInk: nada do ditado anterior entra no próximo.
        let session = try model.session()
        // A semente fixa: quando o Whisper refaz a decodificação com temperatura (o que o tira de um loop), o mesmo áudio
        // dá o mesmo texto. Sem ela, um "ok" curto saiu "OK." numa vez e "4-key." na outra.
        let options = RunOptions(timestamps: .none, keepSpecialTags: false,
                                 family: .whisper(WhisperRunOptions(initialPrompt: WhisperPrompt.make(terms), seed: 1)))
        let text = try await session.run(samples, options: options).text
        return RepetitionGuard.collapse(text.trimmingCharacters(in: .whitespacesAndNewlines))
    }
}
