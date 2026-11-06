import AppKit
import ApplicationServices
import Carbon.HIToolbox
import KiwiHelperCore

// Partes portadas de VoiceInk/VoiceInk/Infrastructure/SystemIntegration/Paste/CursorPaster.swift @ 19546d2 (GPL-3.0).
// Mudanças: só o caminho do ⌘V por CGEvent (sem AppleScript, digitação direta ou remota, SmartPunctuation e
// AutoLearn); o `prePasteDelay`, os 2 s máximos da devolução do clipboard e a sequência ⌘↓ V↓ V↑ ⌘↑ com a fonte privada vêm
// de lá. A tecla do V segue o layout atual com ⌘ apertado, e não a física fixa. A decisão por foco, o secure
// input e o `changeCount` como dono do clipboard são nossos.

/// `insert.text`: puts the dictated text into the focused field with ⌘V and gives the person's clipboard back.
/// Pasting works the same in every app (Cocoa, Electron, terminals, browsers); typing through Accessibility
/// (`AXSelectedText`) is ignored by Electron and terminals, so it isn't used.
final class Inserter {
    /// Between putting the text on the clipboard and the ⌘V (VoiceInk's `prePasteDelay`): the focus and the
    /// pasteboard settle first, so the target app reads our text and not the previous content.
    static let prePasteDelay: TimeInterval = 0.2
    /// When the person's content goes back after ⌘V (L11, T5834): as soon as the app in front has read the text
    /// (`RestoreSchedule`, with a pasteboard promise), and at most 2 s later, VoiceInk's old fixed time. A copy made
    /// in the meantime is never overwritten (`changeCount`).
    /// Between the four key events, so apps that track the modifier state see ⌘ down before V.
    static let keyEventGap: useconds_t = 10_000

    struct Outcome {
        let pasted: Bool
        /// Whether the person's clipboard goes back after the paste.
        let restored: Bool
        let reason: String?
        let app: String?
        /// A space went in front of the text, because it landed right after other text (T733).
        var spaced = false
        /// Where Accessibility found the focus: "system", "app" (asked the front app, T984) or "none". For the log.
        var focusVia = "none"
    }

    private let keeper = ClipboardKeeper()
    private let keys = DispatchQueue(label: "kiwi.insert.keys", qos: .userInteractive)
    private var jobs: [(text: String, restore: Bool, autoSpace: Bool, completion: (Outcome) -> Void)] = []
    private var busy = false

    /// Main thread. One insert at a time, in order: a second dictation waits for the first one's ⌘V (not for its
    /// restore). `completion` runs once the paste is posted; the clipboard goes back once the app read it (L11).
    /// `autoSpace`: a space in front when the text lands right after other text (off for the literal tone, T733).
    func insert(_ text: String, restoreClipboard: Bool, autoSpace: Bool = true, completion: @escaping (Outcome) -> Void) {
        jobs.append((text, restoreClipboard, autoSpace, completion))
        runNext()
    }

    private func runNext() {
        guard !busy, !jobs.isEmpty else { return }
        busy = true
        let job = jobs.removeFirst()
        perform(job.text, restoreClipboard: job.restore, autoSpace: job.autoSpace) { [weak self] outcome in
            job.completion(outcome)
            self?.busy = false
            self?.runNext()
        }
    }

    private func perform(_ text: String, restoreClipboard: Bool, autoSpace: Bool, completion: @escaping (Outcome) -> Void) {
        let app = NSWorkspace.shared.frontmostApplication
        let trusted = AXIsProcessTrusted()
        let focused = trusted ? Self.focus(app: app?.processIdentifier) : (info: nil, element: nil, via: "none")
        let plan = InsertPlan.decide(accessibilityGranted: trusted, secureInput: IsSecureEventInputEnabled(), focus: focused.info,
                                     frontApp: app != nil)
        let pasteboard = NSPasteboard.general

        let reason: String?
        switch plan {
        case .clipboardOnly(let why):
            // No field: the text stays on the clipboard for the person to paste, and the app tells them.
            keeper.put(text, on: pasteboard, keepOriginal: false)
            return completion(Outcome(pasted: false, restored: false, reason: why, app: app?.bundleIdentifier,
                                      focusVia: focused.via))
        case .pasteKeepingText(let why):
            reason = why
        case .paste:
            reason = nil
        }

        // Only the two characters before the caret are read, and they go nowhere (no log, no reply). Never in a
        // password field or with Secure Event Input on (`mayRead`).
        let spaced = autoSpace && LeadingSpace.mayRead(plan: plan, role: focused.info?.role)
            && LeadingSpace.needed(before: focused.element.flatMap(Self.textBeforeCaret), text: text)
        let restore = restoreClipboard && reason == nil
        let timer = RestoreTimer { [keeper] ours in keeper.restore(on: pasteboard, ifStill: ours) }
        let ours = keeper.put(spaced ? " " + text : text, on: pasteboard, keepOriginal: restore,
                              onRead: restore ? { timer.read() } : nil)
        timer.ours = ours
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.prePasteDelay) { [keys] in
            keys.async {
                Self.postCommandV()
                DispatchQueue.main.async {
                    completion(Outcome(pasted: true, restored: restore, reason: reason, app: app?.bundleIdentifier,
                                       spaced: spaced, focusVia: focused.via))
                    if restore { timer.pasted() }
                }
            }
        }
    }

    /// One restore (L11): the ⌘V and the reads come in, and the restore runs once, at `RestoreSchedule.restoreAt`.
    /// Main thread only.
    private final class RestoreTimer {
        var ours = 0
        private var schedule = RestoreSchedule()
        private var work: DispatchWorkItem?
        private var done = false
        private let run: (Int) -> Void

        init(run: @escaping (Int) -> Void) { self.run = run }

        func pasted() {
            schedule.pasted(at: ProcessInfo.processInfo.systemUptime)
            arm()
        }

        func read() {
            if schedule.read(at: ProcessInfo.processInfo.systemUptime) { arm() }
        }

        private func arm() {
            guard !done, let at = schedule.restoreAt else { return }
            work?.cancel()
            let item = DispatchWorkItem { [self] in
                guard !done else { return }
                done = true
                run(ours)
            }
            work = item
            DispatchQueue.main.asyncAfter(deadline: .now() + max(0, at - ProcessInfo.processInfo.systemUptime), execute: item)
        }
    }

    /// How long an Accessibility call may block. The default is ~6 s, on the main thread: a frozen app in front
    /// would freeze the hotkey, the overlay and the IPC with it.
    static let axTimeout: Float = 0.25

    /// The focused element of the frontmost app, as Accessibility sees it: `info` is nil when nothing has focus,
    /// `.unanswered` when the app didn't reply within `axTimeout`. `element` is there only when it has a caret.
    /// `app`: the frontmost app's pid. When the system-wide lookup finds no focused element, the app itself is asked:
    /// the new Teams (a WebView) answers only there (T984, #997). Read-only: nothing is switched on in the app.
    static func focus(app: pid_t? = nil) -> (info: FocusInfo?, element: AXUIElement?, via: String) {
        var via = "system"
        let system = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(system, axTimeout)
        var value: CFTypeRef?
        switch AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &value) {
        case .success: break
        case .cannotComplete: return (.unanswered, nil, "system")
        default:
            guard let app else { return (nil, nil, "none") }
            let element = AXUIElementCreateApplication(app)
            AXUIElementSetMessagingTimeout(element, axTimeout)
            switch AXUIElementCopyAttributeValue(element, kAXFocusedUIElementAttribute as CFString, &value) {
            case .success: via = "app"
            case .cannotComplete: return (.unanswered, nil, "app")
            default: return (nil, nil, "none")
            }
        }
        guard let element = value, CFGetTypeID(element) == AXUIElementGetTypeID() else { return (nil, nil, "none") }
        let focused = element as! AXUIElement
        AXUIElementSetMessagingTimeout(focused, axTimeout)
        var role: CFTypeRef?
        if AXUIElementCopyAttributeValue(focused, kAXRoleAttribute as CFString, &role) == .cannotComplete {
            return (.unanswered, nil, via)
        }
        var range: CFTypeRef?
        let hasRange = AXUIElementCopyAttributeValue(focused, kAXSelectedTextRangeAttribute as CFString, &range) == .success
        return (FocusInfo(role: role as? String, hasSelectedTextRange: hasRange), hasRange ? focused : nil, via)
    }

    /// Up to the two characters before the caret (or the selection, which the paste replaces); "" at the start of
    /// the field; nil when the app doesn't say (T733). `AXStringForRange` first, so a long document isn't copied
    /// whole; `AXValue` for fields that only answer that.
    static func textBeforeCaret(_ element: AXUIElement) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &value) == .success,
              let value, CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
        var selection = CFRange()
        guard AXValueGetValue(value as! AXValue, .cfRange, &selection), selection.location >= 0 else { return nil }
        if selection.location == 0 { return "" }
        let start = max(0, selection.location - 2)
        var wanted = CFRange(location: start, length: selection.location - start)
        if let range = AXValueCreate(.cfRange, &wanted) {
            var text: CFTypeRef?
            if AXUIElementCopyParameterizedAttributeValue(
                element, kAXStringForRangeParameterizedAttribute as CFString, range, &text) == .success,
               let text = text as? String, !text.isEmpty {
                // Empty with the caret past the start is an app that doesn't really answer: try `AXValue` (#787).
                return text
            }
        }
        var whole: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &whole) == .success,
              let whole = whole as? String else { return nil }
        return LeadingSpace.tail(of: whole, caret: selection.location)
    }

    /// ⌘V as if typed, the way VoiceInk posts it: ⌘ down, V down, V up, ⌘ up, 10 ms apart, from a private event
    /// source, so a modifier still held from the hotkey (🌐, ⌥) doesn't mix in and turn it into ⌥⌘V. Off the main
    /// thread (it sleeps between events).
    static func postCommandV() {
        let v = keyCode(for: "v") ?? CGKeyCode(kVK_ANSI_V)
        let source = CGEventSource(stateID: .privateState)
        let steps: [(key: CGKeyCode, down: Bool, flags: CGEventFlags)] = [
            (CGKeyCode(kVK_Command), true, .maskCommand), (v, true, .maskCommand),
            (v, false, .maskCommand), (CGKeyCode(kVK_Command), false, []),
        ]
        for (i, step) in steps.enumerated() {
            guard let event = CGEvent(keyboardEventSource: source, virtualKey: step.key, keyDown: step.down) else { continue }
            event.flags = step.flags
            event.post(tap: .cghidEventTap)
            if i < steps.count - 1 { usleep(keyEventGap) }
        }
    }

    /// The virtual key that types `character` in the current keyboard layout with ⌘ held: on Dvorak it isn't the
    /// QWERTY V key, and on the "… – QWERTY ⌘" layouts ⌘ switches to QWERTY, so it is again.
    static func keyCode(for character: Character) -> CGKeyCode? {
        KeyboardLayout.withCurrent { translate in
            (0..<128).first { translate(UInt16($0), true) == character }.map { CGKeyCode($0) }
        } ?? nil
    }
}
