import Foundation

/// R2 (#195, spec #4823): notices a meeting by which app takes the mic, suggests recording it once per meeting, and
/// while it records, pauses the "you" channel when the app lets go of the mic (mute) and only *suggests* stopping
/// after ~2 min without the mic. It never starts or stops a recording by itself (#4756, #4846): `start` and `stop`
/// only come out of a person's answer or shortcut.
///
/// Pure: the times come in (a fake clock in `swift test`). The helper feeds it the mic users
/// (`MicListener`), the shortcuts, the answers on the panel and the recording's real start and stop
/// (`meeting.started`/`meeting.stopped` of R1), and carries out the actions it returns.
public struct MeetingDetector: Sendable {
    public struct Config: Equatable, Sendable {
        /// How long the meeting app must go without the mic before "A reunião acabou?". Mute and push-to-talk let go
        /// of it all the time, so a short gap means nothing (#4846).
        public var endAfter: TimeInterval = 120
        /// How long "Gravar esta reunião?" stays on screen.
        public var suggestionLinger: TimeInterval = 20
        /// A meeting that wasn't recorded is forgotten after this long without the mic: taking the mic again after
        /// that is a new meeting and asks again. Shorter gaps (mute, push-to-talk, a tab reload) never ask twice.
        public var forgetAfter: TimeInterval = 600
        /// The "Gravar esta reunião?" pop-up; off, the meeting shortcut still records (settings of R6).
        public var suggest = true

        public init() {}
    }

    public enum Action: Hashable, Sendable {
        /// Show "Gravar esta reunião?" for this app.
        case suggest(MeetingApp)
        case hideSuggestion
        /// Show "A reunião acabou?".
        case askEnded(MeetingApp)
        case hideAskEnded
        /// Start recording (`meeting.start {app}` of R1). A request: the detector only counts it as recording once
        /// `recordingStarted` says so.
        case start(MeetingApp?)
        /// Stop recording (`meeting.stop`).
        case stop
        /// Pause or resume the "you" channel (`meeting.pauseMine` / `meeting.resumeMine`).
        case pauseMine
        case resumeMine
    }

    /// A click on the panel.
    public enum Answer: String, Sendable {
        /// "Gravar" on "Gravar esta reunião?".
        case record
        /// "Agora não".
        case notNow
        /// "Parar" on "A reunião acabou?".
        case stop
        /// "Continuar".
        case keepGoing
    }

    /// What the meeting panel shows. One thing at a time; a question wins over the recording pill.
    public enum Panel: Equatable, Sendable {
        case hidden
        case suggest(MeetingApp)
        case askEnded(MeetingApp)
        /// Recording since `since` (the clock's time), with the "you" channel paused or not.
        case recording(app: MeetingApp?, since: TimeInterval, minePaused: Bool)
    }

    struct Meeting: Sendable {
        let app: MeetingApp
        /// Already asked (or recorded, or "Agora não"): don't ask again for this meeting.
        var asked = false
        /// When the app let go of the mic; nil while it holds it.
        var releasedAt: TimeInterval?
    }

    struct Recording: Sendable {
        var app: MeetingApp?
        let since: TimeInterval
        /// "Pausar meu mic", by the shortcut or the live card.
        var pausedByPerson = false
        /// The recorded app let go of the mic (mute in Meet).
        var appReleased = false
        /// "A reunião acabou?" was already shown for this release; asks again only after the app takes the mic back
        /// and lets go of it for another `endAfter`.
        var askedEnded = false

        var minePaused: Bool { pausedByPerson || appReleased }
    }

    public var config: Config
    public var apps: MeetingApps
    /// The helper's pid and the Kiwi app's: Kiwi's own mic (dictation, the meeting's "you" channel) isn't a meeting.
    public let ownPids: Set<Int32>

    /// The meeting apps holding the mic now, the most recent last.
    public private(set) var active: [MeetingApp] = []
    var meetings: [String: Meeting] = [:]
    var recording: Recording?
    var suggestion: (app: MeetingApp, until: TimeInterval)?
    var askingEnded: MeetingApp?

    public init(config: Config = Config(), apps: MeetingApps = MeetingApps(), ownPids: Set<Int32> = []) {
        self.config = config
        self.apps = apps
        self.ownPids = ownPids
    }

    public var isRecording: Bool { recording != nil }

    public var panel: Panel {
        if let askingEnded { return .askEnded(askingEnded) }
        if let suggestion { return .suggest(suggestion.app) }
        if let recording { return .recording(app: recording.app, since: recording.since, minePaused: recording.minePaused) }
        return .hidden
    }

    // MARK: Inputs

    /// The processes taking mic input now (all of them, each time the list changes).
    public mutating func micUsers(_ users: Set<MicUser>, at now: TimeInterval) -> [Action] {
        var nowActive: [MeetingApp] = []
        for user in users.sorted(by: { $0.pid < $1.pid }) where !ownPids.contains(user.pid) && !ActiveAppFilter.isKiwi(user.bundleId) {
            if let app = apps.match(user.bundleId), !nowActive.contains(app) { nowActive.append(app) }
        }
        let released = active.filter { !nowActive.contains($0) }
        let taken = nowActive.filter { !active.contains($0) }
        active = active.filter { nowActive.contains($0) } + taken

        var actions: [Action] = []
        for app in released {
            meetings[app.bundleId]?.releasedAt = now
            if recording?.app == app { actions += setAppReleased(true) }
        }
        for app in taken {
            var meeting = meetings[app.bundleId] ?? Meeting(app: app)
            meeting.releasedAt = nil
            if recording != nil, recording?.app == nil {
                recording?.app = app // recording by the shortcut, and now a meeting app joins: it's that meeting
                meeting.asked = true
            }
            if recording?.app == app {
                actions += setAppReleased(false)
                recording?.askedEnded = false
                if askingEnded == app {
                    askingEnded = nil
                    actions.append(.hideAskEnded)
                }
            } else if recording == nil, config.suggest, !meeting.asked, suggestion == nil {
                meeting.asked = true
                suggestion = (app, now + config.suggestionLinger)
                actions.append(.suggest(app))
            }
            meetings[app.bundleId] = meeting
        }
        return actions + tick(now: now)
    }

    /// The meeting shortcut: records, or stops, at any time, with or without the pop-up.
    public mutating func meetingShortcut(at now: TimeInterval) -> [Action] {
        if recording != nil { return hideQuestions() + [.stop] }
        let app = suggestion?.app ?? active.last
        if let app { meetings[app.bundleId]?.asked = true }
        return hideQuestions() + [.start(app)]
    }

    /// "Pausar meu mic": toggles the "you" channel while recording. Does nothing otherwise.
    public mutating func pauseMineShortcut(at now: TimeInterval) -> [Action] {
        guard let current = recording else { return [] }
        return setPausedByPerson(!current.pausedByPerson)
    }

    /// The live card's "pausar meu mic" (R6), or `meeting.pauseMine`/`resumeMine` from the app: sets, not toggles.
    public mutating func setMinePaused(_ paused: Bool) -> [Action] {
        guard recording != nil else { return [] }
        return setPausedByPerson(paused)
    }

    public mutating func answer(_ answer: Answer, at now: TimeInterval) -> [Action] {
        switch answer {
        case .record:
            guard let app = suggestion?.app else { return [] }
            suggestion = nil
            return [.hideSuggestion, .start(app)]
        case .notNow:
            guard suggestion != nil else { return [] }
            suggestion = nil
            return [.hideSuggestion]
        case .stop:
            guard askingEnded != nil else { return [] }
            askingEnded = nil
            return [.hideAskEnded] + (recording != nil ? [.stop] : [])
        case .keepGoing:
            guard askingEnded != nil else { return [] }
            askingEnded = nil
            return [.hideAskEnded]
        }
    }

    /// The capture really started (`meeting.started`), from the pop-up, a shortcut or the app (the hub's card).
    /// With no app, it is the meeting app holding the mic, if any. If that app isn't holding the mic right now
    /// (muted), the "you" channel starts paused.
    public mutating func recordingStarted(app: MeetingApp?, at now: TimeInterval) -> [Action] {
        guard recording == nil else { return [] }
        let app = app ?? active.last
        var actions = hideQuestions()
        recording = Recording(app: app, since: now)
        if let app {
            var meeting = meetings[app.bundleId] ?? Meeting(app: app, releasedAt: active.contains(app) ? nil : now)
            meeting.asked = true
            meetings[app.bundleId] = meeting
            if !active.contains(app) { actions += setAppReleased(true) }
        }
        return actions
    }

    /// The capture stopped (`meeting.stopped`), whoever stopped it. The meeting stays asked: no pop-up again for it.
    public mutating func recordingStopped(at now: TimeInterval) -> [Action] {
        guard recording != nil else { return [] }
        recording = nil
        guard askingEnded != nil else { return [] }
        askingEnded = nil
        return [.hideAskEnded]
    }

    /// Time passing: the pop-up leaves, "A reunião acabou?" shows up, old meetings are forgotten.
    public mutating func tick(now: TimeInterval) -> [Action] {
        var actions: [Action] = []
        if let suggestion, now >= suggestion.until {
            self.suggestion = nil
            actions.append(.hideSuggestion)
        }
        if let current = recording, let app = current.app, current.appReleased, !current.askedEnded,
           let releasedAt = meetings[app.bundleId]?.releasedAt, now - releasedAt >= config.endAfter {
            recording?.askedEnded = true
            if askingEnded == nil {
                askingEnded = app
                actions.append(.askEnded(app))
            }
        }
        meetings = meetings.filter { _, meeting in
            guard let releasedAt = meeting.releasedAt, recording?.app != meeting.app else { return true }
            return now - releasedAt < config.forgetAfter
        }
        return actions
    }

    /// When `tick` has something to do next, for the helper's timer. Nil: nothing pending.
    public var nextDeadline: TimeInterval? {
        var times: [TimeInterval] = []
        if let suggestion { times.append(suggestion.until) }
        if let current = recording, let app = current.app, current.appReleased, !current.askedEnded,
           let releasedAt = meetings[app.bundleId]?.releasedAt {
            times.append(releasedAt + config.endAfter)
        }
        for meeting in meetings.values where meeting.app != recording?.app {
            if let releasedAt = meeting.releasedAt { times.append(releasedAt + config.forgetAfter) }
        }
        return times.min()
    }

    // MARK: Helpers

    private mutating func hideQuestions() -> [Action] {
        var actions: [Action] = []
        if suggestion != nil {
            suggestion = nil
            actions.append(.hideSuggestion)
        }
        if askingEnded != nil {
            askingEnded = nil
            actions.append(.hideAskEnded)
        }
        return actions
    }

    private mutating func setAppReleased(_ released: Bool) -> [Action] {
        guard let before = recording?.minePaused else { return [] }
        recording?.appReleased = released
        return pauseChange(from: before)
    }

    private mutating func setPausedByPerson(_ paused: Bool) -> [Action] {
        guard let before = recording?.minePaused else { return [] }
        recording?.pausedByPerson = paused
        return pauseChange(from: before)
    }

    private func pauseChange(from before: Bool) -> [Action] {
        guard let after = recording?.minePaused, after != before else { return [] }
        return [after ? .pauseMine : .resumeMine]
    }
}

/// Portuguese text for the meeting panel.
public enum MeetingText {
    public static let suggestTitle = "Gravar esta reunião?"
    public static let askEndedTitle = "A reunião acabou?"
    public static let record = "Gravar"
    public static let notNow = "Agora não"
    public static let stop = "Parar"
    public static let keepGoing = "Continuar"

    /// "Teams está usando o microfone": the line under "Gravar esta reunião?".
    public static func from(_ app: MeetingApp) -> String { "\(app.name) está usando o microfone" }

    /// "O Teams soltou o microfone há 2 min".
    public static func released(_ app: MeetingApp, minutes: Int) -> String {
        "\(app.name) soltou o microfone há \(max(1, minutes)) min"
    }

    /// The pill's timer: "0:42", "12:05", "1:02:03".
    public static func elapsed(_ seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds))
        let h = total / 3600, m = total / 60 % 60, s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }
}
