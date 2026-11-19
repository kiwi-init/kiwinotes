import Foundation

/// The ⌘V of the paste in two steps (T23991): the key comes from the keyboard layout (TIS/TSM), which only runs on
/// the main queue (the HIToolbox of macOS 27 asserts it and kills the helper), and the key events go out on a
/// background queue, since they sleep between them. So the key is read here, on the main queue, and only the post
/// goes to `queue`.
public enum PasteKeystroke {
    public static func post<Key>(on queue: DispatchQueue, key: () -> Key, post: @escaping (Key) -> Void,
                                 then: @escaping () -> Void) {
        dispatchPrecondition(condition: .onQueue(.main))
        let resolved = key()
        queue.async {
            post(resolved)
            then()
        }
    }
}
