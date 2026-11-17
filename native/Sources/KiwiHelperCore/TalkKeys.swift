import Foundation

/// Whose recording: the dictation (Fn, pasted) or the agent's (Control, spec #9876: sent to the agent, never pasted).
public enum TalkTarget: String, Sendable {
    case dictation
    case agent
}

/// The two talk keys (spec #9876), each with its own `HotkeyGesture` and the same timings. Pure, so `swift test`
/// drives it. The rules:
/// - **They never record together.** With one key down, the other's press counts as another key: the engine already
///   interrupts the one held (it cancels a push-to-talk), and the new press is spent here, so nothing records until
///   both are let go.
/// - **A latched recording ignores the other key:** its press does nothing, and the latched one goes on.
/// - Each action says whose it is; the helper only stops or cancels the recording that is that key's.
public struct TalkKeys: Sendable {
    public private(set) var dictation = HotkeyGesture()
    public private(set) var agent = HotkeyGesture()
    /// The keys physically down right now.
    public private(set) var down: Set<TalkTarget> = []

    public init(holdThreshold: TimeInterval = 0.25, doubleTapWindow: TimeInterval = 0.35) {
        setTimings(holdThreshold: holdThreshold, doubleTapWindow: doubleTapWindow)
    }

    public mutating func setTimings(holdThreshold: TimeInterval? = nil, doubleTapWindow: TimeInterval? = nil) {
        if let holdThreshold { dictation.holdThreshold = holdThreshold; agent.holdThreshold = holdThreshold }
        if let doubleTapWindow { dictation.doubleTapWindow = doubleTapWindow; agent.doubleTapWindow = doubleTapWindow }
    }

    public func gesture(_ target: TalkTarget) -> HotkeyGesture { target == .dictation ? dictation : agent }

    private mutating func with(_ target: TalkTarget, _ body: (inout HotkeyGesture) -> [GestureAction]) -> [GestureAction] {
        target == .dictation ? body(&dictation) : body(&agent)
    }

    private static func other(_ target: TalkTarget) -> TalkTarget { target == .dictation ? .agent : .dictation }

    /// The key went down. `otherRecording`: the other target's recording is on (latched, or still in its tail).
    public mutating func press(_ target: TalkTarget, at t: TimeInterval, otherRecording: Bool = false) -> [GestureAction] {
        down.insert(target)
        let other = Self.other(target)
        // The other key is held, or its recording goes on: this press is spent, it starts nothing.
        if down.contains(other) || otherRecording || gesture(other).isRecording {
            _ = with(target) { g in
                // A press that would have been the 2nd tap or the stop of a latch stays one: only a fresh start is spent.
                guard g.state == .idle else { return [] }
                _ = g.keyDown(at: t)
                return g.otherKeyDown()
            }
            return []
        }
        return with(target) { $0.keyDown(at: t) }
    }

    public mutating func release(_ target: TalkTarget, at t: TimeInterval) -> [GestureAction] {
        down.remove(target)
        return with(target) { $0.keyUp(at: t) }
    }

    /// Another key or a click while this key is held: a push-to-talk is cancelled; a latched recording ignores it.
    public mutating func interrupt(_ target: TalkTarget) -> [GestureAction] {
        with(target) { $0.otherKeyDown() }
    }

    /// The earliest deadline of the two (a lone tap turning into a cancel).
    public var deadline: (target: TalkTarget, at: TimeInterval)? {
        [(TalkTarget.dictation, dictation.deadline), (.agent, agent.deadline)]
            .compactMap { target, at in at.map { (target: target, at: $0) } }
            .min { $0.at < $1.at }
    }

    public mutating func tick(now: TimeInterval) -> [(TalkTarget, GestureAction)] {
        dictation.tick(now: now).map { (.dictation, $0) } + agent.tick(now: now).map { (.agent, $0) }
    }

    /// The recording ended from outside (Esc, the pill, a command): see `HotkeyGesture.endedFromOverlay`.
    public mutating func ended(_ target: TalkTarget) -> StopMode {
        var mode = StopMode.pushToTalk
        _ = with(target) { g in mode = g.endedFromOverlay(); return [] }
        return mode
    }

    public mutating func reset(_ target: TalkTarget, latched: Bool = false) {
        _ = with(target) { g in g.reset(latched: latched); return [] }
    }
}
