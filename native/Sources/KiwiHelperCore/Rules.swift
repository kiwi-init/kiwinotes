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

/// How to ask for a permission: what the helper does, in order (reset, prompt, Settings).
public struct PermissionAsk: Equatable, Sendable {
    /// When System Settings opens.
    public enum Settings: Equatable, Sendable {
        case never
        /// Right after the other steps (after `settingsDelay`, so a fresh entry is already in the list).
        case after
        /// Only if the prompt didn't show (`openSettings(granted:elapsed:)`). For the microphone, whose prompt answers.
        case ifNoPrompt
    }

    /// Forget this app's entry first (`tccutil reset`). For a switch that is on in Settings but doesn't count for this
    /// copy of the app (T658): flipping it again doesn't help, a new entry does.
    public var reset: Bool
    /// Call the system prompt. For Accessibility and Input Monitoring it also puts Kiwi Notes back in the Settings list
    /// after a reset, and it is silent once macOS has shown it (T825).
    public var prompt: Bool
    public var settings: Settings

    public init(reset: Bool = false, prompt: Bool = false, settings: Settings = .never) {
        self.reset = reset
        self.prompt = prompt
        self.settings = settings
    }

    /// Already granted (or restricted): nothing to show.
    public static let none = PermissionAsk()
    /// The system prompt alone (macOS shows it once per app; after that the call is silent).
    public static let systemPrompt = PermissionAsk(prompt: true)
    /// The right pane of System Settings, where the person flips the switch.
    public static let openSettings = PermissionAsk(settings: .after)

    /// `state` is the permission's IPC state; `askedBefore` says whether this app already showed the system prompt.
    /// A `restricted` permission (MDM, parental controls) can't be changed by the person, so nothing opens.
    ///
    /// On its own (`reset` false: at launch, on the first dictation) one window at a time: the prompt the first time,
    /// Settings after that.
    ///
    /// `reset` is a person's click in the app (never on its own). The click always ends in something visible (T825):
    /// `askedBefore` can be stale (a `tccutil reset`, a new build, the helper's defaults gone), and then macOS may stay
    /// silent where we expected a prompt. So the click prompts and then opens Settings: for Accessibility and Input
    /// Monitoring always (their prompt only points to Settings anyway), for the microphone when its prompt didn't show.
    /// The entry is reset first only when it was asked before and the app macOS charges is Kiwi Notes itself
    /// (`responsibleBundleId`): from the probe in a terminal, a reset would take the *terminal's* permission away
    /// (review #693).
    public static func next(
        permission: String = "", state: String, askedBefore: Bool, reset: Bool = false, responsibleBundleId: String? = nil
    ) -> PermissionAsk {
        switch state {
        case "granted", "restricted": return .none
        default: break
        }
        guard reset else {
            return state == "undetermined" || !askedBefore ? .systemPrompt : .openSettings
        }
        return PermissionAsk(
            reset: state != "undetermined" && askedBefore && responsibleBundleId == KiwiApp.bundleId,
            prompt: true,
            settings: permission == "microphone" ? .ifNoPrompt : .after
        )
    }

    /// How long after the prompt call Settings opens, for `.after`: the prompt (if any) comes up first, and the entry a
    /// reset removed is back in the list.
    public static let settingsDelay: TimeInterval = 1.0

    /// For `.ifNoPrompt`: the microphone's prompt answers only after the person clicks, so an answer that is not
    /// "granted" and came back faster than a person could click means no prompt showed.
    public static func openSettings(granted: Bool, elapsed: TimeInterval) -> Bool {
        !granted && elapsed < 0.5
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
