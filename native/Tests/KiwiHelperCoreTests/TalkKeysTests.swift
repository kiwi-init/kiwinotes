import XCTest
@testable import KiwiHelperCore

/// Spec #9876: the Control talks to the agent, with the dictation's gesture, and the two keys never record together.
final class AgentControlKeyTests: XCTestCase {
    // Key codes and device bits: ⌃ left 59 (0x1), ⌃ right 62 (0x2000), Fn 63 (0x800000), C 8.
    let left: Int64 = 59, right: Int64 = 62, fn: Int64 = 63
    let leftBit: UInt64 = 0x1 | 0x40000, rightBit: UInt64 = 0x2000 | 0x40000, fnBit: UInt64 = 0x80_0000

    func engine() -> ShortcutEngine<Int> {
        var e = ShortcutEngine<Int>()
        e.setBindings([(id: "dictation", shortcut: .key(.fn)), (id: "agent", shortcut: Shortcut("control")!),
                       (id: "pasteLast", shortcut: Shortcut("control+option+v")!)])
        return e
    }

    func testTheTextIsControl() {
        XCTAssertEqual(Shortcut("control"), .key(.control))
        XCTAssertEqual(Shortcut("control")?.spec, "control")
    }

    func testEitherControlPressesAndReleases() {
        for (code, bit) in [(left, leftBit), (right, rightBit)] {
            var e = engine()
            XCTAssertEqual(e.handle(.flags(keyCode: code, flags: bit), payload: 0, at: 0).outputs, [.press("agent", flags: bit)])
            XCTAssertEqual(e.handle(.flags(keyCode: code, flags: 0), payload: 0, at: 1).outputs, [.release("agent", clean: true)])
        }
    }

    func testTheOtherControlWhileOneIsHeldDoesNotReleaseIt() {
        var e = engine()
        _ = e.handle(.flags(keyCode: left, flags: leftBit), payload: 0, at: 0)
        // The right one goes down and up while the left stays down: the agent key is still held.
        _ = e.handle(.flags(keyCode: right, flags: leftBit | rightBit), payload: 0, at: 0.1)
        XCTAssertEqual(e.handle(.flags(keyCode: right, flags: leftBit), payload: 0, at: 0.2).outputs, [])
        XCTAssertEqual(e.handle(.flags(keyCode: left, flags: 0), payload: 0, at: 0.5).outputs, [.release("agent", clean: true)], "the other ⌃ is still the Control, not another key")
    }

    func testAKeyWithControlInterruptsAndStillReachesTheApp() {
        var e = engine()
        _ = e.handle(.flags(keyCode: left, flags: leftBit), payload: 0, at: 0)
        let r = e.handle(.keyDown(keyCode: 8, flags: leftBit, autorepeat: false), payload: 1, at: 0.05) // ⌃C
        XCTAssertEqual(r.outputs, [.interrupt("agent", keyCode: 8)])
        XCTAssertFalse(r.consume, "⌃C is the app's")
    }

    func testAClickWithControlInterruptsAndPasses() {
        var e = engine()
        _ = e.handle(.flags(keyCode: right, flags: rightBit), payload: 0, at: 0)
        let r = e.handle(.mouseDown, payload: 0, at: 0.05)
        XCTAssertEqual(r.outputs, [.interrupt("agent", keyCode: ShortcutEngine<Int>.mouseKeyCode)])
        XCTAssertFalse(r.consume, "⌃+click still opens the context menu")
        _ = e.handle(.flags(keyCode: right, flags: 0), payload: 0, at: 0.5)
        XCTAssertEqual(e.handle(.mouseDown, payload: 0, at: 1).outputs, [], "a click with nothing held is nobody's")
    }

    func testControlStartingACombinationIsNoPress() {
        var e = engine()
        // ⌥ first, then ⌃: the start of ⌃⌥V, not the agent.
        _ = e.handle(.flags(keyCode: 58, flags: 0x20 | 0x80000), payload: 0, at: 0)
        XCTAssertEqual(e.handle(.flags(keyCode: left, flags: leftBit | 0x20 | 0x80000), payload: 0, at: 0.05).outputs, [])
    }

    func testFnAndControlInterruptEachOther() {
        var e = engine()
        _ = e.handle(.flags(keyCode: fn, flags: fnBit), payload: 0, at: 0)
        let r = e.handle(.flags(keyCode: left, flags: fnBit | leftBit), payload: 0, at: 0.3)
        XCTAssertEqual(r.outputs, [.interrupt("dictation", keyCode: left), .press("agent", flags: fnBit | leftBit)])
    }

    func testTheRightControlStillWorksAsTheDictationKey() {
        var e = ShortcutEngine<Int>()
        e.setBindings([(id: "dictation", shortcut: .key(.rightControl))])
        XCTAssertEqual(e.handle(.flags(keyCode: right, flags: rightBit), payload: 0, at: 0).outputs, [.press("dictation", flags: rightBit)])
        XCTAssertEqual(e.handle(.flags(keyCode: left, flags: rightBit | leftBit), payload: 0, at: 0.1).outputs,
                       [.interrupt("dictation", keyCode: left)], "the left ⌃ is still another key for it")
    }

    func testTheRecorderDoesNotOfferTheAgentsControl() {
        var r = ShortcutRecorder()
        r.feed(.flags(keyCode: left, flags: leftBit), at: 0)
        r.feed(.flags(keyCode: left, flags: 0), at: 0.1)
        _ = r.tick(now: 5)
        XCTAssertNotEqual(r.tick(now: 5), .recorded("control"))
    }
}

final class TalkKeysTests: XCTestCase {
    func testHoldTalksAndLettingGoSends() {
        var k = TalkKeys()
        XCTAssertEqual(k.press(.agent, at: 0), [.startRecording], "the mic opens at once")
        XCTAssertEqual(k.release(.agent, at: 1), [.stopRecording(.pushToTalk)])
    }

    func testTwoTapsLatchAndOneMoreSends() {
        var k = TalkKeys()
        _ = k.press(.agent, at: 0); _ = k.release(.agent, at: 0.1)
        XCTAssertEqual(k.press(.agent, at: 0.3), [.latch])
        _ = k.release(.agent, at: 0.35)
        XCTAssertEqual(k.interrupt(.agent), [], "typing doesn't cancel a latched listen")
        XCTAssertEqual(k.press(.agent, at: 5), [.stopRecording(.toggle)])
    }

    func testTheTimingsAreTheDictations() {
        let k = TalkKeys()
        XCTAssertEqual(k.agent.holdThreshold, 0.25)
        XCTAssertEqual(k.agent.doubleTapWindow, 0.35)
    }

    func testALoneTapIsCancelled() {
        var k = TalkKeys()
        _ = k.press(.agent, at: 0); _ = k.release(.agent, at: 0.1)
        XCTAssertEqual(k.deadline?.target, .agent)
        XCTAssertEqual(k.tick(now: 0.5).map(\.1), [.cancelRecording])
    }

    func testAnotherKeyCancelsAPushToTalk() {
        var k = TalkKeys()
        _ = k.press(.agent, at: 0)
        XCTAssertEqual(k.interrupt(.agent), [.cancelRecording])
        XCTAssertEqual(k.release(.agent, at: 1), [], "letting go after the cancel sends nothing")
    }

    func testFnHeldThenControlRecordsNothingUntilBothAreUp() {
        var k = TalkKeys()
        XCTAssertEqual(k.press(.dictation, at: 0), [.startRecording])
        // The engine interrupts the dictation, and the Control's press is spent.
        XCTAssertEqual(k.interrupt(.dictation), [.cancelRecording])
        XCTAssertEqual(k.press(.agent, at: 0.2), [])
        XCTAssertEqual(k.release(.dictation, at: 0.5), [])
        XCTAssertEqual(k.release(.agent, at: 0.9), [], "the Control held alone after Fn doesn't send")
        XCTAssertEqual(k.press(.agent, at: 2), [.startRecording], "both up: the next press works")
    }

    func testControlHeldThenFnRecordsNothing() {
        var k = TalkKeys()
        _ = k.press(.agent, at: 0)
        XCTAssertEqual(k.interrupt(.agent), [.cancelRecording])
        XCTAssertEqual(k.press(.dictation, at: 0.1), [])
        XCTAssertEqual(k.release(.dictation, at: 0.6), [])
    }

    func testALatchedListenIgnoresTheOtherKey() {
        var k = TalkKeys()
        _ = k.press(.agent, at: 0); _ = k.release(.agent, at: 0.1); _ = k.press(.agent, at: 0.3); _ = k.release(.agent, at: 0.35)
        XCTAssertEqual(k.press(.dictation, at: 1), [], "Fn during the agent's latched listen starts nothing")
        XCTAssertEqual(k.release(.dictation, at: 2), [])
        XCTAssertEqual(k.press(.agent, at: 3), [.stopRecording(.toggle)], "and the agent's tap still sends")
    }

    func testTheOtherRecordingStillInItsTailBlocksAStart() {
        var k = TalkKeys()
        XCTAssertEqual(k.press(.agent, at: 0, otherRecording: true), [])
        XCTAssertEqual(k.release(.agent, at: 1), [])
    }

    func testEndedFromOutsideLeavesAHeldKeyHarmless() {
        var k = TalkKeys()
        _ = k.press(.agent, at: 0)
        XCTAssertEqual(k.ended(.agent), .pushToTalk) // Esc
        XCTAssertEqual(k.release(.agent, at: 1), [])
    }
}
