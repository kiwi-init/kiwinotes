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
    /// Forget this app's entry (`tccutil reset`) and show the system prompt again. For a switch that is on in
    /// Settings but doesn't count for this copy of the app (T658): flipping it again doesn't help, a new entry does.
    case resetAndPrompt

    /// `state` is the permission's IPC state; `askedBefore` says whether this app already showed the system prompt.
    /// The first ask shows only the system prompt; later asks go to Settings, since the prompt won't come back.
    /// A `restricted` permission (MDM, parental controls) can't be changed by the person, so nothing opens.
    /// `reset` (only from a person's click in the app, never on its own) starts over instead of opening Settings, and
    /// only when the app macOS charges is Kiwi Notes itself (`responsibleBundleId`). From the probe in a terminal, the
    /// responsible app is the terminal, and a reset would take *its* permission away (review #693).
    public static func next(
        state: String, askedBefore: Bool, reset: Bool = false, responsibleBundleId: String? = nil
    ) -> PermissionAsk {
        switch state {
        case "granted", "restricted": return .none
        case "undetermined": return .systemPrompt
        default:
            guard askedBefore else { return .systemPrompt }
            return reset && responsibleBundleId == KiwiApp.bundleId ? .resetAndPrompt : .openSettings
        }
    }
}

/// The Kiwi Notes app, as macOS knows it.
public enum KiwiApp {
    /// `app.identifier` in `app/electrobun.config.ts` (the dev build has the same one). The only entry the helper may
    /// reset with `tccutil`.
    public static let bundleId = "app.kiwinotes.desktop"
}

/// The names `tccutil reset` takes for each permission.
public enum TCCService {
    public static func name(for permission: String) -> String? {
        switch permission {
        case "accessibility": return "Accessibility"
        case "inputMonitoring": return "ListenEvent"
        case "microphone": return "Microphone"
        default: return nil
        }
    }
}

/// The app macOS charges for the helper's permissions: the `.app` around the responsible process (the app's launcher).
public enum ResponsibleApp {
    /// `/x/Kiwi Notes.app/Contents/MacOS/launcher` → `/x/Kiwi Notes.app`. The outermost `.app`, so a helper app nested
    /// inside another still points at the one in Settings. Nil for a bare binary (a terminal, the probe).
    public static func bundlePath(executable: String) -> String? {
        let parts = executable.split(separator: "/", omittingEmptySubsequences: false)
        guard let i = parts.firstIndex(where: { $0.hasSuffix(".app") }), parts.count > i + 1 else { return nil }
        return parts[...i].joined(separator: "/")
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
