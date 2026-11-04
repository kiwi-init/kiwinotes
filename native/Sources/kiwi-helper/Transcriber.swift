// Partes portadas de VoiceInk/VoiceInk/Infrastructure/Providers/Transcription/FluidAudio/FluidAudioTranscriptionService.swift
// @ 19546d2 (GPL-3.0). Mudanças: só o caminho do Parakeet em lote (sem Unified, Nemotron e streaming); as amostras
// chegam da memória (lá, de um arquivo); o vocabulary boosting por CTC entra antes do pós-processamento (ADR 0003);
// os modelos ficam no cache padrão do FluidAudio.

import FluidAudio
import Foundation
import KiwiHelperCore

/// Speech to text in the sidecar (T256): Parakeet via FluidAudio, the way VoiceInk runs it. One call at a time:
/// the Helper chains them, so transcripts come out in the order the recordings ended.
actor Transcriber {
    struct Output {
        /// What the model said, after the CTC rescoring and before the post-processing.
        let raw: String
        let text: String
        let lang: String
    }

    enum Failure: String, Error {
        /// The model couldn't be downloaded or loaded (first run offline, disk full…).
        case modelUnavailable = "model_unavailable"
        case failed = "stt_failed"
    }

    /// Parakeet TDT 0.6B Ultra: ADR 0003's choice until the real-voice round says otherwise.
    let version: AsrModelVersion
    private var manager: AsrManager?
    private var loading: Task<AsrManager, Error>?
    private var language: TranscriptionLanguage = .auto
    private var dictionary = TranscriptDictionary.empty
    private var useVAD = false
    private var vad: VadManager?
    private var ctc: CtcModels?
    /// The CTC model's download or load, in the background: no dictation waits for it (T1973).
    private var ctcLoading: Task<CtcModels?, Never>?
    /// When the CTC last failed to load (offline, disk full): it's tried again only after `ctcRetryAfter`.
    private var ctcFailedAt: TimeInterval?
    static let ctcRetryAfter: TimeInterval = 10 * 60
    /// `loading`, `ready`, `unavailable`: for the `stt.boosting` event.
    private var onBoosting: (@Sendable (String) -> Void)?
    private var boosting: (terms: [String], session: VocabularyBoostingSession)?
    private var warmedUp = false

    /// The CTC rescoring before the phonetic correction. On in the app since T1973 (harry, #1967): the phonetic
    /// correction alone doesn't reach terms the model mishears ("dicom do pacs" → "de condu Pax"). The 99 MB model
    /// downloads once, in the background after the main one, from the same place (ADR 0003); until it's there, or
    /// when it can't download, dictation runs without it. `KIWI_STT_BOOSTING=off` turns it off.
    let vocabularyBoosting: Bool

    init(version: AsrModelVersion = .ultra, vocabularyBoosting: Bool = false) {
        self.version = version
        self.vocabularyBoosting = vocabularyBoosting
    }

    func setBoostingHandler(_ handler: @escaping @Sendable (String) -> Void) {
        onBoosting = handler
    }

    /// Starts loading the CTC model (downloading it the first time), without waiting. Once at a time, and after a
    /// failure not again before `ctcRetryAfter`, so an offline Mac doesn't try on every dictation.
    func prepareBoosting() {
        guard vocabularyBoosting, ctc == nil, ctcLoading == nil else { return }
        if let failed = ctcFailedAt, ProcessInfo.processInfo.systemUptime - failed < Self.ctcRetryAfter { return }
        onBoosting?("loading")
        ctcLoading = Task { try? await CtcModels.downloadAndLoad(variant: .ctc110m) }
        Task { await self.finishBoosting() }
    }

    /// Waits for the CTC model: for `--transcribe --ctc`, which measures with it from the first file.
    func waitForBoosting() async {
        prepareBoosting()
        await finishBoosting()
    }

    private func finishBoosting() async {
        guard let loading = ctcLoading else { return }
        let models = await loading.value
        guard ctcLoading != nil else { return } // the other waiter got here first
        ctcLoading = nil
        if let models {
            ctc = models
            ctcFailedAt = nil
            _ = await boostingSession() // the session for the current dictionary, before the next dictation
            onBoosting?("ready")
        } else {
            ctcFailedAt = ProcessInfo.processInfo.systemUptime
            onBoosting?("unavailable")
        }
    }

    func configure(language: TranscriptionLanguage? = nil, dictionary: TranscriptDictionary? = nil, vad: Bool? = nil) {
        if let language { self.language = language }
        if let dictionary { self.dictionary = dictionary }
        if let vad { useVAD = vad }
    }

    /// Downloads the model the first time (~600 MB from Hugging Face, the only network access) and loads it.
    /// Concurrent calls share one load.
    @discardableResult
    func prepare() async throws -> AsrManager {
        if let manager { return manager }
        if let loading { return try await loading.value }
        let version = self.version
        let task = Task { () throws -> AsrManager in
            let models = try await AsrModels.downloadAndLoad(version: version)
            let manager = AsrManager(config: .default)
            try await manager.loadModels(models)
            return manager
        }
        loading = task
        do {
            let manager = try await task.value
            self.manager = manager
            loading = nil
            return manager
        } catch {
            loading = nil
            throw Failure.modelUnavailable
        }
    }

    /// Everything the first dictation would otherwise wait for: the model, the CTC model and its session for the
    /// current dictionary, and the first inference (CoreML specializes the model for the Neural Engine on it).
    func warmUp() async throws {
        let manager = try await prepare()
        // The CTC model comes after the main one, in the background: being ready to dictate doesn't wait for it.
        prepareBoosting()
        _ = await boostingSession()
        if useVAD, vad == nil { vad = try? await VadManager(config: VadConfig(defaultThreshold: 0.7)) }
        guard !warmedUp else { return }
        var state = TdtDecoderState.make(decoderLayers: await manager.decoderLayerCount)
        _ = try? await manager.transcribe([Float](repeating: 0, count: 16_000), decoderState: &state)
        warmedUp = true
    }

    func transcribe(_ samples: [Float]) async throws -> Output {
        var audio = samples
        if useVAD { audio = await speechOnly(audio) }
        audio = STTInput.padded(audio)
        guard !audio.isEmpty else { return Output(raw: "", text: "", lang: "") }

        let manager = try await prepare()
        // Each dictation is its own utterance: a fresh decoder state, no context carried over.
        var state = TdtDecoderState.make(decoderLayers: await manager.decoderLayerCount)
        let hint: Language? = language == .auto ? nil : Language(rawValue: language.rawValue)
        let result: ASRResult
        do {
            result = try await manager.transcribe(audio, decoderState: &state, language: hint)
        } catch {
            throw Failure.failed
        }
        var raw = result.text
        if let session = await boostingSession(),
           let rescored = await session.rescore(text: raw, tokenTimings: result.tokenTimings ?? [], audioSamples: audio),
           rescored.wasModified {
            // Swap by swap (T1973): the rescorer's answer mixes right swaps with wrong ones on Portuguese.
            let timings = result.tokenTimings ?? []
            let confidence = VocabularyRescoreGuard.wordConfidence(tokens: timings.map { ($0.token, Double($0.confidence)) })
            raw = VocabularyRescoreGuard.apply(original: raw, confidence: confidence, swaps: rescored.replacements.compactMap { r in
                guard r.shouldReplace, let term = r.replacementWord, let score = r.replacementScore else { return nil }
                return .init(from: r.originalWord, to: term, margin: Double(score - r.originalScore))
            })
        }
        let text = TranscriptPostProcessor.process(raw, dictionary: dictionary)
        return Output(raw: raw, text: text, lang: SpokenLanguage.detect(text))
    }

    /// VoiceInk's optional VAD (Silero, threshold 0.7): only the speech goes to the model, and audio without
    /// speech gives an empty transcript. If the VAD fails, the whole clip goes, as in VoiceInk.
    private func speechOnly(_ samples: [Float]) async -> [Float] {
        do {
            if vad == nil { vad = try await VadManager(config: VadConfig(defaultThreshold: 0.7)) }
            return try await vad!.segmentSpeechAudio(samples).flatMap { $0 }
        } catch {
            return samples
        }
    }

    /// The CTC 110M model spots the dictionary terms in the audio and rescores the transcript (T51: the mixed
    /// PT/EN sentences went from 34% to 26.5% WER). Rebuilt when the terms change; nil without terms or when
    /// the CTC model isn't available (the phonetic correction still runs).
    private func boostingSession() async -> VocabularyBoostingSession? {
        let terms = dictionary.terms
        guard vocabularyBoosting, !terms.isEmpty else { return nil }
        if let boosting, boosting.terms == terms { return boosting.session }
        // Never waits for the download: without the model yet, this dictation goes without boosting.
        guard let ctc else {
            prepareBoosting()
            return nil
        }
        do {
            // Dictation thresholds (FluidAudio #967): a wrong replacement costs more than a miss.
            let session = try await VocabularyBoostingSession(
                vocabulary: CustomVocabularyContext(terms: terms.map { CustomVocabularyTerm(text: $0) }),
                ctcModels: ctc,
                thresholds: .init(cbw: 0, minSimilarity: 0.7))
            boosting = (terms, session)
            return session
        } catch {
            return nil
        }
    }
}
