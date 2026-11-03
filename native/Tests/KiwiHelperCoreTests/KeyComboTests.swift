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
