import Foundation
import XCTest
@testable import KiwiHelperCore

final class SpellingTests: XCTestCase {
    func testValidWordAndLanguageReachOnlyTheInjectedChecker() throws {
        var received: [String] = []
        let result = try XCTUnwrap(LocalSpelling.check("reuniao", language: "pt-BR") { word, language in
            received = [word, language ?? ""]
            return SpellingResult(available: true, misspelled: true, suggestions: ["reunião"])
        })
        XCTAssertEqual(received, ["reuniao", "pt-BR"])
        XCTAssertEqual(result.suggestions, ["reunião"])
    }
    func testInvalidOrLongWordsNeverReachTheChecker() {
        var calls = 0
        for word in ["", "duas palavras", "abc123", "https://exemplo", "erro\n", "erro\ntexto", String(repeating: "a", count: 129)] {
            XCTAssertNil(LocalSpelling.check(word) { _, _ in calls += 1; return .unavailable }, word)
        }
        XCTAssertEqual(calls, 0)
    }
    func testInvalidLanguageNeverReachesTheChecker() {
        var calls = 0
        for language in ["", "pt-BR\n", "../pt", "a", String(repeating: "a", count: 33)] {
            XCTAssertNil(LocalSpelling.check("palavra", language: language) { _, _ in calls += 1; return .unavailable }, language)
        }
        XCTAssertEqual(calls, 0)
    }
    func testSuggestionsAreBoundedDeduplicatedAndCannotInjectControlCharacters() throws {
        let values = ["reuniao", "reunião", "reunião", "", "ruim\nlinha", "ruim\u{2028}linha", String(repeating: "a", count: 129)] + (0..<20).map { "opção\($0)" }
        let result = try XCTUnwrap(LocalSpelling.check("reuniao") { _, _ in SpellingResult(available: true, misspelled: true, suggestions: values) })
        XCTAssertEqual(result.suggestions.first, "reunião")
        XCTAssertEqual(result.suggestions.count, 8)
        XCTAssertFalse(result.suggestions.contains(where: { $0.contains("\n") || $0.contains("\u{2028}") }))
    }
    func testCorrectWordsAndUnavailableCheckersDoNotOfferCorrections() throws {
        let correct = try XCTUnwrap(LocalSpelling.check("palavra") { _, _ in SpellingResult(available: true, misspelled: false, suggestions: ["outra"]) })
        XCTAssertTrue(correct.available); XCTAssertFalse(correct.misspelled); XCTAssertEqual(correct.suggestions, [])
        let unavailable = try XCTUnwrap(LocalSpelling.check("palavra") { _, _ in SpellingResult(available: false, misspelled: true, suggestions: ["outra"]) })
        XCTAssertEqual(unavailable, .unavailable)
    }
    func testUnicodeCombiningMarksAndApostrophesAreAccepted() {
        for word in ["reunião", "reunia\u{303}o", "d'água", "guarda-chuva"] {
            XCTAssertNotNil(LocalSpelling.check(word) { _, _ in .unavailable })
        }
    }
}
