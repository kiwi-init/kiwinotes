import XCTest
@testable import KiwiHelperCore

/// #7082: o ditado longo do modo preciso em pedaços de até 28 s, com a guarda de eco e o Parakeet em cada um.
final class PreciseChunksTests: XCTestCase {
    private let rate = 16_000

    /// Fala (um tom) com chiado de fundo e pausas (só o chiado) nos segundos dados.
    private func speech(seconds: Double, pausesAt: [Double] = [], pause: Double = 0.4, noise: Float = 0.014) -> [Float] {
        var seed: UInt64 = 1
        return (0..<Int(seconds * Double(rate))).map { i in
            seed = seed &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            let hiss = (Float(seed >> 40) / Float(1 << 24) - 0.5) * 2 * noise
            let t = Double(i) / Double(rate)
            let quiet = pausesAt.contains { t >= $0 && t < $0 + pause }
            return hiss + (quiet ? 0 : Float(sin(Double(i) * 0.1)) * 0.05)
        }
    }

    func testAShortDictationIsOneChunk() {
        XCTAssertEqual(PreciseChunks.split([]), [0..<0])
        let samples = speech(seconds: 28)
        XCTAssertEqual(PreciseChunks.split(samples), [0..<samples.count])
    }

    func testALongDictationIsCutAtThePauses() {
        let samples = speech(seconds: 71, pausesAt: [5, 22, 31, 47, 66])
        let chunks = PreciseChunks.split(samples)
        XCTAssertEqual(chunks.count, 3)
        XCTAssertEqual(chunks.first?.lowerBound, 0)
        XCTAssertEqual(chunks.last?.upperBound, samples.count)
        for (a, b) in zip(chunks, chunks.dropFirst()) { XCTAssertEqual(a.upperBound, b.lowerBound) }
        for c in chunks { XCTAssertLessThanOrEqual(Double(c.count) / Double(rate), PreciseChunks.maxSeconds) }
        // Na pausa dos 22 s (a única entre 14 e 28 s) e, 28 s depois dela no máximo, na dos 47 s.
        XCTAssertEqual(Double(chunks[0].upperBound) / Double(rate), 22.2, accuracy: 0.25)
        XCTAssertEqual(Double(chunks[1].upperBound) / Double(rate), 47.2, accuracy: 0.25)
    }

    func testWithoutAPauseTheCutStillKeepsEveryChunkUnderTheLimit() {
        let samples = speech(seconds: 28.5)
        let chunks = PreciseChunks.split(samples)
        XCTAssertEqual(chunks.count, 2)
        XCTAssertEqual(chunks[0].upperBound, chunks[1].lowerBound)
        XCTAssertGreaterThanOrEqual(Double(chunks[1].count) / Double(rate), PreciseChunks.minTailSeconds - 0.05)
        XCTAssertLessThanOrEqual(Double(chunks[0].count) / Double(rate), PreciseChunks.maxSeconds)
    }

    /// O que saiu no clipe de 71 s com ruído, e no histórico do harry: o prompt e depois o fim da fala.
    func testTheEchoAtTheStartComesOut() {
        let terms = ["DICOM", "PACS", "Kiwi Notes"]
        XCTAssertEqual(WhisperPrompt.withoutEcho("DICOM, PACS, Kiwi Notes do paciente, sempre que possível.", terms: terms),
                       "do paciente, sempre que possível.")
        XCTAssertEqual(WhisperPrompt.withoutEcho("DICOM, PACS, Kiwi Notes.", terms: terms), "")
        XCTAssertEqual(WhisperPrompt.withoutEcho("PACS, Kiwi Notes. E depois o resto.", terms: terms), "E depois o resto.")
        // Uma fala que começa por um ou dois termos não é eco.
        for said in ["DICOM é um padrão de imagens.", "O DICOM, PACS, Kiwi Notes.", "DICOM, PACS caíram de novo.", "Bom dia.", ""] {
            XCTAssertEqual(WhisperPrompt.withoutEcho(said, terms: terms), said)
        }
        XCTAssertEqual(WhisperPrompt.withoutEcho("DICOM caiu.", terms: ["DICOM"]), "DICOM caiu.")
        XCTAssertEqual(WhisperPrompt.withoutEcho("Bom dia.", terms: []), "Bom dia.")
    }

    func testTooShortForTheVoiceInTheChunk() {
        let noisy = speech(seconds: 20, pausesAt: [3, 9, 15], pause: 1)
        XCTAssertEqual(PreciseChunks.voicedSeconds(noisy), 17, accuracy: 0.5)
        XCTAssertEqual(PreciseChunks.voicedSeconds(speech(seconds: 20, pausesAt: [3, 9, 15], pause: 1, noise: 0)), 17, accuracy: 0.5)
        XCTAssertTrue(PreciseChunks.tooShort("", for: noisy))
        XCTAssertTrue(PreciseChunks.tooShort("do paciente, sempre que possível.", for: noisy))
        XCTAssertFalse(PreciseChunks.tooShort(String(repeating: "uma fala normal. ", count: 12), for: noisy))
        // Pouca voz: um "ok" é curto e está certo.
        XCTAssertFalse(PreciseChunks.tooShort("Ok.", for: speech(seconds: 2)))
        XCTAssertFalse(PreciseChunks.tooShort("", for: [Float](repeating: 0.001, count: rate * 5)))
    }

    /// Conta as chamadas: o que cada motor recebeu.
    private final class Calls: @unchecked Sendable {
        var whisper: [(seconds: Double, terms: [String])] = []
        var parakeet: [Double] = []
        var log: [String] = []
    }

    private func run(_ samples: [Float], terms: [String] = ["DICOM", "PACS", "Kiwi Notes"], calls: Calls,
                     whisper: @escaping (Int, [String]) throws -> String, parakeet: String = "o texto do parakeet para este pedaço inteiro de fala") async -> String? {
        await PreciseChunks.transcribe(samples, terms: terms,
            whisper: { chunk, terms in
                calls.whisper.append((Double(chunk.count) / 16_000, terms))
                return try whisper(calls.whisper.count, terms)
            },
            parakeet: { chunk in
                calls.parakeet.append(Double(chunk.count) / 16_000)
                return parakeet
            },
            log: { calls.log.append($0) })
    }

    private let long = String(repeating: "uma fala normal e comprida. ", count: 8).trimmingCharacters(in: .whitespaces)

    func testAShortDictationGoesWholeAsBefore() async {
        let samples = speech(seconds: 10)
        var calls = Calls()
        var text = await run(samples, calls: calls) { _, _ in "Bom dia." }
        XCTAssertEqual(text, "Bom dia.")
        XCTAssertEqual(calls.whisper.count, 1)
        XCTAssertEqual(calls.whisper[0].seconds, 10, accuracy: 0.01)
        XCTAssertEqual(calls.whisper[0].terms, ["DICOM", "PACS", "Kiwi Notes"])
        XCTAssertTrue(calls.parakeet.isEmpty)
        // Só o prompt, ou o Whisper que falha: o ditado inteiro vai pelo Parakeet (nil), como antes.
        calls = Calls()
        text = await run(samples, calls: calls) { _, _ in "DICOM, PACS." }
        XCTAssertNil(text)
        text = await run(samples, calls: calls) { _, _ in throw CancellationError() }
        XCTAssertNil(text)
        XCTAssertEqual(calls.whisper.count, 2)
        XCTAssertTrue(calls.parakeet.isEmpty)
    }

    func testALongDictationGoesChunkByChunkInOrder() async {
        let samples = speech(seconds: 71, pausesAt: [22, 47])
        let calls = Calls()
        let text = await run(samples, calls: calls) { n, _ in "Parte \(n), \(self.long)" }
        XCTAssertEqual(text, "Parte 1, \(long) Parte 2, \(long) Parte 3, \(long)")
        XCTAssertEqual(calls.whisper.count, 3)
        XCTAssertEqual(calls.whisper.map(\.seconds).reduce(0, +), 71, accuracy: 0.01)
        for call in calls.whisper { XCTAssertLessThanOrEqual(call.seconds, PreciseChunks.maxSeconds) }
        XCTAssertTrue(calls.parakeet.isEmpty)
    }

    func testTheEchoComesOutOfEachChunkAndAnEchoOnlyChunkGoesAgainWithoutThePrompt() async {
        let samples = speech(seconds: 71, pausesAt: [22, 47])
        let calls = Calls()
        let text = await run(samples, calls: calls) { n, terms in
            switch n {
            case 1: return "DICOM, PACS, Kiwi Notes \(self.long)"
            case 2: return "DICOM, PACS, Kiwi Notes." // o pedaço 2, com o prompt
            case 3: return terms.isEmpty ? "Sem prompt, \(self.long)" : "errado"
            default: return "Fim, \(self.long)"
            }
        }
        XCTAssertEqual(text, "\(long) Sem prompt, \(long) Fim, \(long)")
        XCTAssertEqual(calls.whisper.map { $0.terms.isEmpty }, [false, false, true, false])
        XCTAssertEqual(calls.whisper[1].seconds, calls.whisper[2].seconds)
        XCTAssertTrue(calls.parakeet.isEmpty)
    }

    func testAnEmptyOrShortChunkFallsToParakeet() async {
        let samples = speech(seconds: 71, pausesAt: [22, 47])
        let calls = Calls()
        let text = await run(samples, calls: calls) { n, _ in
            switch n {
            case 1: return ""
            case 2: throw CancellationError()
            default: return "do paciente." // curto demais para ~24 s de voz
            }
        }
        let parakeet = "o texto do parakeet para este pedaço inteiro de fala"
        XCTAssertEqual(text, [parakeet, parakeet, parakeet].joined(separator: " "))
        XCTAssertEqual(calls.parakeet.count, 3)
        XCTAssertEqual(calls.parakeet.reduce(0, +), 71, accuracy: 0.01)
    }

    func testAShortChunkKeepsTheWhisperTextWhenParakeetHasLess() async {
        let samples = speech(seconds: 40, pausesAt: [20])
        let calls = Calls()
        let text = await run(samples, calls: calls, whisper: { n, _ in n == 1 ? "do paciente." : self.long }, parakeet: "")
        XCTAssertEqual(text, "do paciente. \(long)")
        XCTAssertEqual(calls.parakeet.count, 1)
        // Nada de ninguém: o ditado inteiro vai pelo caminho do Parakeet, que responde o vazio do jeito dele.
        let none = await run(samples, calls: Calls(), whisper: { _, _ in "" }, parakeet: "")
        XCTAssertNil(none)
    }
}
