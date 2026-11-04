import Carbon.HIToolbox
import Foundation

/// What the current keyboard layout types on a key (UCKeyTranslate), for the ⌘V of the Inserter and the letter of
/// the Notes combination (T1653). Called from the main run loop, where the hotkey tap runs.
enum KeyboardLayout {
    /// Runs `body` with a translator for the current layout: (key code, ⌘ held) → the one character it types, or nil.
    /// Nil when the layout has no Unicode data (some input methods).
    static func withCurrent<T>(_ body: ((UInt16, Bool) -> Character?) -> T) -> T? {
        guard let source = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue(),
              let pointer = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) else { return nil }
        let data = Unmanaged<CFData>.fromOpaque(pointer).takeUnretainedValue() as Data
        return data.withUnsafeBytes { raw -> T? in
            guard let layout = raw.baseAddress?.assumingMemoryBound(to: UCKeyboardLayout.self) else { return nil }
            let commandState = UInt32((cmdKey >> 8) & 0xFF)
            return body { code, command in
                var deadKeys: UInt32 = 0
                var length = 0
                var chars = [UniChar](repeating: 0, count: 4)
                let status = UCKeyTranslate(layout, code, UInt16(kUCKeyActionDown), command ? commandState : 0, UInt32(LMGetKbdType()),
                                            OptionBits(kUCKeyTranslateNoDeadKeysBit), &deadKeys, chars.count, &length, &chars)
                guard status == noErr, length == 1 else { return nil }
                return Character(String(utf16CodeUnits: chars, count: 1))
            }
        }
    }

    /// The character `keyCode` types without modifiers (or with ⌘ only), or nil.
    static func character(forKeyCode keyCode: Int64, withCommand: Bool) -> Character? {
        guard (0..<128).contains(keyCode) else { return nil }
        return withCurrent { $0(UInt16(keyCode), withCommand) } ?? nil
    }
}
