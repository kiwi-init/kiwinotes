import Foundation

/// A shortcut the person picks for one of Kiwi's actions (T5349, #175): the dictation, the meeting, the Notes window…
/// Four gestures, written as text in `config.set {shortcuts}` (ADR 0001):
///
/// | gesture | text | example |
/// |---|---|---|
/// | a modifier key on its own | its name | `fn`, `rightOption` |
/// | a modifier key tapped twice | `double:` and its name | `double:rightCommand` |
/// | a combination | modifiers and a key, with `+` | `control+option+r`, `command+shift+space`, `f5` |
/// | a sequence of 2 to 4 steps | the steps, with a space | `control+k r r`, `f5 f5` |
///
/// The first step of a sequence follows the rule of a combination (⌃, ⌥ or ⌘, or an F key); the later ones may be a
/// plain key. An F key tapped twice is the sequence `f5 f5`.
public enum Shortcut: Hashable, Sendable {
    case key(HotkeyKey)
    case doubleTap(HotkeyKey)
    case combo(KeyCombo)
    case sequence([KeyCombo])

    static let maxSteps = 4

    /// `bareKey`: a named key on its own (`escape`, `delete`, `return`…) is also a shortcut. Only for the cancel of the
    /// dictation (L5, T5458), which is armed just while recording, so typing never fires it.
    public init?(_ text: String, bareKey: Bool = false) {
        let text = text.trimmingCharacters(in: .whitespaces)
        if text.lowercased().hasPrefix("double:") {
            guard let key = Self.modifierKey(String(text.dropFirst("double:".count))) else { return nil }
            self = .doubleTap(key)
            return
        }
        if let key = Self.modifierKey(text) {
            self = .key(key)
            return
        }
        let parts = text.split(separator: " ").map(String.init)
        if bareKey, parts.count == 1, let step = KeyCombo(parts[0], bare: true), step.isBareNamedKey {
            self = .combo(step)
            return
        }
        guard (1...Self.maxSteps).contains(parts.count) else { return nil }
        var steps: [KeyCombo] = []
        for (i, part) in parts.enumerated() {
            guard let step = KeyCombo(part, bare: i > 0) else { return nil }
            steps.append(step)
        }
        self = steps.count == 1 ? .combo(steps[0]) : .sequence(steps)
    }

    /// `fn`, `rightOption`… in any case.
    private static func modifierKey(_ name: String) -> HotkeyKey? {
        HotkeyKey.allCases.first { $0.rawValue.lowercased() == name.lowercased() }
    }

    /// The canonical text, which `init` reads back.
    public var spec: String {
        switch self {
        case .key(let key): return key.rawValue
        case .doubleTap(let key): return "double:\(key.rawValue)"
        case .combo(let combo): return combo.spec
        case .sequence(let steps): return steps.map(\.spec).joined(separator: " ")
        }
    }
}

/// A keyboard event as the tap sees it.
public enum KeyInput: Equatable, Sendable {
    /// A modifier went down or up (`flagsChanged`).
    case flags(keyCode: Int64, flags: UInt64)
    case keyDown(keyCode: Int64, flags: UInt64, autorepeat: Bool)
    case keyUp(keyCode: Int64, flags: UInt64)
}

/// What the person does with a shortcut, for whoever uses it.
public enum ShortcutOutput: Equatable, Sendable {
    /// A modifier key or a combination went down. `flags` are the event's (the quick note looks for ⌥ in them).
    case press(String, flags: UInt64)
    /// It came up. `clean`: nothing else was pressed meanwhile (a modifier tapped on its own).
    case release(String, clean: Bool)
    /// Another key went down while it was held: it is being used as a modifier (Fn+F5, ⌥ right + a letter).
    /// `keyCode` lets the dictation ignore its own quick-note ⌥.
    case interrupt(String, keyCode: Int64)
    /// A double tap or a sequence was completed.
    case trigger(String)
}

/// Recognizes the shortcuts in the keyboard's events and says which events are Kiwi's (T5349, #175). Pure: the
/// events and their times come in, and what fired and what to do with each event come out, so `swift test` drives
/// it with fake events and a fake clock.
///
/// **Priority.** An event that is part of a shortcut is consumed: the active tap drops it, and the app in front never
/// sees it. That is the key-down of a combination (with its auto-repeat and its key-up) and every step of a
/// sequence. A modifier on its own (Fn, ⌥ right) always passes: dropping it would leave the other apps without the
/// modifier, and without the Fn+F5 or the ⌥ letters. The steps of a sequence are held back until it is complete; when
/// it breaks or times out they go back to the app, in order (`replay`), so typing ⌃K and then something else still
/// reaches the app.
public struct ShortcutEngine<Payload> {
    public typealias Input = KeyInput

    public struct Result {
        /// The event is Kiwi's: the tap drops it.
        public var consume = false
        public var outputs: [ShortcutOutput] = []
        /// Events held back by a sequence that didn't complete, to post again in this order (the current one last,
        /// when it was part of them).
        public var replay: [Payload] = []
    }

    public private(set) var bindings: [(id: String, shortcut: Shortcut)] = []
    /// The second tap of a double tap has to start within this time after the first one ends.
    public var doubleTapWindow: TimeInterval
    /// A tap longer than this isn't one of a double tap.
    public var tapThreshold: TimeInterval
    /// The next step of a sequence has to come within this time.
    public var sequenceWindow: TimeInterval
    /// What the current layout types on a key code (`withCommand`: read the ⌘ layer), for the letters.
    public var typed: (_ keyCode: Int64, _ withCommand: Bool) -> Character?
    /// Whether a shortcut is armed right now (L5, T5458: the cancel only while recording). Asked as each key arrives, so
    /// arming one never resets a gesture under way (the key held for push-to-talk).
    public var isActive: (_ id: String) -> Bool = { _ in true }

    public init(doubleTapWindow: TimeInterval = 0.35, tapThreshold: TimeInterval = 0.3, sequenceWindow: TimeInterval = 0.8,
                typed: @escaping (Int64, Bool) -> Character? = { _, _ in nil }) {
        self.doubleTapWindow = doubleTapWindow
        self.tapThreshold = tapThreshold
        self.sequenceWindow = sequenceWindow
        self.typed = typed
    }

    // A modifier key being held.
    private struct Held {
        var since: TimeInterval
        var clean = true
        /// It went down as the start of a combination (T1653): neither its down nor its up is a gesture.
        var chord = false
    }
    private var held: [HotkeyKey: Held] = [:]
    /// The last clean tap of each modifier key, for the double tap.
    private var lastTap: [HotkeyKey: TimeInterval] = [:]
    /// Key codes whose key-down was consumed: their auto-repeat and key-up are consumed too.
    private var swallowed: [Int64: String?] = [:]

    private struct Pending {
        var candidates: [Int]
        var step: Int
        var buffer: [Payload]
        var downCodes: Set<Int64>
        var lastAt: TimeInterval
    }
    private var pending: Pending?

    /// Replaces the shortcuts, forgetting what was half done (a held key still comes up harmlessly).
    public mutating func setBindings(_ bindings: [(id: String, shortcut: Shortcut)]) {
        self.bindings = bindings
        held.removeAll()
        lastTap.removeAll()
        pending = nil
    }

    /// When `tick` has to be called: the end of a sequence's window.
    public var deadline: TimeInterval? { pending.map { $0.lastAt + sequenceWindow } }

    /// A sequence that waited too long gives its keys back.
    public mutating func tick(now: TimeInterval) -> Result {
        var result = Result()
        if let p = pending, now - p.lastAt > sequenceWindow {
            result.replay = p.buffer
            pending = nil
        }
        return result
    }

    public mutating func handle(_ input: Input, payload: Payload, at t: TimeInterval) -> Result {
        switch input {
        case .flags(let code, let flags): return modifierChanged(code: code, flags: flags, at: t)
        case .keyDown(let code, let flags, let autorepeat): return keyDown(code: code, flags: flags, autorepeat: autorepeat, payload: payload, at: t)
        case .keyUp(let code, _): return keyUp(code: code, payload: payload)
        }
    }

    // MARK: Modifiers

    private mutating func modifierChanged(code: Int64, flags: UInt64, at t: TimeInterval) -> Result {
        var result = Result()
        guard let key = HotkeyKey.allCases.first(where: { $0.keyCode == code }), let down = key.isDown(keyCode: code, flags: flags) else {
            // ⌃, ⌥ or ⇧ on the left side, Caps Lock: another key, for whoever is held.
            if isDown(code: code, flags: flags) { result.outputs = interruptHeld(by: code) }
            return result
        }
        if down {
            guard held[key] == nil else { return result }
            // Another held modifier key is now being used as a modifier.
            result.outputs = interruptHeld(by: code)
            let chord = bindings.contains { binding in
                if case .combo(let combo) = binding.shortcut { return combo.startsWith(key, flags: flags) }
                if case .sequence(let steps) = binding.shortcut { return steps[0].startsWith(key, flags: flags) }
                return false
            }
            held[key] = Held(since: t, chord: chord)
            guard !chord else { return result }
            for binding in bindings where isActive(binding.id) {
                switch binding.shortcut {
                case .key(key):
                    result.outputs.append(.press(binding.id, flags: flags))
                case .doubleTap(key):
                    if let last = lastTap[key], t - last <= doubleTapWindow {
                        result.outputs.append(.trigger(binding.id))
                        lastTap[key] = nil
                        held[key]?.clean = false // this press is spent: it doesn't start another double tap
                    }
                default:
                    break
                }
            }
        } else {
            guard let was = held.removeValue(forKey: key), !was.chord else { return result }
            for binding in bindings {
                if case .key(key) = binding.shortcut { result.outputs.append(.release(binding.id, clean: was.clean)) }
            }
            if was.clean, t - was.since <= tapThreshold { lastTap[key] = t } else { lastTap[key] = nil }
        }
        return result
    }

    /// Whether a modifier that isn't one of the four keys went down (its flag bit is now set).
    private func isDown(code: Int64, flags: UInt64) -> Bool {
        // kVK_Shift, kVK_Control, kVK_Option and kVK_CapsLock, and their device bits.
        let bits: [Int64: UInt64] = [56: 0x2, 59: 0x1, 58: 0x20, 60: 0x4, 57: 0x1_0000]
        guard let bit = bits[code] else { return false }
        return flags & bit != 0
    }

    private mutating func interruptHeld(by code: Int64) -> [ShortcutOutput] {
        var outputs: [ShortcutOutput] = []
        for key in held.keys where held[key]?.chord == false {
            held[key]?.clean = false
            lastTap[key] = nil
            for binding in bindings {
                if case .key(key) = binding.shortcut { outputs.append(.interrupt(binding.id, keyCode: code)) }
            }
        }
        return outputs
    }

    // MARK: Keys

    private func matches(_ step: KeyCombo, code: Int64, flags: UInt64) -> Bool {
        step.matches(keyCode: code, flags: flags, typed: { typed(code, step.usesCommandLayer) })
    }

    private mutating func keyDown(code: Int64, flags: UInt64, autorepeat: Bool, payload: Payload, at t: TimeInterval) -> Result {
        var result = Result()
        if swallowed.keys.contains(code) {
            result.consume = true // the auto-repeat of a shortcut's key
            return result
        }
        if let p = pending, p.downCodes.contains(code), autorepeat {
            pending?.buffer.append(payload)
            result.consume = true
            return result
        }
        if autorepeat { return result }
        // The key's own shortcut first, then the held modifier keys hear it was another key: Esc during push-to-talk is
        // the cancel (L5), and only then the dictation key's "used as a modifier".
        let interrupts = interruptHeld(by: code)
        result = matchKeyDown(code: code, flags: flags, payload: payload, at: t)
        result.outputs += interrupts
        return result
    }

    private mutating func matchKeyDown(code: Int64, flags: UInt64, payload: Payload, at t: TimeInterval) -> Result {
        var result = Result()
        if var p = pending {
            let next = p.candidates.filter { i in
                guard case .sequence(let steps) = bindings[i].shortcut else { return false }
                return matches(steps[p.step], code: code, flags: flags)
            }
            if let done = next.first(where: { i in
                if case .sequence(let steps) = bindings[i].shortcut { return steps.count == p.step + 1 }
                return false
            }) {
                pending = nil
                swallowed[code] = .some(nil)
                result.consume = true
                result.outputs.append(.trigger(bindings[done].id))
                return result
            }
            if !next.isEmpty {
                p.candidates = next
                p.step += 1
                p.buffer.append(payload)
                p.downCodes.insert(code)
                p.lastAt = t
                pending = p
                result.consume = true
                return result
            }
            // The sequence broke: its keys go back, and this one is looked at on its own.
            pending = nil
            result.replay = p.buffer
            let fresh = start(code: code, flags: flags, payload: payload, at: t)
            result.outputs += fresh.outputs
            // Held back, it has to go after them: the tap drops it now and posts it again last.
            result.consume = true
            if !fresh.consume { result.replay.append(payload) }
            return result
        }

        let fresh = start(code: code, flags: flags, payload: payload, at: t)
        result.consume = fresh.consume
        result.outputs += fresh.outputs
        return result
    }

    /// A key-down with no sequence under way: a combination fires, or a sequence starts.
    private mutating func start(code: Int64, flags: UInt64, payload: Payload, at t: TimeInterval) -> Result {
        var result = Result()
        for binding in bindings where isActive(binding.id) {
            if case .combo(let combo) = binding.shortcut, matches(combo, code: code, flags: flags) {
                swallowed[code] = .some(binding.id)
                result.consume = true
                result.outputs.append(.press(binding.id, flags: flags))
                return result
            }
        }
        let starting = bindings.indices.filter { i in
            guard isActive(bindings[i].id), case .sequence(let steps) = bindings[i].shortcut else { return false }
            return matches(steps[0], code: code, flags: flags)
        }
        if !starting.isEmpty {
            pending = Pending(candidates: starting, step: 1, buffer: [payload], downCodes: [code], lastAt: t)
            result.consume = true
        }
        return result
    }

    private mutating func keyUp(code: Int64, payload: Payload) -> Result {
        var result = Result()
        if let entry = swallowed.removeValue(forKey: code) {
            result.consume = true
            if let id = entry { result.outputs.append(.release(id, clean: true)) }
            return result
        }
        if pending?.downCodes.contains(code) == true {
            pending?.buffer.append(payload)
            result.consume = true
        }
        return result
    }
}
