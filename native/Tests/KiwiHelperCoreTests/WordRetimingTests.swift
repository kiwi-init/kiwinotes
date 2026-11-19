import XCTest
@testable import KiwiHelperCore

final class WordRetimingTests: XCTestCase {
    typealias W = (text: String, start: Double, end: Double, firmAt: Double?)
    let words: [W] = [("a", 0, 1, 0.5), ("vila", 1, 2, nil), ("serena", 2, 3, nil), ("abriu", 3, 4, 3.5)]

    private func shape(_ out: [W]) -> [String] { out.map { "\($0.text)@\($0.start)-\($0.end)" } }

    func testSameTextKeepsEveryTime() {
        let out = WordRetiming.retimed(words, as: "a vila serena abriu")
        XCTAssertEqual(shape(out), ["a@0.0-1.0", "vila@1.0-2.0", "serena@2.0-3.0", "abriu@3.0-4.0"])
        XCTAssertEqual(out.map(\.firmAt), [0.5, nil, nil, 3.5])
    }

    func testCaseAndPunctuationStillMatch() {
        XCTAssertEqual(shape(WordRetiming.retimed(words, as: "A vila serena abriu.")),
                       ["A@0.0-1.0", "vila@1.0-2.0", "serena@2.0-3.0", "abriu.@3.0-4.0"])
    }

    func testReplacedWordsSplitTheSpanTheyReplaced() {
        // "bila cerena" vira "Vila Serena Norte": as três dividem o trecho de 1 a 3, o das duas que saíram dali.
        let out = WordRetiming.retimed([("a", 0, 1, nil), ("bila", 1, 2, nil), ("cerena", 2, 3, nil), ("abriu", 3, 4, nil)],
                                       as: "a Vila Serena Norte abriu")
        XCTAssertEqual(shape(out), ["a@0.0-1.0", "Vila@1.0-1.6666666666666665", "Serena@1.6666666666666665-2.333333333333333",
                                    "Norte@2.333333333333333-3.0", "abriu@3.0-4.0"])
        XCTAssertEqual(out.map(\.firmAt), [nil, nil, nil, nil, nil])
    }

    func testInsertedWordSitsAtThePointBetweenNeighbours() {
        let out = WordRetiming.retimed([("a", 0, 1, nil), ("abriu", 3, 4, nil)], as: "a loja abriu")
        XCTAssertEqual(shape(out), ["a@0.0-1.0", "loja@1.0-1.0", "abriu@3.0-4.0"])
    }

    func testRemovedWordsLeaveTheOthersInPlace() {
        XCTAssertEqual(shape(WordRetiming.retimed(words, as: "a abriu")), ["a@0.0-1.0", "abriu@3.0-4.0"])
    }

    func testEmptyInputs() {
        XCTAssertTrue(WordRetiming.retimed([], as: "").isEmpty)
        XCTAssertEqual(shape(WordRetiming.retimed([], as: "oi")), ["oi@0.0-0.0"])
        XCTAssertTrue(WordRetiming.retimed(words, as: "").isEmpty)
    }
}
