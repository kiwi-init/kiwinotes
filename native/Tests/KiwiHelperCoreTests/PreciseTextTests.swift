import XCTest
@testable import KiwiHelperCore

final class PreciseTextTests: XCTestCase {
    func testPromptJoinsTheTermsWithCommas() {
        XCTAssertEqual(WhisperPrompt.make(["ORBIT", " SILO ", "", "Atlas API"]), "ORBIT, SILO, Atlas API")
        XCTAssertNil(WhisperPrompt.make([]))
        XCTAssertNil(WhisperPrompt.make(["  ", ""]))
    }

    func testPromptStopsBeforeTheLimitWithoutCuttingATerm() {
        XCTAssertEqual(WhisperPrompt.make(["abcd", "efgh", "ijkl"], limit: 12), "abcd, efgh")
        XCTAssertNil(WhisperPrompt.make(["um termo comprido demais"], limit: 5))
        let many = (1...300).map { "termo\($0)" }
        let prompt = WhisperPrompt.make(many)!
        XCTAssertLessThanOrEqual(prompt.count, WhisperPrompt.maxCharacters)
        XCTAssertTrue(prompt.hasPrefix("termo1, termo2, "))
    }

    /// O chiado de 4 s que virou o prompt no modo preciso, e o que o ADR 0003 viu com o turbo.
    func testEchoOfThePromptIsCaught() {
        let terms = ["ORBIT", "ORBIT store", "SILO", "FIND", "PUSH-RS", "T-SCAN", "service account"]
        XCTAssertTrue(WhisperPrompt.echoes("FIND, PUSH-RS, T-SCAN.", terms: terms))
        XCTAssertTrue(WhisperPrompt.echoes("ORBIT STORE, SILO, SERVICE ACCOUNT", terms: terms))
        XCTAssertFalse(WhisperPrompt.echoes("O SILO antigo não respondeu o T-SCAN de novo.", terms: terms))
        XCTAssertFalse(WhisperPrompt.echoes("OK.", terms: terms))
        XCTAssertFalse(WhisperPrompt.echoes("", terms: terms))
        XCTAssertFalse(WhisperPrompt.echoes("FIND", terms: []))
    }

    /// A gravação de voz real em que o Whisper entrou em loop (mix05, 1ª tomada).
    func testCollapsesTheLoopFromTheRealVoiceRound() {
        XCTAssertEqual(RepetitionGuard.collapse("Precisa liberar o bucket no IAM para o serviço, para o serviço, para o serviço sacado"),
                       "Precisa liberar o bucket no IAM para o serviço sacado")
    }

    func testCollapsesALongLoopAtTheEnd() {
        let loop = Array(repeating: "e depois o deploy", count: 6).joined(separator: " ")
        XCTAssertEqual(RepetitionGuard.collapse("Roda os testes \(loop)"), "Roda os testes e depois o deploy")
    }

    func testKeepsWhatPeopleReallySay() {
        for text in [
            "não, não, não, isso não",
            "muito muito bom",
            "o SILO do SILO antigo",
            "de novo e de novo",
            "Can you send me the meeting notes after lunch?",
            "",
        ] {
            XCTAssertEqual(RepetitionGuard.collapse(text), text.split(whereSeparator: \.isWhitespace).joined(separator: " "), text)
        }
    }

    func testShortSpeechGoesThroughParakeet() {
        let rate = 16_000
        let quiet = [Float](repeating: 0.001, count: rate / 2)
        let tone = (0..<rate).map { Float(sin(Double($0) * 0.1) * 0.2) }
        XCTAssertEqual(PreciseRoute.speechSeconds(quiet + tone + quiet), 1.0, accuracy: 0.02)
        XCTAssertTrue(PreciseRoute.usesWhisper(quiet + tone + quiet))
        XCTAssertFalse(PreciseRoute.usesWhisper(quiet + Array(tone.prefix(rate * 7 / 10)) + quiet + quiet))
        XCTAssertEqual(PreciseRoute.speechSeconds(quiet), 0)
        XCTAssertEqual(PreciseRoute.speechSeconds([]), 0)
        XCTAssertFalse(PreciseRoute.usesWhisper([]))
    }

    /// T7454: um bipe tem som, mas não tem fala. Pela energia, 2 s de 440 Hz iam ao Whisper, que inventava texto;
    /// com o VAD, só um segundo de fala de verdade leva ao Whisper. Sem o VAD, a regra da energia continua.
    func testSoundWithoutSpeechGoesThroughParakeet() {
        let rate = 16_000
        let beep = (0..<rate * 2).map { Float(sin(2 * Double.pi * 440 * Double($0) / Double(rate)) * 0.3) }
        XCTAssertTrue(PreciseRoute.usesWhisper(beep), "a regra da energia vê 2 s de som")
        XCTAssertFalse(PreciseRoute.usesWhisper(beep, vadSpeechSeconds: 0), "o VAD não acha fala no bipe")
        XCTAssertFalse(PreciseRoute.usesWhisper(beep, vadSpeechSeconds: 0.6), "menos de um segundo de fala")
        XCTAssertTrue(PreciseRoute.usesWhisper(beep, vadSpeechSeconds: 1.4), "um segundo de fala ou mais")
        XCTAssertTrue(PreciseRoute.usesWhisper(beep, vadSpeechSeconds: nil), "sem o VAD, vale a energia")
        XCTAssertFalse(PreciseRoute.usesWhisper([], vadSpeechSeconds: nil))
    }

    func testOneWordNeedsFiveRepeats() {
        XCTAssertEqual(RepetitionGuard.collapse("obrigado obrigado obrigado obrigado obrigado."), "obrigado.")
        XCTAssertEqual(RepetitionGuard.collapse("sim sim sim sim"), "sim sim sim sim")
    }
}
