import Foundation

/// The "aperte o atalho" of Settings (T5349, #175): turns what the person presses into a shortcut's text. The tap
/// reads the keys, not the WebView, because the WebView doesn't see the Fn key nor which side a modifier is on.
/// Pure, like `ShortcutEngine`: events and times in, the outcome out.
///
/// It ends when nothing has been pressed for `finishAfter` and every key is up: one modifier tapped is `fn`, tapped
/// twice `double:fn`, one combination `control+option+r`, more than one a sequence `control+k r r`. Esc on its own,
/// first, cancels.
public struct ShortcutRecorder {
    public enum Outcome: Equatable, Sendable {
        case recorded(String)
        case cancelled
        /// Not a shortcut: a plain letter, ⇧ and a letter, a key it doesn't know, too many steps or taps.
        case invalid
    }

    public var finishAfter: TimeInterval
    public var typed: (_ keyCode: Int64, _ withCommand: Bool) -> Character?
    /// A named key on its own (⌫, ↩…) is a shortcut too: recording the cancel of the dictation (L5). Esc first still
    /// cancels the recording; "Padrão" brings the Esc back.
    public var bareKey = false

    private var taps: [HotkeyKey] = []
    private var heldModifier: (key: HotkeyKey, clean: Bool)?
    private var steps: [String] = []
    private var heldKeys: Set<Int64> = []
    private var lastActivity: TimeInterval?
    private var broken = false
    public private(set) var outcome: Outcome?

    public init(finishAfter: TimeInterval = 0.8, typed: @escaping (Int64, Bool) -> Character? = { _, _ in nil }) {
        self.finishAfter = finishAfter
        self.typed = typed
    }

    /// When `tick` has to be called to end the recording.
    public var deadline: TimeInterval? {
        guard outcome == nil, let lastActivity, heldKeys.isEmpty, heldModifier == nil, !(steps.isEmpty && taps.isEmpty) else { return nil }
        return lastActivity + finishAfter
    }

    public mutating func feed(_ input: KeyInput, at t: TimeInterval) {
        guard outcome == nil else { return }
        switch input {
        case .flags(let code, let flags):
            // O Control dos dois lados é só do agente (spec #9876): o gravador oferece o ⌃ direito, como antes.
            if let key = HotkeyKey.allCases.first(where: { $0 != .control && $0.keyCode == code }), let down = key.isDown(keyCode: code, flags: flags) {
                lastActivity = t
                if down {
                    if heldModifier != nil { heldModifier?.clean = false } else { heldModifier = (key, steps.isEmpty) }
                } else if let held = heldModifier, held.key == key {
                    heldModifier = nil
                    if held.clean, steps.isEmpty {
                        if let last = taps.last, last != key { taps = [] }
                        taps.append(key)
                    }
                }
            } else {
                heldModifier?.clean = false
            }
        case .keyDown(let code, let flags, let autorepeat):
            guard !autorepeat else { return }
            lastActivity = t
            heldModifier?.clean = false
            taps = []
            heldKeys.insert(code)
            let modifiers = KeyCombo.modifiers(in: flags)
            if steps.isEmpty, code == 53, modifiers.isEmpty {
                outcome = .cancelled
                return
            }
            guard let name = name(of: code, command: modifiers.contains(.command)) else {
                broken = true
                return
            }
            steps.append((KeyCombo.Modifier.menuOrder.filter(modifiers.contains).map(\.rawValue) + [name]).joined(separator: "+"))
        case .keyUp(let code, _):
            heldKeys.remove(code)
            lastActivity = t
        case .mouseDown:
            break // the tap only sends clicks to the shortcuts (spec #9876)
        }
    }

    /// The key's name: the letter or digit the layout types there, or the named key.
    private func name(of code: Int64, command: Bool) -> String? {
        if KeyCombo.layoutKeyCodes.values.contains(code), let typed = typed(code, command).map({ String($0).lowercased() }),
           KeyCombo.layoutKeyCodes[typed] != nil {
            return typed
        }
        return KeyCombo.name(ofKeyCode: code)
    }

    @discardableResult
    public mutating func tick(now: TimeInterval) -> Outcome? {
        guard let deadline, now >= deadline else { return outcome }
        if broken {
            outcome = .invalid
        } else if !steps.isEmpty {
            outcome = Shortcut(steps.joined(separator: " "), bareKey: bareKey).map { .recorded($0.spec) } ?? .invalid
        } else if taps.count == 1 {
            outcome = .recorded(Shortcut.key(taps[0]).spec)
        } else if taps.count == 2 {
            outcome = .recorded(Shortcut.doubleTap(taps[0]).spec)
        } else {
            outcome = .invalid
        }
        return outcome
    }
}
