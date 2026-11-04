import XCTest
@testable import KiwiHelperCore

/// T1499: the combination that opens the Notes window, watched by the hotkey tap (no real keyboard here).
final class KeyComboTests: XCTestCase {
    // kCGEventFlagMask… bits, plus the device-specific left/right bits a real event carries.
    let control: UInt64 = 0x4_0000 | 0x1
    let option: UInt64 = 0x8_0000 | 0x20
    let command: UInt64 = 0x10_0000 | 0x8
    let shift: UInt64 = 0x2_0000 | 0x2

    func testParses() {
        XCTAssertEqual(KeyCombo("control+option+n"), KeyCombo("Option+Control+N"))
        XCTAssertEqual(KeyCombo("control+option+n")?.keyCode, 45)
        XCTAssertEqual(KeyCombo("control+option+n")?.modifiers, [.control, .option])
        XCTAssertEqual(KeyCombo("command+shift+1")?.keyCode, 18)
        XCTAssertEqual(KeyCombo("control+command+n")?.modifiers, [.control, .command])
    }

    func testRejectsWhatCouldFireWhileTyping() {
        XCTAssertNil(KeyCombo("n"), "a bare key")
        XCTAssertNil(KeyCombo("shift+n"), "⇧ alone is just a capital letter")
        XCTAssertNil(KeyCombo("control+option"), "no key")
        XCTAssertNil(KeyCombo("control+option+n+m"), "two keys")
        XCTAssertNil(KeyCombo("control+control+n"))
        XCTAssertNil(KeyCombo("control+option+F5"), "only letters and digits")
        XCTAssertNil(KeyCombo("control++n"))
        XCTAssertNil(KeyCombo(""))
        XCTAssertNil(KeyCombo("hyper+n"))
    }

    func testMatchesExactlyTheseModifiers() {
        let combo = KeyCombo("control+option+n")!
        XCTAssertTrue(combo.matches(keyCode: 45, flags: control | option))
        // Caps Lock (0x10000), Fn (0x800000) and the non-coalesced bit (0x100) don't change it.
        XCTAssertTrue(combo.matches(keyCode: 45, flags: control | option | 0x1_0000 | 0x80_0000 | 0x100))
        XCTAssertFalse(combo.matches(keyCode: 45, flags: control | option | shift), "⌃⌥⇧N is another combination")
        XCTAssertFalse(combo.matches(keyCode: 45, flags: control | option | command))
        XCTAssertFalse(combo.matches(keyCode: 45, flags: control))
        XCTAssertFalse(combo.matches(keyCode: 46, flags: control | option), "⌃⌥M")
        XCTAssertFalse(combo.matches(keyCode: 45, flags: control | option, autorepeat: true), "the key held down")
    }
}

/// T1653: the letter the layout types, and the dictation key that is part of the combination.
final class KeyComboLayoutTests: XCTestCase {
    let control: UInt64 = 0x4_0000 | 0x1
    let leftOption: UInt64 = 0x8_0000 | 0x20
    let rightOption: UInt64 = 0x8_0000 | 0x40
    let command: UInt64 = 0x10_0000 | 0x8
    let combo = KeyCombo("control+option+n")!

    func testMatchesTheLetterTheLayoutTypes() {
        // Dvorak: the QWERTY B key (11) types N, and the QWERTY N key (45) types B.
        XCTAssertTrue(combo.matches(keyCode: 11, flags: control | leftOption, typed: { "n" }))
        XCTAssertFalse(combo.matches(keyCode: 45, flags: control | leftOption, typed: { "b" }))
        // ABNT2 and US: the N is where it is. An uppercase answer (Caps Lock) is the same letter.
        XCTAssertTrue(combo.matches(keyCode: 45, flags: control | leftOption, typed: { "N" }))
        // Russian: no Latin letter on the key, so the US position counts, as in the ⌘ shortcuts of macOS.
        XCTAssertTrue(combo.matches(keyCode: 45, flags: control | leftOption, typed: { "т" }))
        XCTAssertFalse(combo.matches(keyCode: 11, flags: control | leftOption, typed: { "и" }))
        // The layout couldn't be read: the US position.
        XCTAssertTrue(combo.matches(keyCode: 45, flags: control | leftOption, typed: { nil }))
    }

    func testAsksTheLayoutOnlyWhenTheModifiersMatch() {
        var asked = 0
        XCTAssertFalse(combo.matches(keyCode: 45, flags: 0, typed: { asked += 1; return "n" }), "typing a plain N")
        XCTAssertFalse(combo.matches(keyCode: 45, flags: control | leftOption, autorepeat: true, typed: { asked += 1; return "n" }))
        XCTAssertEqual(asked, 0)
        XCTAssertTrue(combo.matches(keyCode: 45, flags: control | leftOption, typed: { asked += 1; return "n" }))
        XCTAssertEqual(asked, 1)
    }

    func testCommandLayer() {
        XCTAssertFalse(combo.usesCommandLayer)
        XCTAssertTrue(KeyCombo("option+command+n")!.usesCommandLayer)
    }

    func testTheDictationKeyAsPartOfTheCombination() {
        // ⌃ held, then the ⌥ right that is the dictation key: the start of ⌃⌥N, not a dictation.
        XCTAssertTrue(combo.startsWith(.rightOption, flags: control | rightOption))
        // The ⌥ right alone, or with ⌥ left (the quick note), is a dictation.
        XCTAssertFalse(combo.startsWith(.rightOption, flags: rightOption))
        XCTAssertFalse(combo.startsWith(.rightOption, flags: leftOption | rightOption))
        // ⌘ isn't in ⌃⌥N: ⌘ + the ⌥ right stays what it was.
        XCTAssertFalse(combo.startsWith(.rightOption, flags: command | rightOption))
        // Fn is never part of a combination; the ⌘ right only of one with ⌘.
        XCTAssertFalse(combo.startsWith(.fn, flags: control | leftOption | 0x80_0000))
        XCTAssertFalse(combo.startsWith(.rightCommand, flags: control | leftOption | command))
        XCTAssertTrue(KeyCombo("option+command+n")!.startsWith(.rightCommand, flags: leftOption | 0x10_0000 | 0x10))
        // ⌃⌘N with the ⌃ right as the dictation key: needs the ⌘ already held.
        let controlCommand = KeyCombo("control+command+n")!
        XCTAssertTrue(controlCommand.startsWith(.rightControl, flags: command | 0x4_0000 | 0x2000))
        XCTAssertFalse(controlCommand.startsWith(.rightControl, flags: 0x4_0000 | 0x2000))
    }
}
