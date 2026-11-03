import AVFoundation
import CryptoKit
import Darwin
import FluidAudio
import Foundation
import TranscribeCpp
import WhisperKit

// stt-bench <engine>        run the corpus and write results/<engine>.json
//   engines: parakeet-v3 | parakeet-ultra | parakeet-unified | nemotron-unified | whisper:<model>
//   (a name from argmaxinc/whisperkit-coreml, e.g. openai_whisper-small) | tcpp:<model> (transcribe.cpp, a name
//   from `tcppCatalog`), then optionally:
//     @<lang>  a language hint: Parakeet v3/Ultra filter tokens by script, Nemotron takes it as its prompt (pt, en, auto),
//              transcribe.cpp passes it to the model (Cohere needs one; Whisper detects without it)
//     +vocab   each engine's own way to use the dictionary in vocab.txt
// stt-bench --list-whisper  list WhisperKit models
// stt-bench --report [dir]   the ADR table of every result in dir (default ./results), with the sidecar's
//                             post-processing: terms, and aliases learned on one take (Report.swift)
// One engine per process, so the memory numbers are its own.

let modelsBase = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Caches/kiwinotes-stt-bench", isDirectory: true)

// MARK: Engines

protocol Engine {
    var name: String { get }
    func load() async throws
    func transcribe(_ samples: [Float]) async throws -> String
}

final class Parakeet: Engine {
    let name: String
    private let version: AsrModelVersion
    private let vocabulary: [String]?
    private let language: Language?
    private var manager: AsrManager?
    private var boosting: VocabularyBoostingSession?

    init(name: String, version: AsrModelVersion, vocabulary: [String]?, language: Language?) {
        self.name = name
        self.version = version
        self.vocabulary = vocabulary
        self.language = language
    }

    func load() async throws {
        let models = try await AsrModels.downloadAndLoad(version: version)
        let manager = AsrManager(config: .default)
        try await manager.loadModels(models)
        self.manager = manager
        if let vocabulary {
            // A separate CTC model (110M) spots the terms in the audio and rescores the transcript.
            // Dictation thresholds (FluidAudio #967): a wrong replacement costs more than a miss.
            let ctc = try await CtcModels.downloadAndLoad(variant: .ctc110m)
            boosting = try await VocabularyBoostingSession(
                vocabulary: CustomVocabularyContext(terms: vocabulary.map { CustomVocabularyTerm(text: $0) }),
                ctcModels: ctc,
                thresholds: .init(cbw: 0, minSimilarity: 0.7))
        }
    }

    func transcribe(_ samples: [Float]) async throws -> String {
        // Each dictation is its own utterance: a fresh decoder state, no context carried over.
        var state = TdtDecoderState.make(decoderLayers: await manager!.decoderLayerCount)
        let result = try await manager!.transcribe(samples, decoderState: &state, language: language)
        guard let boosting else { return result.text }
        let rescored = await boosting.rescore(text: result.text, tokenTimings: result.tokenTimings ?? [], audioSamples: samples)
        return rescored?.text ?? result.text
    }
}

/// The 0.6B "unified" checkpoints, run offline (whole clip, 15 s windows) the way VoiceInk runs them in batch.
/// `parakeet-unified` is English only; `nemotron-unified` covers 25 European languages with a language prompt.
final class Unified: Engine {
    let name: String
    private let family: UnifiedModelFamily
    private let vocabulary: [String]?
    private var manager: UnifiedAsrManager?

    init(name: String, family: UnifiedModelFamily, vocabulary: [String]?) {
        self.name = name
        self.family = family
        self.vocabulary = vocabulary
    }

    func load() async throws {
        let manager = UnifiedAsrManager(config: UnifiedConfig(family: family), encoderPrecision: .int8)
        try await manager.loadModels()
        if let vocabulary {
            let ctc = try await CtcModels.downloadAndLoad(variant: .ctc110m)
            try await manager.configureVocabularyBoosting(
                vocabulary: CustomVocabularyContext(terms: vocabulary.map { CustomVocabularyTerm(text: $0) }),
                ctcModels: ctc,
                thresholds: .init(cbw: 0, minSimilarity: 0.7))
        }
        self.manager = manager
    }

    func transcribe(_ samples: [Float]) async throws -> String {
        try await manager!.reset()
        return try await manager!.transcribe(samples)
    }
}

final class Whisper: Engine {
    let model: String
    private let vocabulary: [String]?
    var name: String { "whisper:\(model)" + (vocabulary == nil ? "" : "+vocab") }
    private var kit: WhisperKit?
    private var prompt: [Int]?

    init(model: String, vocabulary: [String]?) {
        self.model = model
        self.vocabulary = vocabulary
    }

    func load() async throws {
        let config = WhisperKitConfig(model: model, downloadBase: modelsBase, verbose: false,
                                      logLevel: .error, prewarm: true, load: true, download: true)
        kit = try await WhisperKit(config)
        if let vocabulary, let tokenizer = kit?.tokenizer {
            // Whisper's way to bias spelling: the terms as a "previous text" prompt.
            prompt = tokenizer.encode(text: " " + vocabulary.joined(separator: ", "))
                .filter { $0 < tokenizer.specialTokens.specialTokenBegin }
        }
    }

    func transcribe(_ samples: [Float]) async throws -> String {
        // No language given: dictation mixes PT and EN, so the model has to detect it.
        var options = DecodingOptions(verbose: false, task: .transcribe, language: nil, temperature: 0,
                                      usePrefillPrompt: true, detectLanguage: true, skipSpecialTokens: true,
                                      withoutTimestamps: true)
        options.suppressBlank = true
        if let prompt {
            // With a prompt, WhisperKit's built-in detection comes back empty (every clip ""), so detect
            // the language in its own pass first. That pass counts in the latency.
            options.language = try await kit!.detectLangauge(audioArray: samples).language
            options.detectLanguage = false
            options.promptTokens = prompt
        }
        let results = try await kit!.transcribe(audioArray: samples, decodeOptions: options)
        return results.map(\.text).joined(separator: " ").trimmingCharacters(in: .whitespaces)
    }
}

/// A GGUF from Hugging Face, pinned to a revision and checked by size and SHA-256 (VoiceInk's
/// `TranscribeCppModelCatalog` does the same).
struct GGUF {
    let repository, revision, file, sha256: String
    let size: Int64
    /// What the model needs in `RunOptions.language`: Cohere has no language detection.
    let needsLanguage: Bool
}

let tcppCatalog: [String: GGUF] = [
    // The quantization VoiceInk ships (1.56 GB), and Q8_0, the one transcribe.cpp reports its WER on.
    "cohere": GGUF(repository: "handy-computer/cohere-transcribe-03-2026-gguf",
                   revision: "dfa4adebb64f3076b7b6b90b721275cc069cb421",
                   file: "cohere-transcribe-03-2026-Q4_K_M.gguf",
                   sha256: "0ea56826d8bd5d74b7143a4a04e022dc1bb75452cfae49d98b6acb0c1d16a1fb",
                   size: 1_558_162_944, needsLanguage: true),
    "cohere-q8": GGUF(repository: "handy-computer/cohere-transcribe-03-2026-gguf",
                      revision: "7353b6040bdc1be9e5a3823d99d5fe12afe88264",
                      file: "cohere-transcribe-03-2026-Q8_0.gguf",
                      sha256: "931916663432fd895423a4291a8400221802b288967ca2d435fc5e3141c9e71e",
                      size: 2_410_655_232, needsLanguage: true),
    "whisper-turbo": GGUF(repository: "handy-computer/whisper-large-v3-turbo-gguf",
                          revision: "18ada752005f5fddef499256f9a458d0b37a203a",
                          file: "whisper-large-v3-turbo-Q8_0.gguf",
                          sha256: "257aa7ec9121c22c167d5e2c49e3e76b4ba0e6e27ebc13074eba0a80f8190220",
                          size: 886_381_728, needsLanguage: false),
    // The same Parakeet Ultra as FluidAudio, to see what one runtime for everything would cost.
    "parakeet-ultra": GGUF(repository: "handy-computer/parakeet-ultra-gguf",
                           revision: "a1539be1b849ea7463b88343e5277b373d0c4ea9",
                           file: "parakeet-ultra-Q8_0.gguf",
                           sha256: "007a59761e9258779f189df396b50d12b83bb5b79e66df4b955c230d2f2a0a59",
                           size: 740_363_168, needsLanguage: false),
]

final class TranscribeCppEngine: Engine {
    let name: String
    private let gguf: GGUF
    private let language: String?
    private let vocabulary: [String]?
    private var model: TranscribeCpp.Model?
    private var isWhisper = false

    init(name: String, gguf: GGUF, language: String?, vocabulary: [String]?) {
        self.name = name
        self.gguf = gguf
        self.language = language
        self.vocabulary = vocabulary
    }

    var file: URL {
        modelsBase.appendingPathComponent("transcribe-cpp/\(gguf.repository)", isDirectory: true)
            .appendingPathComponent(gguf.file)
    }

    func load() async throws {
        try await download()
        try Transcribe.initBackends()
        let loaded = try TranscribeCpp.Model(path: file.path, options: ModelOptions(backend: .metal))
        isWhisper = loaded.arch.localizedCaseInsensitiveContains("whisper")
        model = loaded
    }

    func transcribe(_ samples: [Float]) async throws -> String {
        // A new session per dictation, as VoiceInk's `OfflineTranscribeCppService` does.
        let session = try model!.session()
        var options = RunOptions(timestamps: .none, language: language, keepSpecialTags: false)
        if isWhisper, let vocabulary {
            // Whisper's way to bias spelling, as in the WhisperKit engine: the terms as the initial prompt.
            options.family = .whisper(WhisperRunOptions(initialPrompt: vocabulary.joined(separator: ", ")))
        }
        return try await session.run(samples, options: options).text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func download() async throws {
        let fm = FileManager.default
        let checked = file.appendingPathExtension("sha256")
        if (try? String(contentsOf: checked, encoding: .utf8)) == gguf.sha256 { return }
        try fm.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        if (try? fm.attributesOfItem(atPath: file.path)[.size] as? Int64) != gguf.size {
            let url = URL(string: "https://huggingface.co/\(gguf.repository)/resolve/\(gguf.revision)/\(gguf.file)")!
            print("downloading \(gguf.file) (\(gguf.size / 1_000_000) MB)")
            let (tmp, response) = try await URLSession.shared.download(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            try? fm.removeItem(at: file)
            try fm.moveItem(at: tmp, to: file)
        }
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 8 << 20), !chunk.isEmpty { hasher.update(data: chunk) }
        let digest = hasher.finalize().map { String(format: "%02x", $0) }.joined()
        guard digest == gguf.sha256 else {
            try? fm.removeItem(at: file)
            throw NSError(domain: "stt-bench", code: 3, userInfo: [NSLocalizedDescriptionKey: "\(gguf.file): wrong SHA-256"])
        }
        try gguf.sha256.write(to: checked, atomically: true, encoding: .utf8)
    }
}

// MARK: Measurements

func physFootprintMB() -> Double {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
    let kr = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
            task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
        }
    }
    return kr == KERN_SUCCESS ? Double(info.phys_footprint) / 1_048_576 : -1
}

func peakFootprintMB() -> Double {
    var usage = rusage_info_v4()
    let rc = withUnsafeMutablePointer(to: &usage) {
        $0.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(getpid(), RUSAGE_INFO_V4, $0) }
    }
    return rc == 0 ? Double(usage.ri_lifetime_max_phys_footprint) / 1_048_576 : -1
}

func cpuSeconds() -> Double {
    var r = rusage()
    getrusage(RUSAGE_SELF, &r)
    func s(_ t: timeval) -> Double { Double(t.tv_sec) + Double(t.tv_usec) / 1e6 }
    return s(r.ru_utime) + s(r.ru_stime)
}

func now() -> Double { ProcessInfo.processInfo.systemUptime }

// MARK: Corpus

struct Clip {
    let id, lang, size, text: String
    let file: URL
}

/// Every `<id>_<take>.wav` in `audioDir` whose id is in corpus.tsv: `_v1`/`_v2` from gen-audio.sh, `_r1` from record.sh.
func loadCorpus(root: URL, audioDir: URL) throws -> [Clip] {
    let tsv = try String(contentsOf: root.appendingPathComponent("corpus.tsv"), encoding: .utf8)
    var sentences: [String: [String]] = [:]
    for line in tsv.split(separator: "\n") where !line.hasPrefix("#") {
        let f = line.split(separator: "\t", maxSplits: 3).map(String.init)
        if f.count == 4 { sentences[f[0]] = f }
    }
    let files = try FileManager.default.contentsOfDirectory(atPath: audioDir.path).filter { $0.hasSuffix(".wav") }.sorted()
    return files.compactMap { name in
        let take = String(name.dropLast(4))
        guard let id = take.split(separator: "_").first, let f = sentences[String(id)] else { return nil }
        return Clip(id: take, lang: f[1], size: f[2], text: f[3], file: audioDir.appendingPathComponent(name))
    }
}

func readSamples(_ url: URL) throws -> [Float] {
    let file = try AVAudioFile(forReading: url)
    let format = file.processingFormat
    precondition(format.sampleRate == 16_000 && format.channelCount == 1, "run gen-audio.sh (16 kHz mono)")
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(file.length))!
    try file.read(into: buffer)
    return Array(UnsafeBufferPointer(start: buffer.floatChannelData![0], count: Int(buffer.frameLength)))
}

// MARK: WER

func normalize(_ s: String) -> [String] {
    let lowered = s.lowercased()
    let kept = lowered.unicodeScalars.map { CharacterSet.letters.contains($0) || CharacterSet.decimalDigits.contains($0) ? Character($0) : " " }
    return String(kept).split(separator: " ").map(String.init)
}

func wordErrors(ref: [String], hyp: [String]) -> Int {
    if ref.isEmpty { return hyp.count }
    var prev = Array(0...hyp.count)
    for i in 1...ref.count {
        var cur = [i] + Array(repeating: 0, count: hyp.count)
        for j in stride(from: 1, through: hyp.count, by: 1) {
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ref[i - 1] == hyp[j - 1] ? 0 : 1))
        }
        prev = cur
    }
    return prev[hyp.count]
}

func percentile(_ xs: [Double], _ p: Double) -> Double {
    guard !xs.isEmpty else { return .nan }
    let s = xs.sorted()
    return s[min(s.count - 1, Int((Double(s.count - 1) * p).rounded()))]
}

// MARK: Main

let args = Array(CommandLine.arguments.dropFirst())
let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)

if args.first == "--report" {
    let dir = args.count > 1 ? URL(fileURLWithPath: (args[1] as NSString).expandingTildeInPath) : root.appendingPathComponent("results")
    try runReport(root: root, resultsDir: dir)
    exit(0)
}
if args.first == "--list-whisper" {
    for m in try await WhisperKit.fetchAvailableModels() { print(m) }
    exit(0)
}
guard let spec = args.first else {
    print("usage: stt-bench <parakeet-v3|parakeet-ultra|parakeet-unified|nemotron-unified|whisper:<model>|tcpp:<model>>[@lang][+vocab] | --list-whisper")
    exit(2)
}
// A "+vocab" suffix turns on each engine's own way to use the dictionary in vocab.txt.
let useVocab = spec.hasSuffix("+vocab")
let withoutVocab = useVocab ? String(spec.dropLast("+vocab".count)) : spec
// An "@pt" / "@en" / "@auto" suffix is the language hint (VoiceInk passes the person's chosen language).
let langParts = withoutVocab.split(separator: "@", maxSplits: 1).map(String.init)
let base = langParts[0]
let lang = langParts.count > 1 ? langParts[1] : nil
let vocabulary: [String]? = useVocab
    ? try String(contentsOf: root.appendingPathComponent("vocab.txt"), encoding: .utf8)
        .split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty && !$0.hasPrefix("#") }
    : nil
let engine: Engine
switch base {
case "parakeet-v3", "parakeet-ultra":
    let hint = lang.flatMap(Language.init(rawValue:))
    guard lang == nil || hint != nil else { print("unknown language \(lang!)"); exit(2) }
    engine = Parakeet(name: spec, version: base == "parakeet-v3" ? .v3 : .ultra, vocabulary: vocabulary, language: hint)
case "parakeet-unified":
    engine = Unified(name: spec, family: .parakeetEnglish, vocabulary: vocabulary)
case "nemotron-unified":
    guard let prompt = NemotronUnifiedLanguage(rawValue: lang ?? "auto") else { print("unknown language \(lang!)"); exit(2) }
    engine = Unified(name: spec, family: .nemotronMultilingual(prompt), vocabulary: vocabulary)
case _ where base.hasPrefix("whisper:"): engine = Whisper(model: String(base.dropFirst("whisper:".count)), vocabulary: vocabulary)
case _ where base.hasPrefix("tcpp:"):
    let key = String(base.dropFirst("tcpp:".count))
    guard let gguf = tcppCatalog[key] else { print("unknown transcribe.cpp model \(key): \(tcppCatalog.keys.sorted())"); exit(2) }
    let hint = lang == "auto" ? nil : lang
    guard hint != nil || !gguf.needsLanguage else { print("\(key) needs a language (@pt or @en)"); exit(2) }
    guard vocabulary == nil || key.hasPrefix("whisper") else { print("\(key) takes no prompt: +vocab is Whisper only"); exit(2) }
    engine = TranscribeCppEngine(name: spec, gguf: gguf, language: hint, vocabulary: vocabulary)
default:
    print("unknown engine \(spec)")
    exit(2)
}

// STT_AUDIO: where the clips are (default ./audio); STT_RESULTS: where the JSON goes (default ./results).
let env = ProcessInfo.processInfo.environment
let audioDir = env["STT_AUDIO"].map { URL(fileURLWithPath: ($0 as NSString).expandingTildeInPath) }
    ?? root.appendingPathComponent("audio", isDirectory: true)
let clips = try loadCorpus(root: root, audioDir: audioDir)
guard !clips.isEmpty else { print("no audio in \(audioDir.path): run ./gen-audio.sh or ./record.sh"); exit(1) }

// Load is timed twice: the first run downloads and compiles (cold), so only a second process gives the real
// startup cost. The app keeps the model loaded, so this only matters at launch.
let baseMB = physFootprintMB()
let t0 = now()
try await engine.load()
let loadSeconds = now() - t0
let loadedMB = physFootprintMB()

// Warm-up: the first inference pays for CoreML/ANE specialization.
let warmup = try readSamples(clips[0].file)
let tw = now()
_ = try await engine.transcribe(warmup)
let firstInference = now() - tw

struct Row: Encodable {
    let id, lang, size, ref, hyp: String
    let audioSeconds, latencySeconds, rtf: Double
    let errors, refWords: Int
}
var rows: [Row] = []
let cpu0 = cpuSeconds(), wall0 = now()
for clip in clips {
    let samples = try readSamples(clip.file)
    let t = now()
    let text = try await engine.transcribe(samples)
    let latency = now() - t
    let ref = normalize(clip.text)
    let audio = Double(samples.count) / 16_000
    rows.append(Row(id: clip.id, lang: clip.lang, size: clip.size, ref: clip.text, hyp: text,
                    audioSeconds: audio, latencySeconds: latency, rtf: latency / audio,
                    errors: wordErrors(ref: ref, hyp: normalize(text)), refWords: ref.count))
    print(String(format: "%-9@ %5.2fs  %@", clip.id, latency, text))
}
let cpuPercent = (cpuSeconds() - cpu0) / (now() - wall0) * 100

struct Summary: Encodable {
    let engine: String
    let loadSeconds, firstInferenceSeconds, baseMB, loadedMB, peakMB, cpuPercent: Double
    let latencyShortP50, latencyShortP90, latencyLongP50, rtfMedian: Double
    let werPT, werEN, werMix, werAll: Double
    let rows: [Row]
}
func wer(_ filter: (Row) -> Bool) -> Double {
    let r = rows.filter(filter)
    return Double(r.map(\.errors).reduce(0, +)) / Double(max(1, r.map(\.refWords).reduce(0, +))) * 100
}
let short = rows.filter { $0.size == "short" }.map(\.latencySeconds)
let long = rows.filter { $0.size == "long" }.map(\.latencySeconds)
let summary = Summary(
    engine: engine.name, loadSeconds: loadSeconds, firstInferenceSeconds: firstInference,
    baseMB: baseMB, loadedMB: loadedMB, peakMB: peakFootprintMB(), cpuPercent: cpuPercent,
    latencyShortP50: percentile(short, 0.5), latencyShortP90: percentile(short, 0.9),
    latencyLongP50: percentile(long, 0.5), rtfMedian: percentile(rows.map(\.rtf), 0.5),
    werPT: wer { $0.lang == "pt" }, werEN: wer { $0.lang == "en" }, werMix: wer { $0.lang == "mix" },
    werAll: wer { _ in true }, rows: rows)

let out = root.appendingPathComponent(env["STT_RESULTS"] ?? "results", isDirectory: true)
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
let safe = engine.name.replacingOccurrences(of: ":", with: "_")
try encoder.encode(summary).write(to: out.appendingPathComponent("\(safe).json"))
print(String(format: """
---
%@  load %.1fs  1st %.2fs  mem %.0f MB (peak %.0f)  cpu %.0f%%
short p50 %.2fs p90 %.2fs · long p50 %.2fs · RTF %.3f
WER pt %.1f%%  en %.1f%%  mix %.1f%%  all %.1f%%
""", engine.name, loadSeconds, firstInference, loadedMB - baseMB, peakFootprintMB(), cpuPercent,
       summary.latencyShortP50, summary.latencyShortP90, summary.latencyLongP50, summary.rtfMedian,
       summary.werPT, summary.werEN, summary.werMix, summary.werAll))
// transcribe.cpp's Metal backend asserts in its exit-time teardown (ggml-metal-device.m:622, residency sets);
// everything is written by now, so leave without running it.
fflush(stdout)
_exit(0)
