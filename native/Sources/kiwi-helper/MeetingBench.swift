import AVFoundation
import Darwin
import FluidAudio
import Foundation

/// `kiwi-helper --meeting <wav>` (T4926, R0 do spec #4823): mede o pipeline de reunião sobre um WAV de dois canais a
/// 16 kHz (canal 0 = você, o mic; canal 1 = sistema, os outros), sem mic e sem som. Escreve JSON por linha:
/// - `{"type":"word", "channel", "start", "end", "text", "firmAt"?}`: as palavras do ASR. `firmAt` (só no streaming) é
///   quanto áudio já tinha entrado quando a palavra ficou firme: `firmAt - end` é o atraso até o texto firme.
/// - `{"type":"spk", "speaker", "start", "end"}`: os turnos da diarização no canal do sistema.
/// - `{"type":"stats", …}`: tempo de parede, CPU e memória de pico.
/// É um spike de medida: o pipeline de verdade da reunião é o R3 (#196).
enum MeetingBench {
    enum ASRMode: String { case stream, batch, none }
    enum DiarizerKind: String { case sortformer, lseend, vbx, none }

    struct Options {
        var path: String
        var asr: ASRMode = .stream
        var diarizer: DiarizerKind = .sortformer
        /// Alimenta o streaming no ritmo do tempo real (para o atraso de verdade). Sem isso, o mais rápido possível.
        var realtime = false
        /// Quanto áudio entra por vez no streaming.
        var feedSeconds: Double = 0.5
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
        let models = try await AsrModels.downloadAndLoad(version: .ultra)
        try await withThrowingTaskGroup(of: Void.self) { group in
            for (i, samples) in channels.enumerated() {
                group.addTask {
                    switch o.asr {
                    case .stream: try await streamChannel(samples, name: names[i], models: models, o: o)
                    case .batch: try await batchChannel(samples, name: names[i], models: models)
                    case .none: break
                    }
                }
            }
            try await group.waitForAll()
        }
        return Date().timeIntervalSince(start)
    }

    private static func batchChannel(_ samples: [Float], name: String, models: AsrModels) async throws {
        let manager = AsrManager(config: .default)
        try await manager.loadModels(models)
        var state = TdtDecoderState.make(decoderLayers: await manager.decoderLayerCount)
        let result = try await manager.transcribe(samples, decoderState: &state)
        for w in words(result.tokenTimings ?? []) {
            emit(["type": "word", "channel": name, "start": w.start, "end": w.end, "text": w.text])
        }
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
