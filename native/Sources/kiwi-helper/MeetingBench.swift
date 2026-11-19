import AVFoundation
import Darwin
import FluidAudio
import Foundation
import KiwiHelperCore
import TranscribeCpp

/// `kiwi-helper --meeting <wav>` (T4926, R0 do spec #4823): mede o pipeline de reunião sobre um WAV de dois canais a
/// 16 kHz (canal 0 = você, o mic; canal 1 = sistema, os outros), sem mic e sem som. Escreve JSON por linha:
/// - `{"type":"word", "channel", "start", "end", "text", "firmAt"?}`: as palavras do ASR. `firmAt` (só no streaming) é
///   quanto áudio já tinha entrado quando a palavra ficou firme: `firmAt - end` é o atraso até o texto firme.
/// - `{"type":"spk", "speaker", "start", "end"}`: os turnos da diarização no canal do sistema.
/// - `{"type":"stats", …}`: tempo de parede, CPU e memória de pico.
/// É um spike de medida: o pipeline de verdade da reunião é o R3 (#196).
enum MeetingBench {
    enum ASRMode: String { case stream, batch, whisper, none }
    enum DiarizerKind: String { case sortformer, lseend, vbx, none }

    struct Options {
        var path: String
        var asr: ASRMode = .stream
        var diarizer: DiarizerKind = .sortformer
        /// Alimenta o streaming no ritmo do tempo real (para o atraso de verdade). Sem isso, o mais rápido possível.
        var realtime = false
        /// Quanto áudio entra por vez no streaming.
        var feedSeconds: Double = 0.5
        /// O GGUF do Whisper para `--asr whisper` (T20237): um candidato a modelo de reunião, em batch no fim.
        var whisperModel: String?
        /// No batch e no Whisper, só a fala que o Silero acha (o VAD do ditado), um pedaço por vez. Sem isso, nos silêncios
        /// longos de cada canal, o Whisper pula trechos e inventa texto; o Parakeet roda igual, para comparar (#20668).
        var chunkVAD = false
        /// T22375: o dicionário da pessoa (`--dictionary`). No batch, a correção fonética do texto de cada pedaço, como o
        /// ditado e a reunião ao vivo fazem; com `ctc`, antes dela o CTC acha os termos no áudio do pedaço (`--ctc`).
        var dictionary: TranscriptDictionary = .empty
        var ctc = false
    }

    static let sampleRate = 16_000.0

    static func run(_ o: Options) async -> Int32 {
        let wallStart = Date()
        let channels: [[Float]]
        do {
            channels = try readStereo(URL(fileURLWithPath: o.path))
        } catch {
            FileHandle.standardError.write(Data("meeting: \(error)\n".utf8))
            return 1
        }
        let names = ["voce", "sistema"]
        var stats: [String: Any] = [
            "file": (o.path as NSString).lastPathComponent, "asr": o.asr.rawValue, "diarizer": o.diarizer.rawValue,
            "audioSeconds": Double(channels[0].count) / sampleRate, "realtime": o.realtime,
        ]
        do {
            // O ASR dos dois canais e a diarização do sistema rodam juntos, como numa reunião ao vivo.
            async let asrTime: Double = runASR(o, channels: channels, names: names)
            async let diarTime: Double = runDiarizer(o, samples: channels[1])
            let (a, d) = try await (asrTime, diarTime)
            stats["asrSeconds"] = a
            stats["diarizerSeconds"] = d
        } catch {
            FileHandle.standardError.write(Data("meeting: \(error)\n".utf8))
            return 1
        }
        let wall = Date().timeIntervalSince(wallStart)
        stats["type"] = "stats"
        stats["wallSeconds"] = wall
        stats["cpuSeconds"] = cpuSeconds()
        stats["peakFootprintMB"] = peakFootprintMB()
        emit(stats)
        return 0
    }

    // MARK: ASR

    private static func runASR(_ o: Options, channels: [[Float]], names: [String]) async throws -> Double {
        guard o.asr != .none else { return 0 }
        let start = Date()
        if o.asr == .whisper {
            try await whisperChannels(channels, names: names, model: o.whisperModel, vad: o.chunkVAD)
            return Date().timeIntervalSince(start)
        }
        let models = try await AsrModels.downloadAndLoad(version: .ultra)
        let vad = o.chunkVAD ? try await VadManager(config: VadConfig(defaultThreshold: 0.7)) : nil
        let terms = o.dictionary.terms
        let session = o.ctc && !terms.isEmpty
            ? try await Transcriber.session(terms: terms, ctc: try await CtcModels.downloadAndLoad(variant: .ctc110m)) : nil
        try await withThrowingTaskGroup(of: Void.self) { group in
            for (i, samples) in channels.enumerated() {
                group.addTask {
                    switch o.asr {
                    case .stream: try await streamChannel(samples, name: names[i], models: models, o: o)
                    case .batch: try await batchChannel(samples, name: names[i], models: models, vad: vad, dictionary: o.dictionary, session: session)
                    case .none, .whisper: break
                    }
                }
            }
            try await group.waitForAll()
        }
        return Date().timeIntervalSince(start)
    }

    private static func batchChannel(_ samples: [Float], name: String, models: AsrModels, vad: VadManager?,
                                     dictionary: TranscriptDictionary, session: VocabularyBoostingSession?) async throws {
        let manager = AsrManager(config: .default)
        try await manager.loadModels(models)
        for (offset, piece) in try await speechPieces(samples, vad: vad) {
            var state = TdtDecoderState.make(decoderLayers: await manager.decoderLayerCount)
            let result = try await manager.transcribe(piece, decoderState: &state)
            let base = Double(offset) / sampleRate
            var found = words(result.tokenTimings ?? [])
            if !dictionary.terms.isEmpty {
                var raw = found.map(\.text).joined(separator: " ")
                if let session { raw = await Transcriber.rescored(raw, timings: result.tokenTimings ?? [], audio: piece, session: session) }
                found = WordRetiming.retimed(found, as: TranscriptPostProcessor.process(raw, dictionary: dictionary))
            }
            for w in found {
                emit(["type": "word", "channel": name, "start": base + w.start, "end": base + w.end, "text": w.text])
            }
        }
    }

    /// Os pedaços do canal (começo em amostras, áudio): ele inteiro, ou cada fala que o VAD achou.
    private static func speechPieces(_ samples: [Float], vad: VadManager?) async throws -> [(Int, [Float])] {
        guard let vad else { return [(0, samples)] }
        return try await vad.segmentSpeech(samples).compactMap { seg in
            let a = max(0, Int(seg.startTime * sampleRate)), b = min(samples.count, Int(seg.endTime * sampleRate))
            return b > a ? (a, Array(samples[a..<b])) : nil
        }
    }

    /// Um candidato a modelo de reunião (T20237): o Whisper (GGUF, pelo transcribe.cpp em Metal, como o modo preciso) no
    /// canal inteiro, um canal depois do outro, com a língua fixa em `pt`. Cada segmento vira palavras espalhadas pelo
    /// tempo dele (o Whisper dá o tempo por segmento).
    private static func whisperChannels(_ channels: [[Float]], names: [String], model path: String?, vad useVAD: Bool) async throws {
        guard let path else { throw NSError(domain: "meeting", code: 2, userInfo: [NSLocalizedDescriptionKey: "--asr whisper precisa de --whisper <gguf>"]) }
        try Transcribe.initBackends()
        // O modelo morre antes do fim do processo: vivo no exit, o Metal aborta num assert (PreciseTranscriber).
        try await {
            let model = try TranscribeCpp.Model(path: path, options: ModelOptions(backend: .metal))
            let vad = useVAD ? try await VadManager(config: VadConfig(defaultThreshold: 0.7)) : nil
            for (i, samples) in channels.enumerated() {
                for (offset, piece) in try await speechPieces(samples, vad: vad) {
                let session = try model.session()
                let options = RunOptions(timestamps: .segment, language: "pt", keepSpecialTags: false,
                                         family: .whisper(WhisperRunOptions(seed: 1)))
                let result = try await session.run(piece, options: options)
                let base = Double(offset) / sampleRate
                for seg in result.segments {
                    let text = RepetitionGuard.collapse(seg.text.trimmingCharacters(in: .whitespacesAndNewlines))
                    let ws = text.split(whereSeparator: \.isWhitespace)
                    guard !ws.isEmpty else { continue }
                    let s0 = base + Double(seg.t0Ms) / 1000, step = (base + Double(seg.t1Ms) / 1000 - s0) / Double(ws.count)
                    for (j, w) in ws.enumerated() {
                        emit(["type": "word", "channel": names[i], "start": s0 + Double(j) * step, "end": s0 + Double(j + 1) * step, "text": String(w)])
                    }
                }
                }
            }
        }()
    }

    /// Quanto áudio já entrou, por canal, para o `firmAt`.
    private final class FedClock: @unchecked Sendable {
        private let lock = NSLock()
        private var samples = 0
        func add(_ n: Int) { lock.withLock { samples += n } }
        var seconds: Double { lock.withLock { Double(samples) / MeetingBench.sampleRate } }
    }

    private static func streamChannel(_ samples: [Float], name: String, models: AsrModels, o: Options) async throws {
        let manager = SlidingWindowAsrManager(config: .streaming)
        try await manager.loadModels(models)
        let updates = await manager.tokenUpdates
        try await manager.startStreaming(source: .system)
        let clock = FedClock()

        // A revisão dos tokens (TokenRevisions.md): troca tudo depois de `retainedTokenCount` e só o que está antes de
        // `stableTokenCount` é firme. Cada token guarda quando ficou firme.
        let consumer = Task { () throws -> [(TokenTiming, Double?)] in
            var tokens: [(TokenTiming, Double?)] = []
            for try await update in updates {
                let r = update.revision
                tokens = Array(tokens.prefix(r.retainedTokenCount)) + update.tokens.map { ($0, nil) }
                let now = clock.seconds
                for i in 0..<min(r.stableTokenCount, tokens.count) where tokens[i].1 == nil {
                    tokens[i].1 = now
                }
            }
            return tokens
        }

        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false)!
        let step = Int(o.feedSeconds * sampleRate)
        let began = Date()
        var offset = 0
        while offset < samples.count {
            let n = min(step, samples.count - offset)
            let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(n))!
            buffer.frameLength = AVAudioFrameCount(n)
            samples.withUnsafeBufferPointer { src in
                buffer.floatChannelData![0].update(from: src.baseAddress! + offset, count: n)
            }
            await manager.streamAudio(buffer)
            offset += n
            clock.add(n)
            if o.realtime {
                let due = Double(offset) / sampleRate - Date().timeIntervalSince(began)
                if due > 0 { try await Task.sleep(nanoseconds: UInt64(due * 1e9)) }
            }
        }
        _ = try await manager.finish()
        let tokens = try await consumer.value
        let end = clock.seconds
        for w in words(tokens.map(\.0), firmAt: tokens.map { $0.1 ?? end }) {
            var line: [String: Any] = ["type": "word", "channel": name, "start": w.start, "end": w.end, "text": w.text]
            if let f = w.firmAt { line["firmAt"] = f }
            emit(line)
        }
        await manager.cleanup()
    }

    /// Junta os tokens (SentencePiece, "▁" abre palavra) em palavras com início e fim.
    static func words(_ tokens: [TokenTiming], firmAt: [Double]? = nil) -> [(text: String, start: Double, end: Double, firmAt: Double?)] {
        var out: [(text: String, start: Double, end: Double, firmAt: Double?)] = []
        for (i, t) in tokens.enumerated() {
            let piece = t.token
            let opens = piece.hasPrefix("▁") || piece.hasPrefix(" ") || out.isEmpty
            let clean = piece.replacingOccurrences(of: "▁", with: "").trimmingCharacters(in: .whitespaces)
            guard !clean.isEmpty || !opens else { continue }
            let firm = firmAt?[i]
            if opens {
                out.append((clean, t.startTime, t.endTime, firm))
            } else {
                out[out.count - 1].text += clean
                out[out.count - 1].end = t.endTime
                if let firm { out[out.count - 1].firmAt = max(out[out.count - 1].firmAt ?? firm, firm) }
            }
        }
        return out.filter { !$0.text.isEmpty }
    }

    // MARK: Diarização

    private static func runDiarizer(_ o: Options, samples: [Float]) async throws -> Double {
        let start = Date()
        switch o.diarizer {
        case .none:
            return 0
        case .vbx:
            let manager = OfflineDiarizerManager(config: .default)
            try await manager.prepareModels()
            let result = try await manager.process(audio: samples)
            for s in result.segments {
                emit(["type": "spk", "speaker": s.speakerId, "start": Double(s.startTimeSeconds), "end": Double(s.endTimeSeconds)])
            }
        case .sortformer, .lseend:
            let diarizer: any Diarizer
            if o.diarizer == .sortformer {
                let d = SortformerDiarizer(config: .default)
                d.initialize(models: try await SortformerModels.loadFromHuggingFace(config: .default))
                diarizer = d
            } else {
                diarizer = try await LSEENDDiarizer(variant: .ami)
            }
            // Ao vivo: o mesmo passo do ASR, no ritmo do tempo real se pedido.
            let step = Int(o.feedSeconds * sampleRate)
            let began = Date()
            var offset = 0
            while offset < samples.count {
                let n = min(step, samples.count - offset)
                _ = try diarizer.process(samples: samples[offset..<(offset + n)], sourceSampleRate: sampleRate)
                offset += n
                if o.realtime {
                    let due = Double(offset) / sampleRate - Date().timeIntervalSince(began)
                    if due > 0 { try await Task.sleep(nanoseconds: UInt64(due * 1e9)) }
                }
            }
            _ = try diarizer.finalizeSession()
            for speaker in diarizer.timeline.speakers.values {
                for s in speaker.finalizedSegments {
                    emit(["type": "spk", "speaker": "\(speaker.index)", "start": Double(s.startTime), "end": Double(s.endTime)])
                }
            }
        }
        return Date().timeIntervalSince(start)
    }

    // MARK: Arquivo, saída e medidas

    static func readStereo(_ url: URL) throws -> [[Float]] {
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat
        guard format.sampleRate == sampleRate, format.channelCount == 2,
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(file.length)) else {
            throw NSError(domain: "kiwi", code: 1, userInfo: [NSLocalizedDescriptionKey: "precisa de WAV 16 kHz com 2 canais"])
        }
        try file.read(into: buffer)
        let n = Int(buffer.frameLength)
        return (0..<2).map { ch in Array(UnsafeBufferPointer(start: buffer.floatChannelData![ch], count: n)) }
    }

    private static let out = NSLock()
    static func emit(_ object: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes]) else { return }
        out.withLock { print(String(decoding: data, as: UTF8.self)) }
    }

    static func cpuSeconds() -> Double {
        var usage = rusage()
        getrusage(RUSAGE_SELF, &usage)
        func s(_ t: timeval) -> Double { Double(t.tv_sec) + Double(t.tv_usec) / 1e6 }
        return s(usage.ru_utime) + s(usage.ru_stime)
    }

    /// O pico do `phys_footprint` (a memória que o Monitor de Atividade mostra).
    static func peakFootprintMB() -> Double {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
        let kr = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) }
        }
        guard kr == KERN_SUCCESS else { return -1 }
        return Double(info.ledger_phys_footprint_peak) / 1_048_576
    }
}
