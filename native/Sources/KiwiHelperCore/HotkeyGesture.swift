import Foundation

/// The dictation key. Each one is a modifier, so it arrives as a `flagsChanged` event.
public enum HotkeyKey: String, CaseIterable, Sendable {
    case fn
    case rightOption
    case rightCommand
    case rightControl

    /// Carbon virtual key codes (kVK_Function, kVK_RightOption, kVK_RightCommand, kVK_RightControl).
    public var keyCode: Int64 {
        switch self {
        case .fn: return 63
        case .rightOption: return 61
        case .rightCommand: return 54
        case .rightControl: return 62
        }
    }

    /// The flag bit that says this key is down (kCGEventFlagMaskSecondaryFn and the NX_DEVICER*KEYMASK bits).
    public var flagMask: UInt64 {
        switch self {
        case .fn: return 0x80_0000
        case .rightOption: return 0x40
        case .rightCommand: return 0x10
        case .rightControl: return 0x2000
        }
    }

    /// For a `flagsChanged` event: whether this key is now down, or nil when the event is about another key.
    public func isDown(keyCode: Int64, flags: UInt64) -> Bool? {
        guard keyCode == self.keyCode else { return nil }
        return flags & flagMask != 0
    }
}

public enum StopMode: String, Sendable {
    case pushToTalk = "ptt"
    case toggle
}

public enum GestureAction: Equatable, Sendable {
    /// Key went down: start recording now so the first syllable isn't lost.
    case startRecording
    /// Second tap of a double tap: keep recording until the next tap.
    case latch
    case stopRecording(StopMode)
    /// A lone short tap or the key used as a modifier (Fn+F5, ⌥+letter): throw the audio away.
    case cancelRecording
}

/// Hold = push-to-talk; double tap = toggle (tap again to stop). Pure: times come in, actions go out.
public struct HotkeyGesture: Sendable {
    public enum State: Equatable, Sendable {
        case idle
        case pressed(since: TimeInterval)
        case tapped(at: TimeInterval)
        case latched
        /// Waiting for the key to come up after a stop or cancel; the release does nothing.
        case releasing
    }

    /// A press shorter than this is a tap, not push-to-talk.
    public var holdThreshold: TimeInterval
    /// The second tap has to start within this time after the first one ends.
    public var doubleTapWindow: TimeInterval
    public private(set) var state: State = .idle

    public init(holdThreshold: TimeInterval = 0.25, doubleTapWindow: TimeInterval = 0.35) {
        self.holdThreshold = holdThreshold
        self.doubleTapWindow = doubleTapWindow
    }

    public var isRecording: Bool {
        switch state {
        case .pressed, .tapped, .latched: return true
        case .idle, .releasing: return false
        }
    }

    /// When `tick` has to be called to turn a lone tap into a cancel.
    public var deadline: TimeInterval? {
        if case .tapped(let at) = state { return at + doubleTapWindow }
        return nil
    }

    public mutating func keyDown(at t: TimeInterval) -> [GestureAction] {
        switch state {
        case .idle:
            state = .pressed(since: t)
            return [.startRecording]
        case .tapped(let at):
            if t - at <= doubleTapWindow {
                state = .latched
                return [.latch]
            }
            state = .pressed(since: t)
            return [.cancelRecording, .startRecording]
        case .latched:
            state = .releasing
            return [.stopRecording(.toggle)]
        case .pressed, .releasing:
            return []
        }
    }

    public mutating func keyUp(at t: TimeInterval) -> [GestureAction] {
        switch state {
        case .pressed(let since):
            if t - since >= holdThreshold {
                state = .idle
                return [.stopRecording(.pushToTalk)]
            }
            state = .tapped(at: t)
            return []
        case .releasing:
            state = .idle
            return []
        case .idle, .tapped, .latched:
            return []
        }
    }

    /// Another key was pressed while ours is held: it's being used as a modifier, not for dictation.
    public mutating func otherKeyDown() -> [GestureAction] {
        guard case .pressed = state else { return [] }
        state = .releasing
        return [.cancelRecording]
    }

    public mutating func tick(now: TimeInterval) -> [GestureAction] {
        guard case .tapped(let at) = state, now - at > doubleTapWindow else { return [] }
        state = .idle
        return [.cancelRecording]
    }

    /// Recording started or stopped from outside (a `record.start`/`record.stop` command).
    public mutating func reset(latched: Bool = false) {
        state = latched ? .latched : .idle
    }
}
