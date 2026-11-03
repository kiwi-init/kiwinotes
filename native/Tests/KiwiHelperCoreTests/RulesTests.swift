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

    func testDumpNameHasMilliseconds() {
        let a = Date(timeIntervalSince1970: 1_700_000_000.120)
        let b = Date(timeIntervalSince1970: 1_700_000_000.870)
        XCTAssertNotEqual(WAV.dumpName(at: a), WAV.dumpName(at: b), "same second, different files")
        XCTAssertTrue(WAV.dumpName(at: a).hasSuffix(".wav"))
        XCTAssertFalse(WAV.dumpName(at: a).contains(":"), "no colons in file names")
    }
}
