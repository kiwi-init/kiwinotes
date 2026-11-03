import Foundation

/// Decisions the helper makes on commands, kept apart from the macOS calls so `swift test` covers them.
public enum Rules {
    /// `record.start` while already recording (by the hotkey or an earlier command) is refused,
    /// and the gesture is left alone: releasing the key still stops a push-to-talk.
    public static func recordStart(isRecording: Bool) -> String? {
        isRecording ? "already_recording" : nil
    }

    /// `config.set` timings must be positive and finite. A zero or negative hold threshold would make every
    /// tap a push-to-talk, and a zero double-tap window would make the toggle impossible.
    public static func timing(_ ms: Double?) -> String? {
        guard let ms else { return nil }
        return ms.isFinite && ms > 0 ? nil : "invalid_value"
    }
}

/// How to ask for a permission with one window at a time.
public enum PermissionAsk: Equatable, Sendable {
    /// Already granted: nothing to show.
    case none
    /// The system prompt (macOS shows it once per app; after that the call is silent).
    case systemPrompt
    /// The right pane of System Settings, where the person flips the switch.
    case openSettings

    /// `state` is the permission's IPC state; `askedBefore` says whether this app already showed the system prompt.
    /// The first ask shows only the system prompt; later asks go to Settings, since the prompt won't come back.
    /// A `restricted` permission (MDM, parental controls) can't be changed by the person, so nothing opens.
    public static func next(state: String, askedBefore: Bool) -> PermissionAsk {
        switch state {
        case "granted", "restricted": return .none
        case "undetermined": return .systemPrompt
        default: return askedBefore ? .openSettings : .systemPrompt
        }
    }
}

extension WAV {
    /// `--dump-wav` file name, with milliseconds so two recordings in the same second don't overwrite each other.
    public static func dumpName(at date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: date).replacingOccurrences(of: ":", with: "-") + ".wav"
    }
}
