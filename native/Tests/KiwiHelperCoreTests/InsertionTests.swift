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
        // A button: the paste still goes, and the text stays on the clipboard in case it lands nowhere (T984).
        XCTAssertEqual(InsertPlan.decide(accessibilityGranted: true, focus: FocusInfo(role: "AXButton", hasSelectedTextRange: false)),
                       .pasteKeepingText(reason: "no_text_field"))
        // An app too busy to answer Accessibility still has focus somewhere: paste.
        XCTAssertEqual(InsertPlan.decide(accessibilityGranted: true, focus: .unanswered), .paste)
        // Secure input may drop a synthetic ⌘V: paste anyway, but leave the text on the clipboard.
        XCTAssertEqual(InsertPlan.decide(accessibilityGranted: true, secureInput: true, focus: field), .pasteKeepingText(reason: "secure_input"))
        // No field still wins over secure input.
        XCTAssertEqual(InsertPlan.decide(accessibilityGranted: true, secureInput: true, focus: nil), .clipboardOnly(reason: "no_focus"))
        // A caret beats the role (a combo box or a custom control that takes text).
        XCTAssertEqual(InsertPlan.decide(accessibilityGranted: true, focus: FocusInfo(role: "AXButton", hasSelectedTextRange: true)), .paste)
    }

    /// T984, harry's #978: in the new Teams (a WebView) the dictation didn't go in. With an app in front, the paste
    /// goes whatever Accessibility shows: a web area or a group get the normal paste; no focused element, or a focus
    /// with no role, get it too but keep the text on the clipboard, since that also covers the desktop or an app with
    /// no window, where the ⌘V lands nowhere (review #1007).
    func testWebViewAppsGetThePaste() {
        let seen: [FocusInfo] = [
            FocusInfo(role: "AXWebArea", hasSelectedTextRange: false),
            FocusInfo(role: "AXGroup", hasSelectedTextRange: false),
            FocusInfo(role: "AXWebArea", hasSelectedTextRange: true),
            .unanswered,
        ]
        for focus in seen {
            XCTAssertEqual(InsertPlan.decide(accessibilityGranted: true, focus: focus, frontApp: true), .paste, "\(focus)")
        }
        for focus in [nil, FocusInfo(role: nil, hasSelectedTextRange: false)] as [FocusInfo?] {
            XCTAssertEqual(InsertPlan.decide(accessibilityGranted: true, focus: focus, frontApp: true),
                           .pasteKeepingText(reason: "no_focus"), "\(String(describing: focus))")
        }
        // Secure input still keeps the text on the clipboard, whatever the focus.
        for focus in seen + [nil] as [FocusInfo?] {
            XCTAssertEqual(InsertPlan.decide(accessibilityGranted: true, secureInput: true, focus: focus, frontApp: true),
                           .pasteKeepingText(reason: "secure_input"))
        }
        // Nothing in front (the desktop): the text waits on the clipboard, as before.
        XCTAssertEqual(InsertPlan.decide(accessibilityGranted: true, focus: nil, frontApp: false), .clipboardOnly(reason: "no_focus"))
        // Without Accessibility there is no ⌘V at all.
        XCTAssertEqual(InsertPlan.decide(accessibilityGranted: false, focus: nil, frontApp: true), .clipboardOnly(reason: "no_accessibility"))
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

    func testTwoDictationsInARowGiveTheOriginalBack() {
        let pb = scratchPasteboard()
        defer { pb.releaseGlobally() }
        pb.clearContents()
        pb.setString("da pessoa", forType: .string)
        let keeper = ClipboardKeeper()
        let first = keeper.put("ditado 1", on: pb, keepOriginal: true)
        let second = keeper.put("ditado 2", on: pb, keepOriginal: true) // before the first restore
        XCTAssertFalse(keeper.restore(on: pb, ifStill: first), "a later dictation took over")
        XCTAssertEqual(pb.string(forType: .string), "ditado 2")
        XCTAssertTrue(keeper.restore(on: pb, ifStill: second))
        XCTAssertEqual(pb.string(forType: .string), "da pessoa")
    }

    func testKeeperLetsANewCopyWin() {
        let pb = scratchPasteboard()
        defer { pb.releaseGlobally() }
        pb.clearContents()
        pb.setString("antigo", forType: .string)
        let keeper = ClipboardKeeper()
        let ours = keeper.put("ditado", on: pb, keepOriginal: true)
        pb.clearContents()
        pb.setString("copiado agora", forType: .string)
        // The next dictation snapshots the new copy, not the old one.
        let next = keeper.put("ditado 2", on: pb, keepOriginal: true)
        XCTAssertFalse(keeper.restore(on: pb, ifStill: ours))
        XCTAssertTrue(keeper.restore(on: pb, ifStill: next))
        XCTAssertEqual(pb.string(forType: .string), "copiado agora")
    }

    func testTextThatStaysDropsThePendingRestore() {
        let pb = scratchPasteboard()
        defer { pb.releaseGlobally() }
        pb.clearContents()
        pb.setString("da pessoa", forType: .string)
        let keeper = ClipboardKeeper()
        let first = keeper.put("ditado 1", on: pb, keepOriginal: true)
        keeper.put("sem campo", on: pb, keepOriginal: false) // no_focus: the text stays for the person
        XCTAssertFalse(keeper.restore(on: pb, ifStill: first))
        XCTAssertEqual(pb.string(forType: .string), "sem campo")
        XCTAssertNil(pb.data(forType: ClipboardSnapshot.transient), "clipboard managers keep it")
        XCTAssertEqual(pb.string(forType: ClipboardSnapshot.source), ClipboardSnapshot.sourceID)
    }
}

/// L11 (T5834): the clipboard comes back once the app in front read the text, not after a fixed 2 s.
final class ClipboardReadTests: XCTestCase {
    func testTheRestoreFollowsTheReadAfterThePaste() {
        var s = RestoreSchedule()
        XCTAssertNil(s.restoreAt, "nothing before the ⌘V")
        s.pasted(at: 10)
        XCTAssertEqual(s.restoreAt, 12, "nobody read yet: the old 2 s")
        XCTAssertTrue(s.read(at: 10.4))
        XCTAssertEqual(s.restoreAt!, 10.55, accuracy: 1e-9, "read: a short grace after it")
        XCTAssertTrue(s.read(at: 10.5), "Electron reads twice: the later read counts")
        XCTAssertEqual(s.restoreAt!, 10.65, accuracy: 1e-9)
    }

    func testAReadBeforeThePasteIsAClipboardManagerAndDoesntCount() {
        var s = RestoreSchedule()
        XCTAssertFalse(s.read(at: 9.9))
        s.pasted(at: 10)
        XCTAssertEqual(s.restoreAt, 12)
    }

    func testNeverRightOnTopOfThePasteNorLaterThanTheOld2s() {
        var fast = RestoreSchedule()
        fast.pasted(at: 10)
        fast.read(at: 10.01)
        XCTAssertEqual(fast.restoreAt!, 10.25, accuracy: 1e-9, "the app may still be handling the ⌘V")
        var slow = RestoreSchedule()
        slow.pasted(at: 10)
        slow.read(at: 11.95)
        XCTAssertEqual(slow.restoreAt, 12, "never later than before L11")
    }

    func testThePromiseTellsWhenTheTextIsReadAndGivesTheText() {
        let pb = NSPasteboard(name: NSPasteboard.Name("kiwi-test-\(UUID().uuidString)"))
        defer { pb.releaseGlobally() }
        pb.clearContents()
        pb.setString("da pessoa", forType: .string)
        let keeper = ClipboardKeeper()
        var reads = 0
        let ours = keeper.put("ditado", on: pb, keepOriginal: true, onRead: { reads += 1 })
        XCTAssertEqual(reads, 0, "putting it isn't reading it")
        XCTAssertEqual(pb.string(forType: .string), "ditado", "an app reads the promised text")
        XCTAssertEqual(reads, 1)
        XCTAssertNotNil(pb.data(forType: ClipboardSnapshot.transient), "still marked for the clipboard managers")
        XCTAssertTrue(keeper.restore(on: pb, ifStill: ours))
        XCTAssertEqual(pb.string(forType: .string), "da pessoa")
    }

    func testTextThatStaysIsAPlainStringNotAPromise() {
        let pb = NSPasteboard(name: NSPasteboard.Name("kiwi-test-\(UUID().uuidString)"))
        defer { pb.releaseGlobally() }
        let keeper = ClipboardKeeper()
        var reads = 0
        keeper.put("sem campo", on: pb, keepOriginal: false, onRead: { reads += 1 })
        XCTAssertEqual(pb.string(forType: .string), "sem campo")
        XCTAssertEqual(reads, 0, "no promise: nothing to call back after we stop caring")
    }
}
