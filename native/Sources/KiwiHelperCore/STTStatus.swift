/// What `stt.status` last said, so each change goes out once: `loading` at start, then `ready` or
/// `unavailable`; and `ready` again when a dictation loads the model after a failed start (offline on the
/// first run, #383), or `unavailable` when a dictation finds it gone.
public struct STTStatus: Sendable {
    public enum State: String, Sendable { case loading, ready, unavailable }

    public private(set) var state: State?

    public init() {}

    /// True when `next` is news and should be emitted.
    public mutating func update(_ next: State) -> Bool {
        guard next != state else { return false }
        state = next
        return true
    }
}
