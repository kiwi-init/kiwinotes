import Foundation

/// A key with its modifiers, like ⌃⌥N or ⌘⇧Espaço: a combination the hotkey tap watches for, or one step of a
/// sequence (T5349, #175). The first ones opened the Notes window (`hotkey.notes`, T1499).
///
/// The letter is the one the current keyboard layout types, as in the menus of the Mac: on Dvorak, ⌃⌥N is the key
/// that types N, not the QWERTY N key (T1653). On a layout without Latin letters (Russian, Greek) the key falls back
/// to its US position, as macOS does for ⌘ shortcuts. A named key (F5, Espaço, Esc…) is always its own position.
public struct KeyCombo: Hashable, Sendable {
    public enum Modifier: String, CaseIterable, Sendable {
        case control, option, command, shift

        /// kCGEventFlagMaskControl, …Alternate, …Command, …Shift: either side of the key.
        public var mask: UInt64 {
            switch self {
            case .control: return 0x4_0000
            case .option: return 0x8_0000
            case .command: return 0x10_0000
            case .shift: return 0x2_0000
            }
        }

        /// The order of the menus of the Mac (⌃⌥⇧⌘), which is also the order of `spec`.
        static let menuOrder: [Modifier] = [.control, .option, .shift, .command]
    }

    /// The key: a letter or digit, lowercase, or a named key (`f5`, `space`, `escape`…).
    public let key: String
    /// Where the key is on a US keyboard: the fallback when the layout doesn't type a Latin letter or digit there.
    public let keyCode: Int64
    public let modifiers: Set<Modifier>

    /// Carbon virtual key codes of the ANSI letters and digits (kVK_ANSI_A …): read through the layout.
    static let layoutKeyCodes: [String: Int64] = [
        "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13,
        "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "9": 25, "7": 26,
        "8": 28, "0": 29, "o": 31, "u": 32, "i": 34, "p": 35, "l": 37, "j": 38, "k": 40, "n": 45, "m": 46,
    ]

    /// Keys that are where they are on every layout (kVK_F1 …, kVK_Space, kVK_Escape…).
    static let namedKeyCodes: [String: Int64] = [
        "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100, "f9": 101, "f10": 109,
        "f11": 103, "f12": 111, "f13": 105, "f14": 107, "f15": 113, "f16": 106, "f17": 64, "f18": 79, "f19": 80,
        "f20": 90, "space": 49, "escape": 53, "return": 36, "tab": 48, "delete": 51,
        "left": 123, "right": 124, "down": 125, "up": 126,
    ]

    /// The name of a key code, for the shortcut recorder: a named key, or the US letter or digit there.
    public static func name(ofKeyCode code: Int64) -> String? {
        namedKeyCodes.first { $0.value == code }?.key ?? layoutKeyCodes.first { $0.value == code }?.key
    }

    /// "control+option+n" (ADR 0001): modifiers and one key, joined by `+`, in any order and case. On its own it
    /// needs one of ⌃, ⌥ and ⌘, so plain typing (or ⇧ + a letter) never triggers it; an F key needs nothing.
    /// `bare`: a later step of a sequence (⌃K and then R), which may be a plain key. Nil when it doesn't parse.
    public init?(_ spec: String, bare: Bool = false) {
        var modifiers = Set<Modifier>()
        var key: (String, Int64)?
        for part in spec.lowercased().split(separator: "+", omittingEmptySubsequences: false).map(String.init) {
            if let modifier = Modifier(rawValue: part) {
                guard modifiers.insert(modifier).inserted else { return nil }
            } else if key == nil, let code = Self.layoutKeyCodes[part] ?? Self.namedKeyCodes[part] {
                key = (part, code)
            } else {
                return nil
            }
        }
        guard let key else { return nil }
        self.key = key.0
        self.keyCode = key.1
        self.modifiers = modifiers
        guard bare || isFunctionKey || !modifiers.subtracting([.shift]).isEmpty else { return nil }
    }

    /// F1 to F20: a shortcut on its own, without modifiers, because nobody types with them.
    public var isFunctionKey: Bool { key.count > 1 && key.hasPrefix("f") }

    /// A letter or digit, which is read through the keyboard layout.
    var readsLayout: Bool { Self.layoutKeyCodes[key] != nil }

    /// A named key with no modifiers (Esc, ⌫, ↩…): only for a shortcut that is armed just while recording (L5).
    var isBareNamedKey: Bool { modifiers.isEmpty && !readsLayout }

    /// The canonical text: the modifiers in the order of the menus, then the key ("control+option+n").
    public var spec: String {
        (Modifier.menuOrder.filter(modifiers.contains).map(\.rawValue) + [key]).joined(separator: "+")
    }

    /// Whether the layout should be read with ⌘ held: on the "… – QWERTY ⌘" layouts, ⌘ switches to QWERTY.
    public var usesCommandLayer: Bool { modifiers.contains(.command) }

    /// The modifiers held in these flags.
    static func modifiers(in flags: UInt64) -> Set<Modifier> {
        Set(Modifier.allCases.filter { flags & $0.mask != 0 })
    }

    /// A key-down event is this combination: exactly these modifiers, and the key that types this letter. Caps Lock,
    /// Fn and the left/right bits don't count; an extra ⇧ or ⌘ does (⌃⌥⇧N is not ⌃⌥N). A held key's auto-repeat
    /// doesn't fire it again. `typed` is what the current layout types on `keyCode` without modifiers (nil when it
    /// can't tell); it is only asked for once the modifiers match, and only for a letter or digit.
    public func matches(keyCode: Int64, flags: UInt64, autorepeat: Bool = false, typed: () -> Character? = { nil }) -> Bool {
        guard !autorepeat, Self.modifiers(in: flags) == modifiers else { return false }
        guard readsLayout else { return keyCode == self.keyCode }
        if let letter = typed().map({ Character($0.lowercased()) }), letter.isASCII, letter.isLetter || letter.isNumber {
            return String(letter) == key
        }
        return keyCode == self.keyCode
    }

    /// The combination's own modifier for a dictation key that is one (⌥ right is ⌥), or nil (Fn).
    static func modifier(of key: HotkeyKey) -> Modifier? {
        switch key {
        case .fn: return nil
        case .rightOption: return .option
        case .rightCommand: return .command
        case .rightControl, .control: return .control
        }
    }

    /// T1653: the dictation key went down while the rest of this combination's modifiers were already held (⌃ and
    /// then the ⌥ right of ⌃⌥N, with the ⌥ right as the dictation key). That press is the start of the combination,
    /// not a dictation: starting to record would only flash the pill and cancel on the N.
    public func startsWith(_ key: HotkeyKey, flags: UInt64) -> Bool {
        guard let own = Self.modifier(of: key), modifiers.contains(own) else { return false }
        let others = modifiers.subtracting([own, .shift])
        return !others.isEmpty && others.allSatisfy { flags & $0.mask != 0 }
    }
}
