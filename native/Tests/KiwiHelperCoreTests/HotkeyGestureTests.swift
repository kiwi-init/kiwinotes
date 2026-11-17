import XCTest
@testable import KiwiHelperCore

final class HotkeyGestureTests: XCTestCase {
    func testHoldIsPushToTalk() {
        var g = HotkeyGesture(holdThreshold: 0.25, doubleTapWindow: 0.35)
        XCTAssertEqual(g.keyDown(at: 10.0), [.startRecording])
        XCTAssertTrue(g.isRecording)
        XCTAssertEqual(g.keyUp(at: 11.2), [.stopRecording(.pushToTalk)])
        XCTAssertEqual(g.state, .idle)
    }

    func testKeyRepeatWhileHeldIsIgnored() {
        var g = HotkeyGesture()
        _ = g.keyDown(at: 0)
        XCTAssertEqual(g.keyDown(at: 0.1), [])
        XCTAssertEqual(g.keyUp(at: 1), [.stopRecording(.pushToTalk)])
    }

    func testLoneShortTapCancelsAfterWindow() {
        var g = HotkeyGesture(holdThreshold: 0.25, doubleTapWindow: 0.35)
        XCTAssertEqual(g.keyDown(at: 0), [.startRecording])
        XCTAssertEqual(g.keyUp(at: 0.1), [])
        XCTAssertEqual(g.deadline ?? 0, 0.45, accuracy: 1e-9)
        XCTAssertEqual(g.tick(now: 0.3), [], "still inside the double-tap window")
        XCTAssertEqual(g.tick(now: 0.5), [.cancelRecording])
        XCTAssertEqual(g.state, .idle)
        XCTAssertNil(g.deadline)
    }

    func testDoubleTapLatchesAndNextTapStops() {
        var g = HotkeyGesture(holdThreshold: 0.25, doubleTapWindow: 0.35)
        XCTAssertEqual(g.keyDown(at: 0), [.startRecording])
        XCTAssertEqual(g.keyUp(at: 0.1), [])
        XCTAssertEqual(g.keyDown(at: 0.3), [.latch])
        XCTAssertEqual(g.keyUp(at: 0.4), [], "releasing the second tap keeps recording")
        XCTAssertEqual(g.tick(now: 5), [], "a latched recording never times out")
        XCTAssertTrue(g.isRecording)
        XCTAssertEqual(g.keyDown(at: 30), [.stopRecording(.toggle)])
        XCTAssertFalse(g.isRecording)
        XCTAssertEqual(g.keyUp(at: 30.1), [])
        XCTAssertEqual(g.state, .idle)
    }

    func testOverlayEndsALatchedRecording() {
        var g = HotkeyGesture()
        _ = g.keyDown(at: 0)
        _ = g.keyUp(at: 0.1)
        _ = g.keyDown(at: 0.3)
        _ = g.keyUp(at: 0.4)
        XCTAssertEqual(g.endedFromOverlay(), .toggle)
        XCTAssertEqual(g.state, .idle)
        XCTAssertEqual(g.keyDown(at: 5), [.startRecording], "the next press starts a new recording")
    }

    func testOverlayEndsWhileTheKeyIsHeld() {
        var g = HotkeyGesture()
        _ = g.keyDown(at: 0)
        XCTAssertEqual(g.endedFromOverlay(), .pushToTalk)
        XCTAssertFalse(g.isRecording)
        XCTAssertEqual(g.keyUp(at: 2), [], "letting the key go afterwards does nothing")
        XCTAssertEqual(g.state, .idle)
    }

    func testOverlayEndsInsideTheDoubleTapWindow() {
        var g = HotkeyGesture()
        _ = g.keyDown(at: 0)
        _ = g.keyUp(at: 0.1)
        XCTAssertEqual(g.endedFromOverlay(), .pushToTalk)
        XCTAssertEqual(g.tick(now: 1), [], "no late cancel after the overlay already ended it")
    }

    func testSecondTapTooLateStartsOver() {
        var g = HotkeyGesture(holdThreshold: 0.25, doubleTapWindow: 0.35)
        _ = g.keyDown(at: 0)
        _ = g.keyUp(at: 0.1)
        // The tick was late (busy main thread): the next down cancels the old tap and starts fresh.
        XCTAssertEqual(g.keyDown(at: 1.0), [.cancelRecording, .startRecording])
        XCTAssertEqual(g.keyUp(at: 2.0), [.stopRecording(.pushToTalk)])
    }

    func testUsedAsModifierCancels() {
        var g = HotkeyGesture()
        _ = g.keyDown(at: 0)
        XCTAssertEqual(g.otherKeyDown(), [.cancelRecording])
        XCTAssertFalse(g.isRecording)
        XCTAssertEqual(g.keyUp(at: 2), [], "the release after a cancel does nothing")
        XCTAssertEqual(g.state, .idle)
    }

    func testOtherKeyWhileLatchedKeepsRecording() {
        var g = HotkeyGesture()
        _ = g.keyDown(at: 0); _ = g.keyUp(at: 0.1); _ = g.keyDown(at: 0.2); _ = g.keyUp(at: 0.3)
        XCTAssertEqual(g.otherKeyDown(), [])
        XCTAssertEqual(g.state, .latched)
    }

    func testResetFromCommand() {
        var g = HotkeyGesture()
        g.reset(latched: true)
        XCTAssertEqual(g.keyDown(at: 0), [.stopRecording(.toggle)])
        _ = g.keyUp(at: 0.1)
        XCTAssertEqual(g.state, .idle)
    }

    func testHotkeyFlags() {
        XCTAssertEqual(HotkeyKey.fn.isDown(keyCode: 63, flags: 0x80_0100), true)
        XCTAssertEqual(HotkeyKey.fn.isDown(keyCode: 63, flags: 0x100), false)
        XCTAssertNil(HotkeyKey.fn.isDown(keyCode: 61, flags: 0x80_0000))
        // Right option down (0x80000 alternate + 0x40 device bit); left option only sets 0x20.
        XCTAssertEqual(HotkeyKey.rightOption.isDown(keyCode: 61, flags: 0x8_0140), true)
        XCTAssertEqual(HotkeyKey.rightOption.isDown(keyCode: 61, flags: 0x8_0120), false)
    }

    /// T1320: ⌥ held when the dictation key goes down makes it a quick note. Either ⌥, but not the key itself.
    func testNoteModifier() {
        // Fn with left ⌥ (0x20) or right ⌥ (0x40) held; the generic ⌥ bit (0x80000) comes along.
        XCTAssertTrue(HotkeyKey.fn.noteModifierHeld(flags: 0x80_0000 | 0x8_0020))
        XCTAssertTrue(HotkeyKey.fn.noteModifierHeld(flags: 0x80_0000 | 0x8_0040))
        XCTAssertFalse(HotkeyKey.fn.noteModifierHeld(flags: 0x80_0000))
        // ⇧ (0x20002) or ⌘ (0x100008) are not ⌥.
        XCTAssertFalse(HotkeyKey.fn.noteModifierHeld(flags: 0x80_0000 | 0x2_0002 | 0x10_0008))
        // Right ⌥ as the dictation key: its own bit doesn't count, the left ⌥ does.
        XCTAssertFalse(HotkeyKey.rightOption.noteModifierHeld(flags: 0x8_0040))
        XCTAssertTrue(HotkeyKey.rightOption.noteModifierHeld(flags: 0x8_0060))
        XCTAssertTrue(HotkeyKey.rightCommand.noteModifierHeld(flags: 0x10_0010 | 0x8_0020))

        XCTAssertTrue(HotkeyKey.fn.isNoteModifier(keyCode: 58))
        XCTAssertTrue(HotkeyKey.fn.isNoteModifier(keyCode: 61))
        XCTAssertFalse(HotkeyKey.rightOption.isNoteModifier(keyCode: 61))
        XCTAssertTrue(HotkeyKey.rightOption.isNoteModifier(keyCode: 58))
        XCTAssertFalse(HotkeyKey.fn.isNoteModifier(keyCode: 56)) // ⇧
    }
}
