import XCTest
@testable import KiwiHelperCore

/// T5349 (#175): the shortcuts' text.
final class ShortcutTextTests: XCTestCase {
    func testTheFourGestures() {
        XCTAssertEqual(Shortcut("fn"), .key(.fn))
        XCTAssertEqual(Shortcut("RightOption"), .key(.rightOption))
        XCTAssertEqual(Shortcut("double:rightCommand"), .doubleTap(.rightCommand))
        XCTAssertEqual(Shortcut("control+option+r"), .combo(KeyCombo("control+option+r")!))
        XCTAssertEqual(Shortcut("command+shift+space"), .combo(KeyCombo("command+shift+space")!))
        XCTAssertEqual(Shortcut("f5"), .combo(KeyCombo("f5")!))
        XCTAssertEqual(Shortcut("control+k r r"), .sequence([KeyCombo("control+k")!, KeyCombo("r", bare: true)!, KeyCombo("r", bare: true)!]))
        XCTAssertEqual(Shortcut("f5 f5"), .sequence([KeyCombo("f5")!, KeyCombo("f5")!]))
    }

    func testTheDefaultsAreShortcuts() {
        // The helper's defaults (Helper.shortcuts), the same as `shared/shortcuts.ts`: L9's ⌃⌥V among them.
        for text in ["fn", "control+option+v", "control+option+r", "control+option+m"] { XCTAssertNotNil(Shortcut(text), text) }
        XCTAssertNotNil(Shortcut("escape", bareKey: true))
    }

    func testTheTextGoesBackAndForth() {
        for text in ["fn", "double:rightOption", "control+option+n", "control+option+shift+command+space", "f12", "control+k r r", "option+command+1 2"] {
            XCTAssertEqual(Shortcut(text)?.spec, text)
        }
        XCTAssertEqual(Shortcut("Command+Option+N")?.spec, "option+command+n", "the menus' order")
    }

    func testRejectsWhatCouldFireWhileTyping() {
        XCTAssertNil(Shortcut("r"), "a plain letter")
        XCTAssertNil(Shortcut("shift+r"))
        XCTAssertNil(Shortcut("r control+k"), "a sequence that starts with a plain letter")
        XCTAssertNil(Shortcut("space"))
        XCTAssertNil(Shortcut("double:r"))
        XCTAssertNil(Shortcut("double:"))
        XCTAssertNil(Shortcut("control+k a b c d"), "five steps")
        XCTAssertNil(Shortcut(""))
        XCTAssertNil(Shortcut("control+fn"), "a modifier key isn't the key of a combination")
    }
}

/// T5349 (#175): the four gestures and the priority, with fake events and a fake clock.
final class ShortcutEngineTests: XCTestCase {
    let control: UInt64 = 0x4_0000 | 0x1
    let leftOption: UInt64 = 0x8_0000 | 0x20
    let rightOption: UInt64 = 0x8_0000 | 0x40
    let command: UInt64 = 0x10_0000 | 0x8
    let fn: UInt64 = 0x80_0000
    // Key codes.
    let r: Int64 = 15, k: Int64 = 40, n: Int64 = 45, a: Int64 = 0, f5: Int64 = 96

    func engine(_ bindings: [(String, String)]) -> ShortcutEngine<Int> {
        var e = ShortcutEngine<Int>()
        e.setBindings(bindings.map { (id: $0.0, shortcut: Shortcut($0.1)!) })
        return e
    }

    // MARK: A key on its own

    func testAModifierHeldAndLetGo() {
        var e = engine([("dictation", "fn")])
        let down = e.handle(.flags(keyCode: 63, flags: fn), payload: 1, at: 0)
        XCTAssertEqual(down.outputs, [.press("dictation", flags: fn)])
        XCTAssertFalse(down.consume, "a modifier always reaches the app")
        let up = e.handle(.flags(keyCode: 63, flags: 0), payload: 2, at: 1)
        XCTAssertEqual(up.outputs, [.release("dictation", clean: true)])
        XCTAssertFalse(up.consume)
    }

    func testAModifierUsedAsAModifier() {
        var e = engine([("dictation", "fn")])
        _ = e.handle(.flags(keyCode: 63, flags: fn), payload: 1, at: 0)
        let f = e.handle(.keyDown(keyCode: 3, flags: fn, autorepeat: false), payload: 2, at: 0.1)
        XCTAssertEqual(f.outputs, [.interrupt("dictation", keyCode: 3)])
        XCTAssertFalse(f.consume, "Fn+F reaches the app")
        XCTAssertEqual(e.handle(.flags(keyCode: 63, flags: 0), payload: 3, at: 0.2).outputs, [.release("dictation", clean: false)])
    }

    func testTheQuickNoteSeesTheOptionInThePressFlags() {
        var e = engine([("dictation", "rightOption")])
        let down = e.handle(.flags(keyCode: 61, flags: leftOption | 0x40), payload: 1, at: 0)
        XCTAssertEqual(down.outputs, [.press("dictation", flags: leftOption | 0x40)])
        XCTAssertTrue(HotkeyKey.rightOption.noteModifierHeld(flags: leftOption | 0x40))
        // Letting go of the left ⌥ only interrupts with its key code, which the dictation ignores in a quick note.
        XCTAssertEqual(e.handle(.flags(keyCode: 58, flags: rightOption), payload: 2, at: 0.1).outputs, [])
    }

    func testTheStartOfACombinationIsNotAPress() {
        // ⌃ held, then the ⌥ right of ⌃⌥N with ⌥ right as the dictation key (T1653).
        var e = engine([("dictation", "rightOption"), ("notes", "control+option+n")])
        XCTAssertEqual(e.handle(.flags(keyCode: 61, flags: control | rightOption), payload: 1, at: 0).outputs, [])
        let combo = e.handle(.keyDown(keyCode: n, flags: control | rightOption, autorepeat: false), payload: 2, at: 0.1)
        XCTAssertEqual(combo.outputs, [.press("notes", flags: control | rightOption)])
        XCTAssertEqual(e.handle(.flags(keyCode: 61, flags: control), payload: 3, at: 0.2).outputs, [], "nor its release")
    }

    // MARK: Double tap

    func testADoubleTap() {
        var e = engine([("meeting", "double:rightCommand")])
        let cmd: UInt64 = 0x10_0000 | 0x10
        XCTAssertEqual(e.handle(.flags(keyCode: 54, flags: cmd), payload: 1, at: 0).outputs, [])
        XCTAssertEqual(e.handle(.flags(keyCode: 54, flags: 0), payload: 2, at: 0.1).outputs, [])
        let second = e.handle(.flags(keyCode: 54, flags: cmd), payload: 3, at: 0.3)
        XCTAssertEqual(second.outputs, [.trigger("meeting")])
        XCTAssertFalse(second.consume)
        // The third tap right after doesn't fire again: the second press was spent.
        _ = e.handle(.flags(keyCode: 54, flags: 0), payload: 4, at: 0.35)
        XCTAssertEqual(e.handle(.flags(keyCode: 54, flags: cmd), payload: 5, at: 0.45).outputs, [])
    }

    func testTooSlowIsNotADoubleTap() {
        var e = engine([("meeting", "double:rightCommand")])
        let cmd: UInt64 = 0x10_0000 | 0x10
        _ = e.handle(.flags(keyCode: 54, flags: cmd), payload: 1, at: 0)
        _ = e.handle(.flags(keyCode: 54, flags: 0), payload: 2, at: 0.1)
        XCTAssertEqual(e.handle(.flags(keyCode: 54, flags: cmd), payload: 3, at: 0.6).outputs, [])
    }

    func testAHeldOrUsedPressIsNotATap() {
        var e = engine([("meeting", "double:rightCommand")])
        let cmd: UInt64 = 0x10_0000 | 0x10
        // ⌘C with the ⌘ right, then ⌘ right again: not a double tap.
        _ = e.handle(.flags(keyCode: 54, flags: cmd), payload: 1, at: 0)
        _ = e.handle(.keyDown(keyCode: 8, flags: cmd, autorepeat: false), payload: 2, at: 0.05)
        _ = e.handle(.flags(keyCode: 54, flags: 0), payload: 3, at: 0.1)
        XCTAssertEqual(e.handle(.flags(keyCode: 54, flags: cmd), payload: 4, at: 0.2).outputs, [])
        // Held too long.
        _ = e.handle(.flags(keyCode: 54, flags: 0), payload: 5, at: 1.0)
        XCTAssertEqual(e.handle(.flags(keyCode: 54, flags: cmd), payload: 6, at: 1.1).outputs, [])
    }

    // MARK: Combination and priority

    func testACombinationIsConsumedWithItsRepeatAndItsKeyUp() {
        var e = engine([("meeting", "control+option+r")])
        let down = e.handle(.keyDown(keyCode: r, flags: control | leftOption, autorepeat: false), payload: 1, at: 0)
        XCTAssertTrue(down.consume, "the app in front never sees ⌃⌥R")
        XCTAssertEqual(down.outputs, [.press("meeting", flags: control | leftOption)])
        let repeated = e.handle(.keyDown(keyCode: r, flags: control | leftOption, autorepeat: true), payload: 2, at: 0.5)
        XCTAssertTrue(repeated.consume)
        XCTAssertEqual(repeated.outputs, [])
        let up = e.handle(.keyUp(keyCode: r, flags: control | leftOption), payload: 3, at: 0.6)
        XCTAssertTrue(up.consume)
        XCTAssertEqual(up.outputs, [.release("meeting", clean: true)])
    }

    func testTheRestOfTheKeyboardPasses() {
        var e = engine([("meeting", "control+option+r"), ("notes", "control+k n")])
        for input: KeyInput in [
            .keyDown(keyCode: r, flags: 0, autorepeat: false), .keyUp(keyCode: r, flags: 0),
            .keyDown(keyCode: r, flags: control, autorepeat: false), .keyUp(keyCode: r, flags: control),
            .keyDown(keyCode: r, flags: control | leftOption | command, autorepeat: false),
            .keyDown(keyCode: a, flags: command, autorepeat: false),
            .flags(keyCode: 59, flags: control), .flags(keyCode: 59, flags: 0),
        ] {
            let result = e.handle(input, payload: 0, at: 0)
            XCTAssertFalse(result.consume, "\(input)")
            XCTAssertEqual(result.outputs, [], "\(input)")
        }
    }

    func testAnFKeyOnItsOwn() {
        var e = engine([("notes", "f5")])
        // An F key arrives with the Fn bit set: it doesn't count.
        let down = e.handle(.keyDown(keyCode: f5, flags: fn, autorepeat: false), payload: 1, at: 0)
        XCTAssertTrue(down.consume)
        XCTAssertEqual(down.outputs, [.press("notes", flags: fn)])
        XCTAssertTrue(e.handle(.keyUp(keyCode: f5, flags: fn), payload: 2, at: 0.1).consume)
        XCTAssertFalse(e.handle(.keyDown(keyCode: f5, flags: fn | command, autorepeat: false), payload: 3, at: 1).consume, "⌘F5 is another")
    }

    func testTheLayoutDecidesTheLetter() {
        var e = engine([("notes", "control+option+n")])
        e.typed = { code, _ in code == 11 ? "n" : "b" } // Dvorak: the QWERTY B key types N
        XCTAssertTrue(e.handle(.keyDown(keyCode: 11, flags: control | leftOption, autorepeat: false), payload: 1, at: 0).consume)
        XCTAssertFalse(e.handle(.keyDown(keyCode: n, flags: control | leftOption, autorepeat: false), payload: 2, at: 1).consume)
    }

    // MARK: Sequence

    func testASequenceIsHeldBackAndFires() {
        var e = engine([("notes", "control+k r r")])
        let first = e.handle(.keyDown(keyCode: k, flags: control, autorepeat: false), payload: 1, at: 0)
        XCTAssertTrue(first.consume)
        XCTAssertEqual(first.outputs, [])
        XCTAssertEqual(e.deadline, 0.8)
        XCTAssertTrue(e.handle(.keyUp(keyCode: k, flags: control), payload: 2, at: 0.1).consume)
        XCTAssertTrue(e.handle(.keyDown(keyCode: r, flags: 0, autorepeat: false), payload: 3, at: 0.3).consume)
        XCTAssertTrue(e.handle(.keyUp(keyCode: r, flags: 0), payload: 4, at: 0.35).consume)
        let last = e.handle(.keyDown(keyCode: r, flags: 0, autorepeat: false), payload: 5, at: 0.5)
        XCTAssertTrue(last.consume)
        XCTAssertEqual(last.outputs, [.trigger("notes")])
        XCTAssertEqual(last.replay, [])
        XCTAssertNil(e.deadline)
        XCTAssertTrue(e.handle(.keyUp(keyCode: r, flags: 0), payload: 6, at: 0.55).consume, "the last key's up too")
    }

    func testABrokenSequenceGivesItsKeysBackInOrder() {
        var e = engine([("notes", "control+k r r")])
        _ = e.handle(.keyDown(keyCode: k, flags: control, autorepeat: false), payload: 1, at: 0)
        _ = e.handle(.keyUp(keyCode: k, flags: control), payload: 2, at: 0.1)
        _ = e.handle(.keyDown(keyCode: r, flags: 0, autorepeat: false), payload: 3, at: 0.2)
        _ = e.handle(.keyUp(keyCode: r, flags: 0), payload: 4, at: 0.25)
        let other = e.handle(.keyDown(keyCode: a, flags: 0, autorepeat: false), payload: 5, at: 0.3)
        XCTAssertTrue(other.consume, "dropped now, posted again after the others")
        XCTAssertEqual(other.replay, [1, 2, 3, 4, 5])
        XCTAssertEqual(other.outputs, [])
        XCTAssertFalse(e.handle(.keyUp(keyCode: a, flags: 0), payload: 6, at: 0.35).consume)
    }

    func testASequenceThatWaitsTooLongGivesItsKeysBack() {
        var e = engine([("notes", "control+k r r")])
        _ = e.handle(.keyDown(keyCode: k, flags: control, autorepeat: false), payload: 1, at: 0)
        _ = e.handle(.keyUp(keyCode: k, flags: control), payload: 2, at: 0.1)
        XCTAssertEqual(e.tick(now: 0.5).replay, [], "still in time")
        XCTAssertEqual(e.tick(now: 0.9).replay, [1, 2])
        XCTAssertNil(e.deadline)
        XCTAssertFalse(e.handle(.keyDown(keyCode: r, flags: 0, autorepeat: false), payload: 3, at: 1).consume, "a plain R again")
    }

    func testABrokenSequenceCanStartACombination() {
        var e = engine([("notes", "control+k r"), ("meeting", "control+option+r")])
        _ = e.handle(.keyDown(keyCode: k, flags: control, autorepeat: false), payload: 1, at: 0)
        let combo = e.handle(.keyDown(keyCode: r, flags: control | leftOption, autorepeat: false), payload: 2, at: 0.2)
        XCTAssertTrue(combo.consume)
        XCTAssertEqual(combo.replay, [1], "the ⌃K goes back, the ⌃⌥R is Kiwi's")
        XCTAssertEqual(combo.outputs, [.press("meeting", flags: control | leftOption)])
    }

    func testAnFKeyTappedTwice() {
        var e = engine([("notes", "f5 f5")])
        XCTAssertTrue(e.handle(.keyDown(keyCode: f5, flags: fn, autorepeat: false), payload: 1, at: 0).consume)
        XCTAssertTrue(e.handle(.keyUp(keyCode: f5, flags: fn), payload: 2, at: 0.1).consume)
        XCTAssertEqual(e.handle(.keyDown(keyCode: f5, flags: fn, autorepeat: false), payload: 3, at: 0.3).outputs, [.trigger("notes")])
    }

    func testNewBindingsForgetWhatWasHalfDone() {
        var e = engine([("notes", "control+k r")])
        _ = e.handle(.keyDown(keyCode: k, flags: control, autorepeat: false), payload: 1, at: 0)
        e.setBindings([])
        XCTAssertNil(e.deadline)
        XCTAssertFalse(e.handle(.keyDown(keyCode: r, flags: 0, autorepeat: false), payload: 2, at: 0.1).consume)
    }
}

/// T5349 (#175): "aperte o atalho" in Settings.
final class ShortcutRecorderTests: XCTestCase {
    let control: UInt64 = 0x4_0000 | 0x1
    let leftOption: UInt64 = 0x8_0000 | 0x20
    let fn: UInt64 = 0x80_0000

    func testAModifierTappedOnceOrTwice() {
        var once = ShortcutRecorder()
        once.feed(.flags(keyCode: 63, flags: fn), at: 0)
        XCTAssertNil(once.deadline, "still held")
        once.feed(.flags(keyCode: 63, flags: 0), at: 0.2)
        XCTAssertNil(once.tick(now: 0.5))
        XCTAssertEqual(once.tick(now: 1.0), .recorded("fn"))

        var twice = ShortcutRecorder()
        for (i, flags) in [0x40 | 0x8_0000, 0, 0x40 | 0x8_0000, 0].enumerated() {
            twice.feed(.flags(keyCode: 61, flags: UInt64(flags)), at: Double(i) * 0.1)
        }
        XCTAssertEqual(twice.tick(now: 2), .recorded("double:rightOption"))
    }

    func testACombination() {
        var r = ShortcutRecorder()
        r.feed(.flags(keyCode: 59, flags: control), at: 0)
        r.feed(.flags(keyCode: 58, flags: control | leftOption), at: 0.05)
        r.feed(.keyDown(keyCode: 15, flags: control | leftOption, autorepeat: false), at: 0.1)
        r.feed(.keyDown(keyCode: 15, flags: control | leftOption, autorepeat: true), at: 0.4)
        r.feed(.keyUp(keyCode: 15, flags: control | leftOption), at: 0.5)
        XCTAssertEqual(r.tick(now: 1.4), .recorded("control+option+r"))
    }

    func testTheLetterTheLayoutTypes() {
        var r = ShortcutRecorder(typed: { code, _ in code == 11 ? "N" : nil })
        r.feed(.keyDown(keyCode: 11, flags: control, autorepeat: false), at: 0)
        r.feed(.keyUp(keyCode: 11, flags: control), at: 0.1)
        XCTAssertEqual(r.tick(now: 1), .recorded("control+n"))
    }

    func testASequence() {
        var r = ShortcutRecorder()
        r.feed(.keyDown(keyCode: 40, flags: control, autorepeat: false), at: 0)
        r.feed(.keyUp(keyCode: 40, flags: control), at: 0.1)
        r.feed(.keyDown(keyCode: 15, flags: 0, autorepeat: false), at: 0.4)
        r.feed(.keyUp(keyCode: 15, flags: 0), at: 0.5)
        r.feed(.keyDown(keyCode: 15, flags: 0, autorepeat: false), at: 0.8)
        r.feed(.keyUp(keyCode: 15, flags: 0), at: 0.9)
        XCTAssertNil(r.tick(now: 1.2), "the person may still type a step")
        XCTAssertEqual(r.tick(now: 1.8), .recorded("control+k r r"))
    }

    func testEscapeCancelsAndAPlainLetterIsNoShortcut() {
        var esc = ShortcutRecorder()
        esc.feed(.keyDown(keyCode: 53, flags: 0, autorepeat: false), at: 0)
        XCTAssertEqual(esc.outcome, .cancelled)

        var letter = ShortcutRecorder()
        letter.feed(.keyDown(keyCode: 15, flags: 0, autorepeat: false), at: 0)
        letter.feed(.keyUp(keyCode: 15, flags: 0), at: 0.1)
        XCTAssertEqual(letter.tick(now: 1), .invalid)
    }

    func testAModifierUsedInACombinationIsNotATap() {
        var r = ShortcutRecorder()
        r.feed(.flags(keyCode: 61, flags: 0x40 | 0x8_0000), at: 0)
        r.feed(.keyDown(keyCode: 15, flags: 0x40 | 0x8_0000, autorepeat: false), at: 0.1)
        r.feed(.keyUp(keyCode: 15, flags: 0x40 | 0x8_0000), at: 0.2)
        r.feed(.flags(keyCode: 61, flags: 0), at: 0.3)
        XCTAssertEqual(r.tick(now: 2), .recorded("option+r"))
    }
}

/// L5 (T5458): Esc cancels the dictation, armed only while recording, and consumed (the app in front never sees it).
final class CancelShortcutTests: XCTestCase {
    let esc: Int64 = 53, fnFlag: UInt64 = 0x80_0000

    func testOnlyTheCancelMayBeABareNamedKey() {
        XCTAssertNil(Shortcut("escape"), "Esc alone isn't a shortcut that is always armed")
        XCTAssertEqual(Shortcut("escape", bareKey: true)?.spec, "escape")
        XCTAssertEqual(Shortcut("delete", bareKey: true)?.spec, "delete")
        XCTAssertNil(Shortcut("r", bareKey: true), "never a plain letter: it would cancel while you type")
        XCTAssertEqual(Shortcut("control+c", bareKey: true)?.spec, "control+c", "a combination still works")
    }

    func engine(recording: @escaping () -> Bool) -> ShortcutEngine<Int> {
        var e = ShortcutEngine<Int>()
        e.setBindings([(id: "dictation", shortcut: .key(.fn)), (id: "cancel", shortcut: Shortcut("escape", bareKey: true)!)])
        e.isActive = { id in id != "cancel" || recording() }
        return e
    }

    func testEscOutsideARecordingIsTheOtherAppsAndDoesNothing() {
        var e = engine(recording: { false })
        let down = e.handle(.keyDown(keyCode: esc, flags: 0, autorepeat: false), payload: 1, at: 0)
        XCTAssertFalse(down.consume)
        XCTAssertEqual(down.outputs, [])
        XCTAssertFalse(e.handle(.keyUp(keyCode: esc, flags: 0), payload: 2, at: 0.1).consume)
    }

    func testEscDuringARecordingCancelsAndIsConsumedWithItsKeyUp() {
        var recording = true
        var e = engine(recording: { recording })
        let down = e.handle(.keyDown(keyCode: esc, flags: 0, autorepeat: false), payload: 1, at: 0)
        XCTAssertTrue(down.consume, "the app in front doesn't get the Esc")
        XCTAssertEqual(down.outputs, [.press("cancel", flags: 0)])
        recording = false // the cancel ended the recording
        XCTAssertTrue(e.handle(.keyUp(keyCode: esc, flags: 0), payload: 2, at: 0.1).consume, "nor its key-up, half of a keystroke")
        XCTAssertFalse(e.handle(.keyDown(keyCode: esc, flags: 0, autorepeat: false), payload: 3, at: 1).consume, "the next Esc is the app's again")
    }

    func testEscWhileHoldingTheDictationKeyIsTheCancelFirst() {
        var e = engine(recording: { true })
        _ = e.handle(.flags(keyCode: 63, flags: fnFlag), payload: 1, at: 0)
        let down = e.handle(.keyDown(keyCode: esc, flags: fnFlag, autorepeat: false), payload: 2, at: 0.5)
        XCTAssertTrue(down.consume)
        // The cancel comes before the dictation key hears "another key", so the recording ends as an Esc.
        XCTAssertEqual(down.outputs, [.press("cancel", flags: fnFlag), .interrupt("dictation", keyCode: esc)])
        // HotkeyGesture: the cancel puts a held key in `releasing`, so the interrupt and the release do nothing.
        var gesture = HotkeyGesture()
        _ = gesture.keyDown(at: 0)
        _ = gesture.endedFromOverlay()
        XCTAssertEqual(gesture.otherKeyDown(), [])
        XCTAssertEqual(gesture.keyUp(at: 0.6), [])
        XCTAssertFalse(gesture.isRecording)
    }

    func testArmingTheCancelDoesntResetAGestureUnderWay() {
        var recording = false
        var e = engine(recording: { recording })
        XCTAssertEqual(e.handle(.flags(keyCode: 63, flags: fnFlag), payload: 1, at: 0).outputs, [.press("dictation", flags: fnFlag)])
        recording = true // the press started the recording: the cancel is armed now
        XCTAssertEqual(e.handle(.flags(keyCode: 63, flags: 0), payload: 2, at: 1).outputs, [.release("dictation", clean: true)], "push-to-talk still ends")
    }

    func testTheRecorderTakesABareNamedKeyOnlyForTheCancel() {
        var plain = ShortcutRecorder()
        plain.feed(.keyDown(keyCode: 51, flags: 0, autorepeat: false), at: 0)
        plain.feed(.keyUp(keyCode: 51, flags: 0), at: 0.1)
        XCTAssertEqual(plain.tick(now: 1), .invalid)

        var cancel = ShortcutRecorder()
        cancel.bareKey = true
        cancel.feed(.keyDown(keyCode: 51, flags: 0, autorepeat: false), at: 0)
        cancel.feed(.keyUp(keyCode: 51, flags: 0), at: 0.1)
        XCTAssertEqual(cancel.tick(now: 1), .recorded("delete"))

        var letter = ShortcutRecorder()
        letter.bareKey = true
        letter.feed(.keyDown(keyCode: 15, flags: 0, autorepeat: false), at: 0)
        letter.feed(.keyUp(keyCode: 15, flags: 0), at: 0.1)
        XCTAssertEqual(letter.tick(now: 1), .invalid)
    }
}
