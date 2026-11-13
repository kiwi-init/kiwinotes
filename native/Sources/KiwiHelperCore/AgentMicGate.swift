import Foundation

/// When the agent's mic opens (spec #9876, #11393): never at the press of the Control, which is used all day (⌃C, ⌃A,
/// ⌃+click). Only once it has been held past the hold time, or on the 2nd tap. Before that, the press is only "armed":
/// the mic stays closed (no orange dot, no Bluetooth profile switch), and a cancel or a lone tap leaves nothing behind.
/// Pure: the helper feeds it the gesture's actions and the hold timer, and does what comes out.
public struct AgentMicGate: Sendable {
    public enum Effect: Equatable, Sendable {
        /// Open the mic now: the person is talking to the agent (`latched`: by the 2nd tap).
        case openMic(latched: Bool)
        case stopMic(StopMode)
        case cancelMic
    }

    /// Pressed, mic still closed, waiting for the hold time or the 2nd tap.
    public private(set) var armed = false
    /// The mic is open for the agent.
    public private(set) var open = false

    public init() {}

    /// The gesture's `startRecording`: arm only.
    public mutating func start() -> [Effect] {
        armed = !open
        return []
    }

    /// The hold time passed. `stillPressed`: the key is still down (it wasn't a tap).
    public mutating func holdPassed(stillPressed: Bool) -> [Effect] {
        guard armed, stillPressed else { return [] }
        armed = false
        open = true
        return [.openMic(latched: false)]
    }

    /// The gesture's `latch` (the 2nd tap).
    public mutating func latch() -> [Effect] {
        guard armed else { return [] }
        armed = false
        open = true
        return [.openMic(latched: true)]
    }

    public mutating func stop(_ mode: StopMode) -> [Effect] {
        armed = false
        guard open else { return [] }
        open = false
        return [.stopMic(mode)]
    }

    public mutating func cancel() -> [Effect] {
        armed = false
        guard open else { return [] }
        open = false
        return [.cancelMic]
    }

    /// The recording ended from outside (Esc, a lost mic): nothing open nor armed any more.
    public mutating func reset() {
        armed = false
        open = false
    }
}
