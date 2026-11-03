import XCTest
@testable import KiwiHelperCore

final class LeadingSpaceTests: XCTestCase {
    private func spaced(_ before: String?, _ text: String = "Manda para o meu e-mail.") -> Bool {
        LeadingSpace.needed(before: before, text: text)
    }

    func testAfterTextItGetsASpace() {
        // harry's test (#731): "…sem acesso.Manda para o meu e-mail."
        XCTAssertTrue(spaced("o."))
        XCTAssertTrue(spaced("ha"))
        XCTAssertTrue(spaced("10"))
        XCTAssertTrue(spaced("!?"))
        XCTAssertTrue(spaced("a)"))
        XCTAssertTrue(spaced("o:"))
        XCTAssertTrue(spaced("…,"))
    }

    func testNoSpaceAtTheStartAfterASpaceOrALineBreak() {
        XCTAssertFalse(spaced(""), "start of the field")
        XCTAssertFalse(spaced("o "))
        XCTAssertFalse(spaced(".\n"), "a new line (\"primeira linha nova linha\")")
        XCTAssertFalse(spaced("a\t"))
        XCTAssertFalse(spaced("x\u{00A0}"), "no-break space")
    }

    func testUnreadableFieldIsLeftAsBefore() {
        XCTAssertFalse(spaced(nil))
    }

    func testOpeningCharactersTakeNoSpace() {
        for before in ["a(", " [", "«", "“", "x/", "@", "#", "¿"] {
            XCTAssertFalse(spaced(before), before)
        }
    }

    func testStraightQuotesOpenOrClose() {
        XCTAssertFalse(spaced(" \""), "ele disse \"| opens")
        XCTAssertFalse(spaced("\""), "at the start it opens")
        XCTAssertFalse(spaced("(\""), "after an opening bracket it opens")
        XCTAssertTrue(spaced(".\""), "\"Oi.\"| closes")
        XCTAssertTrue(spaced("s'"), "a closing ' too")
    }

    func testTextThatAttachesToWhatCameBefore() {
        XCTAssertFalse(spaced("o", ", e depois a gente vê"))
        XCTAssertFalse(spaced("o", "."))
        XCTAssertFalse(spaced("o", ")"))
        XCTAssertFalse(spaced("o", " já com espaço"))
        XCTAssertFalse(spaced("o", ""))
    }

    func testTailFromTheWholeValue() {
        XCTAssertEqual(LeadingSpace.tail(of: "sem acesso.", caret: 11), "o.")
        XCTAssertEqual(LeadingSpace.tail(of: "sem acesso.", caret: 4), "m ")
        XCTAssertEqual(LeadingSpace.tail(of: "a", caret: 1), "a")
        XCTAssertEqual(LeadingSpace.tail(of: "abc", caret: 0), "")
        XCTAssertNil(LeadingSpace.tail(of: "abc", caret: 4))
        // UTF-16, as Accessibility counts: the emoji is two units.
        XCTAssertEqual(LeadingSpace.tail(of: "ok 🥝", caret: 5), "🥝")
        XCTAssertEqual(LeadingSpace.tail(of: "é.", caret: 2), "é.")
    }
}
