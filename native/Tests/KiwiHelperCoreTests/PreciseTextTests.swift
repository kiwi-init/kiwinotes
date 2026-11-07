import XCTest
@testable import KiwiHelperCore

final class PreciseTextTests: XCTestCase {
    func testPromptJoinsTheTermsWithCommas() {
        XCTAssertEqual(WhisperPrompt.make(["DICOM", " PACS ", "", "Healthcare API"]), "DICOM, PACS, Healthcare API")
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
        let terms = ["DICOM", "DICOM store", "PACS", "QIDO", "STOW-RS", "C-FIND", "service account"]
        XCTAssertTrue(WhisperPrompt.echoes("QIDO, STOW-RS, C-FIND.", terms: terms))
        XCTAssertTrue(WhisperPrompt.echoes("DICOM STORE, PACS, SERVICE ACCOUNT", terms: terms))
        XCTAssertFalse(WhisperPrompt.echoes("O PACS legado não respondeu o C-FIND de novo.", terms: terms))
        XCTAssertFalse(WhisperPrompt.echoes("OK.", terms: terms))
        XCTAssertFalse(WhisperPrompt.echoes("", terms: terms))
        XCTAssertFalse(WhisperPrompt.echoes("QIDO", terms: []))
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
            "o PACS do PACS legado",
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

    func testOneWordNeedsFiveRepeats() {
        XCTAssertEqual(RepetitionGuard.collapse("obrigado obrigado obrigado obrigado obrigado."), "obrigado.")
        XCTAssertEqual(RepetitionGuard.collapse("sim sim sim sim"), "sim sim sim sim")
    }
}
