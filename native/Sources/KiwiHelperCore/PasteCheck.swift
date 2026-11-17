// Portado de FluidVoice/Sources/Fluid/Services/PasteVerifier.swift @ b6457f1 (GPL-3.0). Mudanças: só o veredito
// (`confirmation`, `unchangedVerdict` e as três leituras), puro e testável, com o elemento por um id e as leituras do
// Accessibility injetadas; sem o `PasteRecoveryEvidence` nem o aviso de "copiar o texto". Quando a colagem com certeza
// não entrou, o Kiwi digita o texto (L12, T5835, issue #163): o Chromium às vezes ignora o ⌘V.

import Foundation

/// O campo de texto em foco, lido pelo Accessibility antes e depois da colagem. Nunca um campo de senha.
public struct PasteSnapshot: Equatable, Sendable {
    /// O mesmo campo nas duas leituras (o foco não saiu dele).
    public var element: Int
    public var role: String
    /// O texto do campo, se ele é pequeno o bastante para ler (`maxReadableCharacters`).
    public var value: String?
    public var characterCount: Int?
    /// O cursor (posição e tamanho da seleção).
    public var caret: (location: Int, length: Int)?

    public init(element: Int, role: String, value: String? = nil, characterCount: Int? = nil, caret: (location: Int, length: Int)? = nil) {
        self.element = element
        self.role = role
        self.value = value
        self.characterCount = characterCount
        self.caret = caret
    }

    public static func == (a: PasteSnapshot, b: PasteSnapshot) -> Bool {
        a.element == b.element && a.role == b.role && a.value == b.value && a.characterCount == b.characterCount
            && a.caret?.location == b.caret?.location && a.caret?.length == b.caret?.length
    }

    /// Para o log: tamanhos e posições, nunca o texto.
    public var summary: String {
        "role=\(role) valueLen=\(value.map { String($0.count) } ?? "nil") chars=\(characterCount.map(String.init) ?? "nil") "
            + "caret=\(caret.map { "\($0.location)+\($0.length)" } ?? "nil")"
    }
}

public enum PasteVerdict: Equatable, Sendable {
    /// O texto entrou (pelo valor, pela contagem ou pelo cursor).
    case confirmed(method: String)
    /// Com certeza não entrou: o mesmo campo, o mesmo valor (ou contagem) e o mesmo cursor até a última leitura.
    case notLanded(reason: String)
    /// Não dá para saber: o foco mudou, a leitura falhou, algo mudou sem ser o texto. Na dúvida, nada é digitado.
    case unknown(reason: String)

    public var log: String {
        switch self {
        case .confirmed(let m): return "confirmed (\(m))"
        case .notLanded(let r): return "not landed (\(r))"
        case .unknown(let r): return "unknown (\(r))"
        }
    }
}

public enum PasteCheck {
    /// Os papéis de campo de texto. Um contêiner genérico (o editor rico de uma página) pode dar contagens de mentira.
    public static let textRoles: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox"]
    /// Acima disto o valor não é lido; a contagem e o cursor ainda servem.
    public static let maxReadableCharacters = 60_000
    /// As três leituras depois do ⌘V (FluidVoice): uma colagem atrasada dentro delas não vira "não entrou".
    public static let delays: [TimeInterval] = [0.15, 0.35, 1.5]

    /// Uma tecla ou um clique da pessoa depois da colagem (o Enter de enviar): um campo igual não prova nada.
    /// O nosso ⌘V cai no instante da colagem: essa janela não conta.
    public static func userActedAfterPaste(secondsSinceLastInput: TimeInterval, secondsSincePaste: TimeInterval) -> Bool {
        secondsSinceLastInput < secondsSincePaste - 0.05
    }

    /// O veredito, com as três leituras depois do ⌘V. `capture` lê o campo agora (nil: não deu para ler); `wait`
    /// espera e diz se ainda vale a pena (false: um novo ditado começou, ou a pessoa mexeu no campo).
    public static func verify(
        before: PasteSnapshot,
        pastedText: String,
        capture: () -> PasteSnapshot?,
        wait: (TimeInterval) -> Bool
    ) -> PasteVerdict {
        let needle = normalize(pastedText)
        guard !needle.isEmpty else { return .unknown(reason: "empty_text") }
        guard before.value != nil || before.characterCount != nil || before.caret != nil else {
            return .unknown(reason: "before_unreadable")
        }
        guard textRoles.contains(before.role) else { return .unknown(reason: "not_a_text_field") }
        var unreadable = false
        for (index, delay) in delays.enumerated() {
            guard wait(delay) else { return .unknown(reason: "cancelled") }
            guard let after = capture() else {
                unreadable = true
                continue
            }
            guard after.element == before.element else { return .unknown(reason: "focus_moved") }
            if let verdict = confirmation(before: before, after: after, needle: needle) { return verdict }
            if let verdict = unchanged(before: before, after: after) { return verdict }
            if index == delays.count - 1 {
                // Uma leitura que falhou pode esconder uma edição entre as outras.
                return unreadable ? .unknown(reason: "intermittent_read_failure") : .notLanded(reason: "value_count_caret_unchanged")
            }
        }
        return .unknown(reason: "after_unreadable")
    }

    /// `unknown` quando falta sinal ou algo além do texto mudou; nil quando está tudo exatamente como antes.
    static func unchanged(before: PasteSnapshot, after: PasteSnapshot) -> PasteVerdict? {
        let valueKnown = before.value != nil && after.value != nil
        let countKnown = before.characterCount != nil && after.characterCount != nil
        let caretKnown = before.caret != nil && after.caret != nil
        guard valueKnown || countKnown, caretKnown else {
            return .unknown(reason: "signals_incomplete")
        }
        guard !valueKnown || before.value == after.value,
              !countKnown || before.characterCount == after.characterCount,
              before.caret?.location == after.caret?.location,
              before.caret?.length == after.caret?.length
        else { return .unknown(reason: "changed_without_text") }
        return nil
    }

    static func confirmation(before: PasteSnapshot, after: PasteSnapshot, needle: String) -> PasteVerdict? {
        if let afterValue = after.value {
            let beforeCount = before.value.map { occurrences(of: needle, in: normalize($0)) } ?? 0
            if occurrences(of: needle, in: normalize(afterValue)) > beforeCount { return .confirmed(method: "value") }
        }
        let inserted = needle.utf16.count
        let delta = inserted - (before.caret?.length ?? 0)
        if let b = before.characterCount, let a = after.characterCount, a != b, a - b == delta || a - b == delta + 1 {
            return .confirmed(method: "count")
        }
        if let b = before.caret, let a = after.caret, a.location - b.location == inserted, a.length == 0 {
            return .confirmed(method: "caret")
        }
        return nil
    }

    static func normalize(_ text: String) -> String {
        text.replacingOccurrences(of: "\r\n", with: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func occurrences(of needle: String, in haystack: String) -> Int {
        guard !needle.isEmpty else { return 0 }
        return haystack.components(separatedBy: needle).count - 1
    }
}

/// Digitar o texto quando a colagem não entrou (L12): pedaços curtos de Unicode e, nas quebras de linha, ⇧↩ (um ↩
/// sozinho enviaria a mensagem num chat).
public enum TypingPlan: Equatable, Sendable {
    case text(String)
    case newline

    /// O máximo de unidades UTF-16 por evento: o macOS corta o `CGEventKeyboardSetUnicodeString` em 20.
    public static let chunk = 20

    public static func steps(for text: String) -> [TypingPlan] {
        var out: [TypingPlan] = []
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n")
        for (i, line) in normalized.split(separator: "\n", omittingEmptySubsequences: false).enumerated() {
            if i > 0 { out.append(.newline) }
            var piece = ""
            for ch in line {
                // Nunca parte um caractere (um emoji, um acento combinado) entre dois eventos.
                if piece.utf16.count + String(ch).utf16.count > chunk {
                    out.append(.text(piece))
                    piece = ""
                }
                piece.append(ch)
            }
            if !piece.isEmpty { out.append(.text(piece)) }
        }
        return out
    }
}
