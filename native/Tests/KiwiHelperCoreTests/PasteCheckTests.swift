import XCTest
@testable import KiwiHelperCore

/// L12 (T5835): conferir se a colagem entrou, com leituras de mentira do Accessibility (nenhum app de verdade).
final class PasteCheckTests: XCTestCase {
    private func field(_ value: String, caret: Int? = nil, element: Int = 1) -> PasteSnapshot {
        PasteSnapshot(element: element, role: "AXTextArea", value: value, characterCount: value.utf16.count,
                      caret: (caret ?? value.utf16.count, 0))
    }

    /// As leituras na ordem; `nil` é uma leitura que falhou.
    private func verify(_ before: PasteSnapshot, _ text: String, _ reads: [PasteSnapshot?], waits: Int = .max) -> (PasteVerdict, Int) {
        var reads = reads
        var waited = 0
        let verdict = PasteCheck.verify(before: before, pastedText: text, capture: { reads.isEmpty ? nil : reads.removeFirst() },
                                        wait: { _ in
                                            waited += 1
                                            return waited <= waits
                                        })
        return (verdict, waited)
    }

    func testTheTextInTheFieldConfirmsAtTheFirstRead() {
        let (v, waited) = verify(field("Olá "), "bom dia", [field("Olá bom dia")])
        XCTAssertEqual(v, .confirmed(method: "value"))
        XCTAssertEqual(waited, 1)
    }

    func testAFieldTooBigToReadConfirmsByTheCountOrTheCaret() {
        let before = PasteSnapshot(element: 1, role: "AXTextArea", value: nil, characterCount: 70_000, caret: (100, 0))
        var after = before
        after.characterCount = 70_007
        XCTAssertEqual(verify(before, "bom dia", [after]).0, .confirmed(method: "count"))
        after.characterCount = nil
        after.caret = (107, 0)
        var b2 = before
        b2.characterCount = nil
        XCTAssertEqual(verify(b2, "bom dia", [after]).0, .confirmed(method: "caret"))
    }

    func testALatePasteInsideTheReadsStillConfirms() {
        XCTAssertEqual(verify(field("x"), "bom dia", [field("x"), field("x"), field("xbom dia")]).0, .confirmed(method: "value"))
    }

    /// O Chromium ignorou o ⌘V: o mesmo campo, igualzinho, nas três leituras.
    func testTheSameFieldUnchangedThroughTheLastReadDidntLand() {
        let (v, waited) = verify(field("Olá "), "bom dia", [field("Olá "), field("Olá "), field("Olá ")])
        XCTAssertEqual(v, .notLanded(reason: "value_count_caret_unchanged"))
        XCTAssertEqual(waited, 3)
        XCTAssertEqual(PasteCheck.delays.reduce(0, +), 2.0, accuracy: 1e-9)
    }

    func testAnyDoubtIsUnknownAndNothingGetsTyped() {
        // O foco foi para outro campo.
        XCTAssertEqual(verify(field("a"), "bom dia", [field("a", element: 2)]).0, .unknown(reason: "focus_moved"))
        // Uma leitura falhou no meio: podia esconder uma edição.
        XCTAssertEqual(verify(field("a"), "bom dia", [field("a"), nil, field("a")]).0, .unknown(reason: "intermittent_read_failure"))
        // Algo mudou, mas não o nosso texto (a pessoa escreveu outra coisa, o app reformatou).
        XCTAssertEqual(verify(field("a"), "bom dia", [field("ab")]).0, .unknown(reason: "changed_without_text"))
        // Não é um campo de texto (um contêiner de editor rico).
        var div = field("a")
        div.role = "AXGroup"
        XCTAssertEqual(verify(div, "bom dia", [field("a")]).0, .unknown(reason: "not_a_text_field"))
        // Nada legível antes.
        XCTAssertEqual(verify(PasteSnapshot(element: 1, role: "AXTextField"), "bom dia", []).0, .unknown(reason: "before_unreadable"))
        // Um novo ditado começou no meio.
        XCTAssertEqual(verify(field("a"), "bom dia", [field("a"), field("a"), field("a")], waits: 1).0, .unknown(reason: "cancelled"))
        // Sem cursor: falta sinal.
        let noCaret = PasteSnapshot(element: 1, role: "AXTextField", value: "a", characterCount: 1, caret: nil)
        XCTAssertEqual(verify(noCaret, "bom dia", [noCaret]).0, .unknown(reason: "signals_incomplete"))
    }

    func testTheSameTextAlreadyThereNeedsOneMoreToConfirm() {
        XCTAssertEqual(verify(field("bom dia "), "bom dia", [field("bom dia "), field("bom dia "), field("bom dia ")]).0,
                       .notLanded(reason: "value_count_caret_unchanged"))
        XCTAssertEqual(verify(field("bom dia "), "bom dia", [field("bom dia bom dia")]).0, .confirmed(method: "value"))
    }

    func testThePersonsKeyAfterThePasteMeansDontType() {
        XCTAssertTrue(PasteCheck.userActedAfterPaste(secondsSinceLastInput: 0.5, secondsSincePaste: 1.8))
        XCTAssertFalse(PasteCheck.userActedAfterPaste(secondsSinceLastInput: 1.78, secondsSincePaste: 1.8), "our own ⌘V")
    }

    func testTypingGoesInShortPiecesAndANewLineIsShiftReturn() {
        XCTAssertEqual(TypingPlan.steps(for: "bom dia"), [.text("bom dia")])
        XCTAssertEqual(TypingPlan.steps(for: "a\nb\r\nc"), [.text("a"), .newline, .text("b"), .newline, .text("c")])
        XCTAssertEqual(TypingPlan.steps(for: "\n"), [.newline])
        let long = String(repeating: "ã", count: 45)
        let steps = TypingPlan.steps(for: long)
        XCTAssertEqual(steps.count, 3)
        for case .text(let s) in steps { XCTAssertLessThanOrEqual(s.utf16.count, TypingPlan.chunk) }
        // Um emoji (2 unidades UTF-16) nunca é partido entre dois eventos.
        let emoji = String(repeating: "a", count: 19) + "😀b"
        XCTAssertEqual(TypingPlan.steps(for: emoji), [.text(String(repeating: "a", count: 19)), .text("😀b")])
        XCTAssertEqual(steps.map { if case .text(let s) = $0 { return s } else { return "\n" } }.joined(), long)
    }
}
