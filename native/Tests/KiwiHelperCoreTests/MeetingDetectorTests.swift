import XCTest
@testable import KiwiHelperCore

/// R2 (#195): who is a meeting, one pop-up per meeting, the ~2 min before "A reunião acabou?", never stopping alone,
/// and the "you" channel following the mute. The clock is fake: every time is passed in.
final class MeetingDetectorTests: XCTestCase {
    let teams = MeetingApp(bundleId: "com.microsoft.teams2", name: "Teams")
    let chrome = MeetingApp(bundleId: "com.google.Chrome", name: "Chrome")
    let teamsUser = MicUser(pid: 500, bundleId: "com.microsoft.teams2")
    let chromeHelper = MicUser(pid: 610, bundleId: "com.google.Chrome.helper")

    func detector() -> MeetingDetector { MeetingDetector(ownPids: [100, 101]) }

    /// The pop-up and then the recording, the way the helper drives it: the action, then R1's `meeting.started`.
    func recording(_ d: inout MeetingDetector, _ user: MicUser, at t: TimeInterval) {
        _ = d.micUsers([user], at: t)
        let start = d.answer(.record, at: t + 1)
        XCTAssertEqual(start.last, .start(d.apps.match(user.bundleId)))
        _ = d.recordingStarted(app: d.apps.match(user.bundleId), at: t + 1)
    }

    // MARK: Who is a meeting

    func testMeetingAppsAndTheirHelpers() {
        let apps = MeetingApps()
        XCTAssertEqual(apps.match("com.microsoft.teams2"), teams)
        XCTAssertEqual(apps.match("com.microsoft.teams2.helper"), teams, "the longest prefix wins over com.microsoft.teams")
        XCTAssertEqual(apps.match("com.microsoft.teams")?.name, "Teams")
        XCTAssertEqual(apps.match("com.google.Chrome.helper"), chrome)
        XCTAssertEqual(apps.match("us.zoom.xos")?.name, "Zoom")
        XCTAssertEqual(apps.match("com.apple.WebKit.GPU")?.name, "Safari")
        XCTAssertNil(apps.match("com.google.Chromebook"), "a prefix only counts up to a dot")
        XCTAssertNil(apps.match("com.apple.Music"))
        XCTAssertNil(apps.match(""))
    }

    func testTheListCanBeReplaced() {
        let apps = MeetingApps.parse([["bundleId": "com.hnc.Discord", "name": "Discord"]])
        XCTAssertEqual(apps?.match("com.hnc.Discord.helper")?.name, "Discord")
        XCTAssertNil(apps?.match("com.microsoft.teams2"))
        XCTAssertNil(MeetingApps.parse([["bundleId": "x"]]), "a name is required")
        XCTAssertNil(MeetingApps.parse("teams"))
        XCTAssertEqual(MeetingApps.parse([])?.apps, [], "an empty list turns detection off")
    }

    func testOtherAppsDontCount() {
        var d = detector()
        XCTAssertEqual(d.micUsers([MicUser(pid: 700, bundleId: "com.apple.VoiceMemos")], at: 0), [])
        XCTAssertEqual(d.panel, .hidden)
    }

    /// Kiwi's own mic (the dictation, or the meeting's "you" channel) is never a meeting, by pid or by bundle id.
    func testKiwiItselfDoesntCount() {
        var d = MeetingDetector(apps: MeetingApps([MeetingApp(bundleId: "app.kiwinotes.desktop", name: "Kiwi")]), ownPids: [100])
        XCTAssertEqual(d.micUsers([MicUser(pid: 100, bundleId: "com.microsoft.teams2")], at: 0), [])
        XCTAssertEqual(d.micUsers([MicUser(pid: 900, bundleId: "app.kiwinotes.desktop")], at: 1), [])
        XCTAssertEqual(d.micUsers([MicUser(pid: 901, bundleId: "app.kiwinotes.desktop-dev")], at: 2), [])
    }

    // MARK: The pop-up

    func testSuggestsWhenAMeetingAppTakesTheMic() {
        var d = detector()
        XCTAssertEqual(d.micUsers([teamsUser], at: 10), [.suggest(teams)])
        XCTAssertEqual(d.panel, .suggest(teams))
        XCTAssertEqual(d.nextDeadline, 30)
    }

    func testThePopUpLeavesAfter20s() {
        var d = detector()
        _ = d.micUsers([teamsUser], at: 10)
        XCTAssertEqual(d.tick(now: 29.9), [])
        XCTAssertEqual(d.tick(now: 30), [.hideSuggestion])
        XCTAssertEqual(d.panel, .hidden)
        XCTAssertEqual(d.tick(now: 31), [])
    }

    /// One per meeting: mute, push-to-talk or the app taking the mic again doesn't ask again, whatever the answer.
    func testOnePopUpPerMeeting() {
        for answer in [MeetingDetector.Answer.notNow, nil] {
            var d = detector()
            _ = d.micUsers([teamsUser], at: 0)
            if let answer { XCTAssertEqual(d.answer(answer, at: 2), [.hideSuggestion]) } else { _ = d.tick(now: 20) }
            for t in stride(from: 30.0, to: 400, by: 30) {
                XCTAssertEqual(d.micUsers([], at: t), [])
                XCTAssertEqual(d.micUsers([teamsUser], at: t + 15), [], "asked again at \(t + 15)")
            }
            XCTAssertEqual(d.panel, .hidden)
        }
    }

    /// The same meeting through two processes of the app (Chrome and its helper) is still one pop-up.
    func testSeveralProcessesOfOneAppAreOneMeeting() {
        var d = detector()
        XCTAssertEqual(d.micUsers([chromeHelper, MicUser(pid: 600, bundleId: "com.google.Chrome")], at: 0), [.suggest(chrome)])
        XCTAssertEqual(d.micUsers([chromeHelper], at: 1), [])
    }

    /// Long enough without the mic, and it's another meeting: that one asks again.
    func testANewMeetingLaterAsksAgain() {
        var d = detector()
        _ = d.micUsers([teamsUser], at: 0)
        _ = d.answer(.notNow, at: 1)
        _ = d.micUsers([], at: 100)
        _ = d.tick(now: 699)
        XCTAssertEqual(d.micUsers([teamsUser], at: 699.5), [], "still the same meeting just before forgetAfter")
        _ = d.micUsers([], at: 700)
        XCTAssertEqual(d.nextDeadline, 1300)
        XCTAssertEqual(d.tick(now: 1300), [])
        XCTAssertEqual(d.micUsers([teamsUser], at: 1400), [.suggest(teams)])
    }

    func testTwoMeetingAppsOnePopUpAtATime() {
        var d = detector()
        XCTAssertEqual(d.micUsers([teamsUser], at: 0), [.suggest(teams)])
        XCTAssertEqual(d.micUsers([teamsUser, chromeHelper], at: 1), [], "the pop-up on screen stays the Teams one")
    }

    func testPopUpTurnedOff() {
        var d = detector()
        d.config.suggest = false
        XCTAssertEqual(d.micUsers([teamsUser], at: 0), [])
        XCTAssertEqual(d.meetingShortcut(at: 5), [.start(teams)], "the shortcut still records it")
    }

    func testRecordStartsTheMeetingApp() {
        var d = detector()
        _ = d.micUsers([teamsUser], at: 0)
        XCTAssertEqual(d.answer(.record, at: 3), [.hideSuggestion, .start(teams)])
        XCTAssertFalse(d.isRecording, "only R1's meeting.started makes it recording")
        XCTAssertEqual(d.recordingStarted(app: teams, at: 3.2), [])
        XCTAssertEqual(d.panel, .recording(app: teams, since: 3.2, minePaused: false))
    }

    /// A late click on a pop-up that already left does nothing.
    func testAnswersWithoutAQuestionDoNothing() {
        var d = detector()
        for answer in [MeetingDetector.Answer.record, .notNow, .stop, .keepGoing] {
            XCTAssertEqual(d.answer(answer, at: 0), [])
        }
    }

    // MARK: The shortcut

    func testShortcutRecordsAndStops() {
        var d = detector()
        _ = d.micUsers([teamsUser], at: 0)
        XCTAssertEqual(d.meetingShortcut(at: 2), [.hideSuggestion, .start(teams)])
        _ = d.recordingStarted(app: teams, at: 2)
        XCTAssertEqual(d.meetingShortcut(at: 60), [.stop])
        XCTAssertTrue(d.isRecording, "still recording until meeting.stopped")
        XCTAssertEqual(d.recordingStopped(at: 60.1), [])
        XCTAssertEqual(d.panel, .hidden)
        XCTAssertEqual(d.micUsers([], at: 61), [])
        XCTAssertEqual(d.micUsers([teamsUser], at: 70), [], "a recorded meeting doesn't ask again")
    }

    /// No meeting app on the mic (a meeting in the room): the shortcut records anyway, with no app.
    func testShortcutWithoutAMeetingApp() {
        var d = detector()
        XCTAssertEqual(d.meetingShortcut(at: 0), [.start(nil)])
        XCTAssertEqual(d.recordingStarted(app: nil, at: 0), [])
        XCTAssertEqual(d.panel, .recording(app: nil, since: 0, minePaused: false))
        XCTAssertEqual(d.micUsers([teamsUser], at: 30), [], "no pop-up while recording")
        XCTAssertEqual(d.panel, .recording(app: teams, since: 0, minePaused: false), "the app that joined is the meeting")
    }

    /// Started from the app (the hub's card) with no app given: the meeting app on the mic is it.
    func testStartedElsewhereTakesTheAppOnTheMic() {
        var d = detector()
        _ = d.micUsers([teamsUser], at: 0)
        XCTAssertEqual(d.recordingStarted(app: nil, at: 1), [.hideSuggestion])
        XCTAssertEqual(d.panel, .recording(app: teams, since: 1, minePaused: false))
    }

    // MARK: The end: only suggested, never by itself

    func testAsksIfTheMeetingEndedAfterTwoMinutesWithoutTheMic() {
        var d = detector()
        recording(&d, teamsUser, at: 0)
        XCTAssertEqual(d.micUsers([], at: 600), [.pauseMine])
        XCTAssertEqual(d.nextDeadline, 720)
        XCTAssertEqual(d.tick(now: 719), [])
        XCTAssertEqual(d.tick(now: 720), [.askEnded(teams)])
        XCTAssertEqual(d.panel, .askEnded(teams))
        XCTAssertEqual(d.tick(now: 900), [], "asks once")
        XCTAssertEqual(d.answer(.stop, at: 905), [.hideAskEnded, .stop])
    }

    /// #4846: nobody answers, and it keeps recording, for hours.
    func testNeverStopsByItself() {
        var d = detector()
        recording(&d, teamsUser, at: 0)
        var actions = d.micUsers([], at: 60)
        for t in stride(from: 61.0, to: 4 * 3600, by: 7) { actions += d.tick(now: t) }
        XCTAssertFalse(actions.contains(.stop))
        XCTAssertEqual(actions.filter { if case .askEnded = $0 { return true } else { return false } }.count, 1)
        XCTAssertTrue(d.isRecording)
    }

    /// Mute and push-to-talk: gaps shorter than 2 min never ask.
    func testShortGapsDontAsk() {
        var d = detector()
        recording(&d, teamsUser, at: 0)
        var actions: [MeetingDetector.Action] = []
        for t in stride(from: 10.0, to: 3600, by: 130) {
            actions += d.micUsers([], at: t)
            actions += d.tick(now: t + 119)
            actions += d.micUsers([teamsUser], at: t + 119.5)
        }
        XCTAssertFalse(actions.contains(.askEnded(teams)))
        XCTAssertEqual(Set(actions), [.pauseMine, .resumeMine])
    }

    func testKeepGoingAsksAgainOnlyAfterTheNextRelease() {
        var d = detector()
        recording(&d, teamsUser, at: 0)
        _ = d.micUsers([], at: 100)
        XCTAssertEqual(d.tick(now: 220), [.askEnded(teams)])
        XCTAssertEqual(d.answer(.keepGoing, at: 230), [.hideAskEnded])
        XCTAssertEqual(d.tick(now: 1000), [])
        _ = d.micUsers([teamsUser], at: 1100)
        _ = d.micUsers([], at: 1200)
        XCTAssertEqual(d.tick(now: 1320), [.askEnded(teams)])
    }

    /// The app takes the mic back while "A reunião acabou?" is on screen: the meeting goes on, the question leaves.
    func testTheQuestionLeavesWhenTheAppComesBack() {
        var d = detector()
        recording(&d, teamsUser, at: 0)
        _ = d.micUsers([], at: 100)
        _ = d.tick(now: 220)
        XCTAssertEqual(d.micUsers([teamsUser], at: 230), [.resumeMine, .hideAskEnded])
        XCTAssertEqual(d.panel, .recording(app: teams, since: 1, minePaused: false))
    }

    func testStoppingElsewhereHidesTheQuestion() {
        var d = detector()
        recording(&d, teamsUser, at: 0)
        _ = d.micUsers([], at: 100)
        _ = d.tick(now: 220)
        XCTAssertEqual(d.recordingStopped(at: 221), [.hideAskEnded])
        XCTAssertEqual(d.panel, .hidden)
    }

    // MARK: Mute

    /// Meet lets go of the mic on mute: the "you" channel pauses with it, and comes back with it.
    func testYouChannelFollowsTheMute() {
        var d = detector()
        recording(&d, chromeHelper, at: 0)
        XCTAssertEqual(d.micUsers([], at: 10), [.pauseMine])
        XCTAssertEqual(d.panel, .recording(app: chrome, since: 1, minePaused: true))
        XCTAssertEqual(d.micUsers([chromeHelper], at: 20), [.resumeMine])
    }

    /// Another app's mic doesn't touch the recorded meeting's "you" channel.
    func testOnlyTheRecordedAppsMuteCounts() {
        var d = detector()
        recording(&d, teamsUser, at: 0)
        XCTAssertEqual(d.micUsers([teamsUser, chromeHelper], at: 10), [])
        XCTAssertEqual(d.micUsers([teamsUser], at: 20), [])
    }

    func testPauseMyMicShortcut() {
        var d = detector()
        XCTAssertEqual(d.pauseMineShortcut(at: 0), [], "nothing to pause without a recording")
        recording(&d, teamsUser, at: 0)
        XCTAssertEqual(d.pauseMineShortcut(at: 5), [.pauseMine])
        XCTAssertEqual(d.pauseMineShortcut(at: 6), [.resumeMine])
    }

    /// Paused by the person, the app's unmute doesn't open the "you" channel: only the person does.
    func testPausedByThePersonWinsOverTheUnmute() {
        var d = detector()
        recording(&d, teamsUser, at: 0)
        XCTAssertEqual(d.pauseMineShortcut(at: 5), [.pauseMine])
        XCTAssertEqual(d.micUsers([], at: 10), [])
        XCTAssertEqual(d.micUsers([teamsUser], at: 20), [])
        XCTAssertEqual(d.panel, .recording(app: teams, since: 1, minePaused: true))
        XCTAssertEqual(d.setMinePaused(false), [.resumeMine])
        XCTAssertEqual(d.setMinePaused(false), [])
    }

    /// Starting while muted in Meet starts with the "you" channel paused.
    func testStartingWhileMutedStartsPaused() {
        var d = detector()
        _ = d.micUsers([chromeHelper], at: 0)
        _ = d.answer(.notNow, at: 1)
        _ = d.micUsers([], at: 30)
        XCTAssertEqual(d.recordingStarted(app: chrome, at: 40), [.pauseMine])
        XCTAssertEqual(d.micUsers([chromeHelper], at: 50), [.resumeMine])
    }

    // MARK: The panel's text

    func testElapsed() {
        XCTAssertEqual(MeetingText.elapsed(0), "0:00")
        XCTAssertEqual(MeetingText.elapsed(42.9), "0:42")
        XCTAssertEqual(MeetingText.elapsed(725), "12:05")
        XCTAssertEqual(MeetingText.elapsed(3723), "1:02:03")
        XCTAssertEqual(MeetingText.elapsed(-3), "0:00")
    }
}

/// The port of OpenWhispr's `prepareProcessSnapshot`, with readers that stand in for CoreAudio.
final class MicUsageTests: XCTestCase {
    struct Process {
        let pid: Int32?
        let running: Bool?
        let bundleId: String?
    }

    func snapshot(_ processes: [UInt32: Process]) -> (pids: [UInt32: Int32], active: Set<MicUser>)? {
        MicUsage.snapshot(
            processes.keys.sorted(),
            readPid: { processes[$0]?.pid },
            readInputRunning: { processes[$0]?.running },
            readBundleId: { processes[$0]?.bundleId }
        )
    }

    func testActiveProcessesWithTheirBundleIds() {
        let result = snapshot([
            1: Process(pid: 500, running: true, bundleId: "com.microsoft.teams2"),
            2: Process(pid: 600, running: false, bundleId: "com.google.Chrome"),
        ])
        XCTAssertEqual(result?.pids, [1: 500, 2: 600])
        XCTAssertEqual(result?.active, [MicUser(pid: 500, bundleId: "com.microsoft.teams2")])
    }

    func testCoreSpeechIsNotAMeeting() {
        let result = snapshot([1: Process(pid: 80, running: true, bundleId: "com.apple.CoreSpeech")])
        XCTAssertEqual(result?.active, [])
    }

    /// A process that vanished mid-read is skipped; only a list with nothing readable is a failure.
    func testVanishedProcessesAreSkipped() {
        let result = snapshot([
            1: Process(pid: nil, running: true, bundleId: nil),
            2: Process(pid: 500, running: true, bundleId: nil),
        ])
        XCTAssertEqual(result?.active, [MicUser(pid: 500, bundleId: "")])
        XCTAssertNil(snapshot([1: Process(pid: nil, running: nil, bundleId: nil)]))
        XCTAssertNotNil(snapshot([:]))
    }
}
