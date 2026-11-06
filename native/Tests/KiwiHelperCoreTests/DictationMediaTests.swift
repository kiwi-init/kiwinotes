import XCTest
@testable import KiwiHelperCore

private final class FakeVolume: MediaVolumeControl {
    let a = MediaVolumeTarget(device: 1, uid: "fake-a", channel: 0)
    let b = MediaVolumeTarget(device: 2, uid: "fake-b", channel: 0)
    var selected: [MediaVolumeTarget] = []
    var values: [MediaVolumeTarget: Float] = [:]
    var writes: [(MediaVolumeTarget, Float)] = []
    var unavailable = false
    var failedWrites = false
    var quantize = false
    init() { selected = [a]; values[a] = 0.8; values[b] = 0.6 }
    func targets() -> [MediaVolumeTarget] { unavailable ? [] : selected }
    func read(_ target: MediaVolumeTarget) -> Float? { values[target] }
    func write(_ value: Float, to target: MediaVolumeTarget) -> Bool {
        if failedWrites { return false }
        values[target] = quantize ? (value * 16).rounded() / 16 : value
        writes.append((target, value)); return true
    }
}
final class DictationMediaTests: XCTestCase {
    func testLowersBeforeCaptureAndRestoresWhenCaptureEnds() throws {
        let fake = FakeVolume(), media = DictationMedia(volume: fake)
        media.startCapture { XCTAssertEqual(fake.values[fake.a]!, 0.2, accuracy: 0.0001) }
        media.end()
        XCTAssertEqual(fake.values[fake.a]!, 0.8, accuracy: 0.0001)
        XCTAssertEqual(fake.writes.count, 2)
    }
    func testFailedCaptureRestoresImmediately() {
        let fake = FakeVolume(), media = DictationMedia(volume: fake)
        XCTAssertThrowsError(try media.startCapture { throw NSError(domain: "fake capture", code: 1) })
        XCTAssertEqual(fake.values[fake.a], 0.8)
    }
    func testRepeatedStartEndAndNewCaptureDoNotAccumulateDucking() {
        let fake = FakeVolume(), media = DictationMedia(volume: fake)
        media.begin(); media.begin(); XCTAssertEqual(fake.writes.count, 1)
        media.end(); media.end(); XCTAssertEqual(fake.writes.count, 2)
        media.begin(); media.end(); XCTAssertEqual(fake.writes.count, 4)
        XCTAssertEqual(fake.values[fake.a], 0.8)
    }
    func testMeetingNeverLowersAndStartingMeetingReleasesDictationChange() {
        let fake = FakeVolume(), media = DictationMedia(volume: fake)
        media.begin(meetingActive: true); XCTAssertTrue(fake.writes.isEmpty)
        media.begin(); media.begin(meetingActive: true)
        XCTAssertEqual(fake.values[fake.a], 0.8); XCTAssertEqual(fake.writes.count, 2)
    }
    func testManualVolumeChoiceIsPreserved() {
        let fake = FakeVolume(), media = DictationMedia(volume: fake)
        media.begin(); fake.values[fake.a] = 0.45; media.end()
        XCTAssertEqual(fake.values[fake.a], 0.45); XCTAssertEqual(fake.writes.count, 1)
    }
    func testOutputSwitchNeverModifiesTheNewDefaultAndDisconnectedDeviceIsSkipped() {
        let fake = FakeVolume(), media = DictationMedia(volume: fake)
        media.begin(); fake.selected = [fake.b]; media.end()
        XCTAssertEqual(fake.values[fake.a], 0.8); XCTAssertEqual(fake.values[fake.b], 0.6)
        fake.selected = [fake.a]; media.begin(); fake.values.removeValue(forKey: fake.a); fake.selected = [fake.b]; media.end()
        XCTAssertEqual(fake.values[fake.b], 0.6)
    }
    func testUnavailableOrReadOnlyVolumeNeverBlocksCaptureAndReportsStableCode() {
        let fake = FakeVolume(); fake.unavailable = true
        var warnings: [String] = []; let media = DictationMedia(volume: fake) { warnings.append($0) }
        var captured = 0; media.startCapture { captured += 1 }; media.end()
        fake.unavailable = false; fake.failedWrites = true
        media.startCapture { captured += 1 }; media.end()
        XCTAssertEqual(captured, 2); XCTAssertEqual(warnings, ["media: volume_unavailable", "media: volume_unavailable"])
        XCTAssertEqual(fake.values[fake.a], 0.8)
    }
    func testMutedOutputAndDisabledAdapterHaveNoWrites() {
        let fake = FakeVolume(); fake.values[fake.a] = 0
        let media = DictationMedia(volume: fake); media.begin(); media.end(); XCTAssertTrue(fake.writes.isEmpty)
        let disabled = DictationMedia(volume: nil); disabled.startCapture {}; disabled.end()
    }
    func testStereoChannelsRestoreIndependentlyAndQuantizedVolumeRestores() {
        let fake = FakeVolume(), other = MediaVolumeTarget(device: 1, uid: "fake-a", channel: 2)
        fake.selected = [fake.a, other]; fake.values[other] = 0.4
        let media = DictationMedia(volume: fake); media.begin(); fake.values[other] = 0.3; media.end()
        XCTAssertEqual(fake.values[fake.a], 0.8); XCTAssertEqual(fake.values[other], 0.3)
        fake.selected = [fake.a]; fake.values[fake.a] = 0.75; fake.quantize = true
        media.begin(); media.end(); XCTAssertEqual(fake.values[fake.a], 0.75)
    }
}
