import XCTest
@testable import KiwiHelperCore

/// T1740: the CLI's simulated field gives the plan and the space of a real paste, without reading anyone's screen.
final class SimulatedFieldTests: XCTestCase {
    func testAPlainFieldAfterText() {
        let r = SimulatedField(textBefore: "Oi, tudo bem.").outcome(text: "Manda o laudo.", autoSpace: true)
        XCTAssertEqual(r.plan, .paste)
        XCTAssertTrue(r.spaced, "only the last two characters count: \"m.\"")
    }

    func testNoSpaceAtTheStartOrUnknownOrTurnedOff() {
        XCTAssertFalse(SimulatedField(textBefore: "").outcome(text: "Oi.", autoSpace: true).spaced)
        XCTAssertFalse(SimulatedField(textBefore: nil).outcome(text: "Oi.", autoSpace: true).spaced)
        XCTAssertFalse(SimulatedField(textBefore: "ls").outcome(text: "cd", autoSpace: false).spaced, "the literal tone")
        XCTAssertFalse(SimulatedField(textBefore: "(").outcome(text: "isto", autoSpace: true).spaced)
    }

    func testThePlansAndTheirReasons() {
        let secure = SimulatedField(secureInput: true, textBefore: "a").outcome(text: "b", autoSpace: true)
        XCTAssertEqual(secure.plan, .pasteKeepingText(reason: "secure_input"))
        XCTAssertFalse(secure.spaced, "never reads the field with secure input on")
        XCTAssertFalse(SimulatedField(role: "AXSecureTextField", textBefore: "a").outcome(text: "b", autoSpace: true).spaced)
        XCTAssertEqual(SimulatedField(role: "AXButton", hasCaret: false).outcome(text: "b", autoSpace: true).plan,
                       .pasteKeepingText(reason: "no_text_field"))
        XCTAssertEqual(SimulatedField(role: nil).outcome(text: "b", autoSpace: true).plan, .pasteKeepingText(reason: "no_focus"))
        let noAX = SimulatedField(accessibilityGranted: false).outcome(text: "b", autoSpace: true).plan
        XCTAssertEqual(noAX, .clipboardOnly(reason: "no_accessibility"))
        XCTAssertEqual(noAX.name, "clipboardOnly")
        XCTAssertEqual(noAX.reason, "no_accessibility")
        XCTAssertNil(InsertPlan.paste.reason)
    }

    func testParsesTheIPCObject() {
        XCTAssertEqual(SimulatedField([:]), SimulatedField())
        XCTAssertEqual(SimulatedField(["textBefore": "abc", "secureInput": true]), SimulatedField(secureInput: true, textBefore: "abc"))
        XCTAssertEqual(SimulatedField(["role": NSNull()])?.role, .some(nil), "null role: no focus")
        XCTAssertEqual(SimulatedField(["role": "AXButton", "hasCaret": false]), SimulatedField(role: "AXButton", hasCaret: false))
        XCTAssertNil(SimulatedField(nil))
        XCTAssertNil(SimulatedField("x"))
        XCTAssertNil(SimulatedField(["secureInput": 1]), "a number isn't a flag")
        XCTAssertNil(SimulatedField(["textBefore": 5]))
    }
}
