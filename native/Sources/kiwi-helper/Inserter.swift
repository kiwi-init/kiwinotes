import AppKit
import ApplicationServices
import Carbon.HIToolbox
import KiwiHelperCore

/// `insert.text`: puts the dictated text into the focused field with ⌘V and gives the person's clipboard back.
/// Pasting works the same in every app (Cocoa, Electron, terminals, browsers); typing through Accessibility
/// (`AXSelectedText`) is ignored by Electron and terminals, so it isn't used.
final class Inserter {
    /// How long the text stays on the clipboard after ⌘V before the old content goes back. Apps read the
    /// pasteboard when they handle the key, but Electron apps do it asynchronously; 300 ms covers them.
    static let restoreDelay: TimeInterval = 0.3

    struct Outcome {
        let pasted: Bool
        let reason: String?
        let app: String?
    }

    /// Main thread. `completion` runs once the paste is posted; the clipboard goes back `restoreDelay` later.
    func insert(_ text: String, restoreClipboard: Bool, completion: @escaping (Outcome) -> Void) {
        let app = NSWorkspace.shared.frontmostApplication
        let plan = InsertPlan.decide(accessibilityGranted: AXIsProcessTrusted(),
                                     secureInput: Self.secureInputBlocks && IsSecureEventInputEnabled(), focus: Self.focus())
        let pasteboard = NSPasteboard.general

        guard case .paste = plan else {
            // No field: the text stays on the clipboard for the person to paste, and the app tells them.
            ClipboardSnapshot.put(text, on: pasteboard, transient: false)
            if case .clipboardOnly(let reason) = plan {
                completion(Outcome(pasted: false, reason: reason, app: app?.bundleIdentifier))
            }
            return
        }

        let snapshot = restoreClipboard ? ClipboardSnapshot.take(pasteboard) : nil
        let ours = ClipboardSnapshot.put(text, on: pasteboard, transient: restoreClipboard)
        Self.postCommandV()
        completion(Outcome(pasted: true, reason: nil, app: app?.bundleIdentifier))
        guard let snapshot else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.restoreDelay) {
            snapshot.restore(to: pasteboard, ifStill: ours)
        }
    }

    /// `KIWI_PASTE_THROUGH_SECURE_INPUT=1` skips the secure-input refusal, to check live whether macOS really
    /// drops a posted ⌘V while some app holds Secure Event Input (review #215). Remove once settled.
    static let secureInputBlocks = ProcessInfo.processInfo.environment["KIWI_PASTE_THROUGH_SECURE_INPUT"] != "1"

    /// How long an Accessibility call may block. The default is ~6 s, on the main thread: a frozen app in front
    /// would freeze the hotkey, the overlay and the IPC with it.
    static let axTimeout: Float = 0.25

    /// The focused element of the frontmost app, as Accessibility sees it; nil when nothing has focus,
    /// `.unanswered` when the app didn't reply within `axTimeout`.
    static func focus() -> FocusInfo? {
        let system = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(system, axTimeout)
        var value: CFTypeRef?
        switch AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &value) {
        case .success: break
        case .cannotComplete: return .unanswered
        default: return nil
        }
        guard let element = value, CFGetTypeID(element) == AXUIElementGetTypeID() else { return nil }
        let focused = element as! AXUIElement
        AXUIElementSetMessagingTimeout(focused, axTimeout)
        var role: CFTypeRef?
        if AXUIElementCopyAttributeValue(focused, kAXRoleAttribute as CFString, &role) == .cannotComplete { return .unanswered }
        var range: CFTypeRef?
        let hasRange = AXUIElementCopyAttributeValue(focused, kAXSelectedTextRangeAttribute as CFString, &range) == .success
        return FocusInfo(role: role as? String, hasSelectedTextRange: hasRange)
    }

    /// ⌘V as if typed. Uses the key that types "v" in the current layout (on Dvorak it isn't the QWERTY V key),
    /// and sets only ⌘, so a modifier still held from the hotkey doesn't turn it into ⌥⌘V.
    static func postCommandV() {
        let key = keyCode(for: "v") ?? CGKeyCode(kVK_ANSI_V)
        let source = CGEventSource(stateID: .combinedSessionState)
        for down in [true, false] {
            guard let event = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: down) else { continue }
            event.flags = .maskCommand
            event.post(tap: .cghidEventTap)
        }
    }

    /// The virtual key that types `character` in the current keyboard layout, without modifiers.
    static func keyCode(for character: Character) -> CGKeyCode? {
        guard let source = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue(),
              let pointer = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) else { return nil }
        let data = Unmanaged<CFData>.fromOpaque(pointer).takeUnretainedValue() as Data
        return data.withUnsafeBytes { raw -> CGKeyCode? in
            guard let layout = raw.baseAddress?.assumingMemoryBound(to: UCKeyboardLayout.self) else { return nil }
            for code in 0..<128 {
                var deadKeys: UInt32 = 0
                var length = 0
                var chars = [UniChar](repeating: 0, count: 4)
                let status = UCKeyTranslate(layout, UInt16(code), UInt16(kUCKeyActionDown), 0, UInt32(LMGetKbdType()),
                                            OptionBits(kUCKeyTranslateNoDeadKeysBit), &deadKeys, chars.count, &length, &chars)
                if status == noErr, length == 1, String(utf16CodeUnits: chars, count: 1) == String(character) {
                    return CGKeyCode(code)
                }
            }
            return nil
        }
    }
}
