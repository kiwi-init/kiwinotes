import XCTest
@testable import KiwiHelperCore

final class RulesTests: XCTestCase {
    func testRecordStartWhileRecordingIsRefused() {
        XCTAssertNil(Rules.recordStart(isRecording: false))
        XCTAssertEqual(Rules.recordStart(isRecording: true), "already_recording")
    }

    func testTimingsMustBePositive() {
        XCTAssertNil(Rules.timing(nil), "not sent: keep the current value")
        XCTAssertNil(Rules.timing(250))
        XCTAssertNil(Rules.timing(0.5))
        XCTAssertEqual(Rules.timing(0), "invalid_value")
        XCTAssertEqual(Rules.timing(-100), "invalid_value")
        XCTAssertEqual(Rules.timing(.nan), "invalid_value")
        XCTAssertEqual(Rules.timing(.infinity), "invalid_value")
    }

    func testOneWindowPerPermissionAsk() {
        XCTAssertEqual(PermissionAsk.next(state: "granted", askedBefore: false), PermissionAsk.none)
        XCTAssertEqual(PermissionAsk.next(state: "restricted", askedBefore: true), PermissionAsk.none)
        XCTAssertEqual(PermissionAsk.next(state: "undetermined", askedBefore: true), .systemPrompt)
        // Accessibility and Input Monitoring report "denied" before the first ask too: the prompt comes first,
        // and Settings opens only once the prompt has been shown.
        XCTAssertEqual(PermissionAsk.next(state: "denied", askedBefore: false), .systemPrompt)
        XCTAssertEqual(PermissionAsk.next(state: "denied", askedBefore: true), .openSettings)
    }

    func testResetOnlyWhenAskedForAndStillMissing() {
        let kiwi = KiwiApp.bundleId
        // T658: the switch is on in Settings, but the permission doesn't count. A click can start over.
        XCTAssertEqual(PermissionAsk.next(state: "denied", askedBefore: true, reset: true, responsibleBundleId: kiwi),
                       .resetAndPrompt)
        // Never asked: the plain prompt is enough. Granted, restricted or not asked yet: nothing to reset.
        XCTAssertEqual(PermissionAsk.next(state: "denied", askedBefore: false, reset: true, responsibleBundleId: kiwi),
                       .systemPrompt)
        XCTAssertEqual(PermissionAsk.next(state: "granted", askedBefore: true, reset: true, responsibleBundleId: kiwi),
                       PermissionAsk.none)
        XCTAssertEqual(PermissionAsk.next(state: "restricted", askedBefore: true, reset: true, responsibleBundleId: kiwi),
                       PermissionAsk.none)
        XCTAssertEqual(PermissionAsk.next(state: "undetermined", askedBefore: true, reset: true, responsibleBundleId: kiwi),
                       .systemPrompt)
        // No reset asked: Settings, as before.
        XCTAssertEqual(PermissionAsk.next(state: "denied", askedBefore: true, responsibleBundleId: kiwi), .openSettings)
    }

    func testNeverResetsAnotherAppsPermission() {
        // Review #693: the probe in Ghostty sends `reset: true`; the responsible app is the terminal, not Kiwi Notes.
        for other in ["com.mitchellh.ghostty", "com.apple.Terminal", "app.kiwinotes.desktop.evil", ""] {
            XCTAssertEqual(PermissionAsk.next(state: "denied", askedBefore: true, reset: true, responsibleBundleId: other),
                           .openSettings, other)
        }
        XCTAssertEqual(PermissionAsk.next(state: "denied", askedBefore: true, reset: true, responsibleBundleId: nil),
                       .openSettings)
        XCTAssertEqual(KiwiApp.bundleId, "app.kiwinotes.desktop")
    }

    func testTCCServiceNames() {
        XCTAssertEqual(TCCService.name(for: "accessibility"), "Accessibility")
        XCTAssertEqual(TCCService.name(for: "inputMonitoring"), "ListenEvent")
        XCTAssertEqual(TCCService.name(for: "microphone"), "Microphone")
        XCTAssertNil(TCCService.name(for: "camera"))
    }

    func testResponsibleAppBundle() {
        XCTAssertEqual(
            ResponsibleApp.bundlePath(executable: "/a/b/Kiwi Notes.app/Contents/MacOS/launcher"), "/a/b/Kiwi Notes.app")
        XCTAssertEqual(
            ResponsibleApp.bundlePath(executable: "/A/Outer.app/Contents/Resources/Inner.app/Contents/MacOS/x"),
            "/A/Outer.app")
        XCTAssertNil(ResponsibleApp.bundlePath(executable: "/usr/local/bin/kiwi-ipc-probe"))
        XCTAssertNil(ResponsibleApp.bundlePath(executable: "/a/Weird.app"))
    }

    func testDumpNameHasMilliseconds() {
        let a = Date(timeIntervalSince1970: 1_700_000_000.120)
        let b = Date(timeIntervalSince1970: 1_700_000_000.870)
        XCTAssertNotEqual(WAV.dumpName(at: a), WAV.dumpName(at: b), "same second, different files")
        XCTAssertTrue(WAV.dumpName(at: a).hasSuffix(".wav"))
        XCTAssertFalse(WAV.dumpName(at: a).contains(":"), "no colons in file names")
    }
}
