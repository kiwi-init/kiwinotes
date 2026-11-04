import Foundation

/// A global key combination, like ⌃⌥N, that the hotkey tap watches for on top of the dictation key. The first one
/// opens the Notes window (`hotkey.notes`, T1499). The tap is listen-only: the keystroke still reaches the app in
/// front, which for these combinations normally does nothing.
///
/// The letter is the one the current keyboard layout types, as in the menus of the Mac: on Dvorak, ⌃⌥N is the key
/// that types N, not the QWERTY N key (T1653). On a layout without Latin letters (Russian, Greek) the key falls back
/// to its US position, as macOS does for ⌘ shortcuts.
public struct KeyCombo: Equatable, Sendable {
    public enum Modifier: String, CaseIterable, Sendable {
        case control, option, command, shift

        /// kCGEventFlagMaskControl, …Alternate, …Command, …Shift: either side of the key.
        var mask: UInt64 {
            switch self {
            case .control: return 0x4_0000
            case .option: return 0x8_0000
            case .command: return 0x10_0000
            case .shift: return 0x2_0000
            }
        }
    }

    /// The letter or digit, lowercase.
    public let key: Character
    /// Where the key is on a US keyboard: the fallback when the layout doesn't type a Latin letter or digit there.
    public let keyCode: Int64
    public let modifiers: Set<Modifier>

    /// Carbon virtual key codes of the ANSI letters and digits (kVK_ANSI_A …), the keys a combination can end in.
    static let keyCodes: [Character: Int64] = [
        "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13,
        "e": 14, "r": 15, "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "9": 25, "7": 26,
        "8": 28, "0": 29, "o": 31, "u": 32, "i": 34, "p": 35, "l": 37, "j": 38, "k": 40, "n": 45, "m": 46,
    ]

    /// "control+option+n" (ADR 0001): modifiers and one letter or digit, joined by `+`, in any order and case.
    /// Needs at least one of ⌃, ⌥ and ⌘, so plain typing (or ⇧ + a letter) never triggers it. Nil when it doesn't parse.
    public init?(_ spec: String) {
        var modifiers = Set<Modifier>()
        var key: (Character, Int64)?
        for part in spec.lowercased().split(separator: "+", omittingEmptySubsequences: false) {
            if let modifier = Modifier(rawValue: String(part)) {
                guard modifiers.insert(modifier).inserted else { return nil }
            } else if part.count == 1, let code = Self.keyCodes[part.first!], key == nil {
                key = (part.first!, code)
            } else {
                return nil
            }
        }
        guard let key, !modifiers.subtracting([.shift]).isEmpty else { return nil }
        self.key = key.0
        self.keyCode = key.1
        self.modifiers = modifiers
    }

    /// Whether the layout should be read with ⌘ held: on the "… – QWERTY ⌘" layouts, ⌘ switches to QWERTY.
    public var usesCommandLayer: Bool { modifiers.contains(.command) }

    /// A key-down event is this combination: exactly these modifiers, and the key that types this letter. Caps Lock,
    /// Fn and the left/right bits don't count; an extra ⇧ or ⌘ does (⌃⌥⇧N is not ⌃⌥N). A held key's auto-repeat
    /// doesn't fire it again. `typed` is what the current layout types on `keyCode` without modifiers (nil when it
    /// can't tell); it is only asked for once the modifiers match.
    public func matches(keyCode: Int64, flags: UInt64, autorepeat: Bool = false, typed: () -> Character? = { nil }) -> Bool {
        guard !autorepeat, Set(Modifier.allCases.filter { flags & $0.mask != 0 }) == modifiers else { return false }
        if let letter = typed().map({ Character($0.lowercased()) }), letter.isASCII, letter.isLetter || letter.isNumber {
            return letter == key
        }
        return keyCode == self.keyCode
    }

    /// The combination's own modifier for a dictation key that is one (⌥ right is ⌥), or nil (Fn).
    static func modifier(of key: HotkeyKey) -> Modifier? {
        switch key {
        case .fn: return nil
        case .rightOption: return .option
        case .rightCommand: return .command
        case .rightControl: return .control
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
