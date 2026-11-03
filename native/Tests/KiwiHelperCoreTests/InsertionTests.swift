import AppKit
import XCTest
@testable import KiwiHelperCore

final class InsertionTests: XCTestCase {
    func testPlan() {
        let field = FocusInfo(role: "AXTextArea", hasSelectedTextRange: true)
        XCTAssertEqual(InsertPlan.decide(accessibilityGranted: false, focus: field), .clipboardOnly(reason: "no_accessibility"))
        XCTAssertEqual(InsertPlan.decide(accessibilityGranted: true, focus: nil), .clipboardOnly(reason: "no_focus"))
        XCTAssertEqual(InsertPlan.decide(accessibilityGranted: true, focus: FocusInfo(role: nil, hasSelectedTextRange: false)),
                       .clipboardOnly(reason: "no_focus"))
        XCTAssertEqual(InsertPlan.decide(accessibilityGranted: true, focus: field), .paste)
        // Electron editors and terminals show up as groups or web areas: paste anyway.
        XCTAssertEqual(InsertPlan.decide(accessibilityGranted: true, focus: FocusInfo(role: "AXGroup", hasSelectedTextRange: false)), .paste)
        XCTAssertEqual(InsertPlan.decide(accessibilityGranted: true, focus: FocusInfo(role: "AXWebArea", hasSelectedTextRange: false)), .paste)
        XCTAssertEqual(InsertPlan.decide(accessibilityGranted: true, focus: FocusInfo(role: "AXButton", hasSelectedTextRange: false)),
                       .clipboardOnly(reason: "no_text_field"))
        // A caret beats the role (a combo box or a custom control that takes text).
        XCTAssertEqual(InsertPlan.decide(accessibilityGranted: true, focus: FocusInfo(role: "AXButton", hasSelectedTextRange: true)), .paste)
    }

    private func scratchPasteboard() -> NSPasteboard {
        NSPasteboard(name: NSPasteboard.Name("kiwi-test-\(UUID().uuidString)"))
    }

    func testClipboardRoundTripKeepsEveryItemAndType() {
        let pb = scratchPasteboard()
        defer { pb.releaseGlobally() }
        let a = NSPasteboardItem()
        a.setString("texto da pessoa", forType: .string)
        a.setString("<b>texto</b>", forType: .html)
        let b = NSPasteboardItem()
        b.setData(Data([0x89, 0x50, 0x4E, 0x47]), forType: .png)
        pb.clearContents()
        pb.writeObjects([a, b])

        let snapshot = ClipboardSnapshot.take(pb)
        let ours = ClipboardSnapshot.put("ditado", on: pb, transient: true)
        XCTAssertEqual(pb.string(forType: .string), "ditado")
        XCTAssertNotNil(pb.data(forType: ClipboardSnapshot.transient), "clipboard managers can skip it")

        XCTAssertTrue(snapshot.restore(to: pb, ifStill: ours))
        let items = pb.pasteboardItems ?? []
        XCTAssertEqual(items.count, 2)
        XCTAssertEqual(items[0].string(forType: .string), "texto da pessoa")
        XCTAssertEqual(items[0].string(forType: .html), "<b>texto</b>")
        XCTAssertEqual(items[1].data(forType: .png), Data([0x89, 0x50, 0x4E, 0x47]))
    }

    func testANewCopyDuringThePasteWins() {
        let pb = scratchPasteboard()
        defer { pb.releaseGlobally() }
        pb.clearContents()
        pb.setString("antigo", forType: .string)
        let snapshot = ClipboardSnapshot.take(pb)
        let ours = ClipboardSnapshot.put("ditado", on: pb, transient: true)
        pb.clearContents()
        pb.setString("copiado agora", forType: .string) // the person pressed ⌘C meanwhile
        XCTAssertFalse(snapshot.restore(to: pb, ifStill: ours))
        XCTAssertEqual(pb.string(forType: .string), "copiado agora")
    }

    func testEmptyClipboardStaysEmpty() {
        let pb = scratchPasteboard()
        defer { pb.releaseGlobally() }
        pb.clearContents()
        let snapshot = ClipboardSnapshot.take(pb)
        let ours = ClipboardSnapshot.put("ditado", on: pb, transient: true)
        XCTAssertTrue(snapshot.restore(to: pb, ifStill: ours))
        XCTAssertNil(pb.string(forType: .string), "the dictation doesn't stay behind")
    }
}
