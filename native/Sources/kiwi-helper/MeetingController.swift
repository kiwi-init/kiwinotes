import Foundation
import KiwiHelperCore

/// R2 (#195): the glue between the mic listener, the meeting shortcuts, the meeting panel and the capture of R1. The
/// decisions are `MeetingDetector`'s (pure, in `swift test`); this only feeds it and carries out what it says.
/// It never starts or stops the capture by itself: `start` and `stop` come out of a click or a shortcut.
/// Everything on the main thread.
final class MeetingController {
    /// R1's capture: `meeting.start {app}`, `meeting.stop`, `meeting.pauseMine`/`resumeMine`, called in the helper.
    var startCapture: ((MeetingApp?) -> Void)?
    var stopCapture: (() -> Void)?
    var setMinePaused: ((Bool) -> Void)?
    /// An event to the app (ADR 0001).
    var emit: ((String, [String: Any]) -> Void)?

    private var detector: MeetingDetector
    private let listener = MicListener()
    let panel = MeetingPanel()
    private let headless: Bool
    private var timer: Timer?

    init(ownPids: Set<Int32>, headless: Bool) {
        detector = MeetingDetector(ownPids: ownPids)
        self.headless = headless
        panel.enabled = !headless
        panel.onAnswer = { [weak self] answer in self?.answer(answer) }
        panel.onStop = { [weak self] in
            guard let self, self.detector.isRecording else { return } // a late click on a pill that already left
            self.run(self.detector.meetingShortcut(at: Self.now))
        }
        panel.onTogglePause = { [weak self] in self?.pauseMineShortcut() }
        listener.onChange = { [weak self] users in self?.micUsers(users) }
    }

    private static var now: TimeInterval { ProcessInfo.processInfo.systemUptime }

    /// Starts watching which app takes the mic. Not in `--headless`: the agents' CLI never looks at the real audio
    /// system (the detector is driven there by `debug.meetingMicUsers`).
    func start() {
        guard !headless else { return }
        listener.start()
    }

    var isRecording: Bool { detector.isRecording }

    // MARK: Inputs

    func meetingShortcut() { run(detector.meetingShortcut(at: Self.now)) }
    func pauseMineShortcut() { run(detector.pauseMineShortcut(at: Self.now)) }

    func answer(_ answer: MeetingDetector.Answer) {
        emit?("meeting.answer", ["answer": answer.rawValue])
        run(detector.answer(answer, at: Self.now))
    }

    /// The process list, from the listener or (headless, debug) from the app.
    func micUsers(_ users: Set<MicUser>) { run(detector.micUsers(users, at: Self.now)) }

    /// R1's capture started or stopped, whoever asked (the panel, a shortcut, the app's `meeting.start`).
    func captureStarted(app: MeetingApp?) { run(detector.recordingStarted(app: app, at: Self.now)) }
    func captureStopped() { run(detector.recordingStopped(at: Self.now)) }

    /// The app's `meeting.pauseMine`/`resumeMine`: kept in the detector, so the mute doesn't undo the person's pause.
    func minePausedByApp(_ paused: Bool) { run(detector.setMinePaused(paused)) }

    /// The dictation pill came up or left: the meeting panel steps aside meanwhile.
    func setDictating(_ on: Bool) { panel.setDictating(on) }

    /// `config.set {meetingSuggest?, meetingApps?}`. Returns an error code, or nil (applied).
    func configure(_ fields: [String: Any]) -> String? {
        var config = detector.config
        var apps = detector.apps
        if let value = fields["meetingSuggest"] {
            guard let on = value as? Bool else { return "invalid_value" }
            config.suggest = on
        }
        if let value = fields["meetingApps"] {
            guard let parsed = MeetingApps.parse(value) else { return "invalid_value" }
            apps = parsed
        }
        detector.config = config
        detector.apps = apps
        // A new list takes effect on the apps already on the mic too.
        if fields["meetingApps"] != nil { micUsers(listener.users) }
        return nil
    }

    // MARK: Actions

    private func run(_ actions: [MeetingDetector.Action]) {
        for action in actions {
            switch action {
            case let .suggest(app): emit?("meeting.suggested", ["app": app.fields])
            case let .askEnded(app): emit?("meeting.endSuggested", ["app": app.fields])
            case .hideSuggestion, .hideAskEnded: break
            case let .start(app): startCapture?(app)
            case .stop: stopCapture?()
            case .pauseMine: setMinePaused?(true)
            case .resumeMine: setMinePaused?(false)
            }
        }
        panel.show(detector.panel)
        schedule()
    }

    /// One timer for the detector's next deadline (the pop-up leaving, the 2 min, forgetting a meeting).
    private func schedule() {
        timer?.invalidate()
        timer = nil
        guard let deadline = detector.nextDeadline else { return }
        let timer = Timer(timeInterval: max(0.05, deadline - Self.now + 0.01), repeats: false) { [weak self] _ in
            guard let self else { return }
            self.run(self.detector.tick(now: Self.now))
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }
}
