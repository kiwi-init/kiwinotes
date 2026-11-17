import Darwin
import Foundation
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
    var beforeWrite: ((MediaVolumeTarget, Float) -> Void)?
    var quantize = false
    init() { selected = [a]; values[a] = 0.8; values[b] = 0.6 }
    func targets() -> [MediaVolumeTarget] { unavailable ? [] : selected }
    func read(_ target: MediaVolumeTarget) -> Float? { values[resolved(target)] }
    private func resolved(_ target: MediaVolumeTarget) -> MediaVolumeTarget {
        values.keys.first { $0.uid == target.uid && $0.channel == target.channel } ?? target
    }
    func write(_ value: Float, to target: MediaVolumeTarget) -> Bool {
        if failedWrites { return false }
        beforeWrite?(target, value)
        values[resolved(target)] = quantize ? (value * 16).rounded() / 16 : value
        writes.append((target, value)); return true
    }
}
private final class FakeMediaJournal: MediaVolumeJournal {
    var changes: [MediaVolumeChange]?
    var failSave = false
    var loads = 0
    func load() throws -> [MediaVolumeChange]? { loads += 1; return changes }
    func save(_ changes: [MediaVolumeChange]) throws {
        if failSave { throw MediaVolumeJournalError.unavailable }
        self.changes = changes
    }
    func clear() throws { changes = nil }
}
private final class FileFakeVolume: MediaVolumeControl {
    let file: URL
    let target = MediaVolumeTarget(device: 1, uid: "fake-file-device", channel: 0)
    init(file: URL) { self.file = file }
    func targets() -> [MediaVolumeTarget] { [target] }
    func read(_ target: MediaVolumeTarget) -> Float? {
        guard target == self.target, let text = try? String(contentsOf: file) else { return nil }
        return Float(text)
    }
    func write(_ value: Float, to target: MediaVolumeTarget) -> Bool {
        guard target == self.target else { return false }
        do { try Data(String(value).utf8).write(to: file, options: .atomic); return true } catch { return false }
    }
}
final class DictationMediaTests: XCTestCase {
    func testLowersBeforeCaptureAndRestoresWhenCaptureEnds() throws {
        let fake = FakeVolume(), media = DictationMedia(volume: fake, journal: FakeMediaJournal())
        media.startCapture { XCTAssertEqual(fake.values[fake.a]!, 0.2, accuracy: 0.0001) }
        media.end()
        XCTAssertEqual(fake.values[fake.a]!, 0.8, accuracy: 0.0001)
        XCTAssertEqual(fake.writes.count, 2)
    }
    func testFailedCaptureRestoresImmediately() {
        let fake = FakeVolume(), media = DictationMedia(volume: fake, journal: FakeMediaJournal())
        XCTAssertThrowsError(try media.startCapture { throw NSError(domain: "fake capture", code: 1) })
        XCTAssertEqual(fake.values[fake.a], 0.8)
    }
    func testRepeatedStartEndAndNewCaptureDoNotAccumulateDucking() {
        let fake = FakeVolume(), media = DictationMedia(volume: fake, journal: FakeMediaJournal())
        media.begin(); media.begin(); XCTAssertEqual(fake.writes.count, 1)
        media.end(); media.end(); XCTAssertEqual(fake.writes.count, 2)
        media.begin(); media.end(); XCTAssertEqual(fake.writes.count, 4)
        XCTAssertEqual(fake.values[fake.a], 0.8)
    }
    func testMeetingNeverLowersAndStartingMeetingReleasesDictationChange() {
        let fake = FakeVolume(), media = DictationMedia(volume: fake, journal: FakeMediaJournal())
        media.begin(meetingActive: true); XCTAssertTrue(fake.writes.isEmpty)
        media.begin(); media.begin(meetingActive: true)
        XCTAssertEqual(fake.values[fake.a], 0.8); XCTAssertEqual(fake.writes.count, 2)
    }
    func testManualVolumeChoiceIsPreserved() {
        let fake = FakeVolume(), media = DictationMedia(volume: fake, journal: FakeMediaJournal())
        media.begin(); fake.values[fake.a] = 0.45; media.end()
        XCTAssertEqual(fake.values[fake.a], 0.45); XCTAssertEqual(fake.writes.count, 1)
    }
    func testOutputSwitchNeverModifiesTheNewDefaultAndDisconnectedDeviceIsSkipped() {
        let fake = FakeVolume(), media = DictationMedia(volume: fake, journal: FakeMediaJournal())
        media.begin(); fake.selected = [fake.b]; media.end()
        XCTAssertEqual(fake.values[fake.a], 0.8); XCTAssertEqual(fake.values[fake.b], 0.6)
        fake.selected = [fake.a]; media.begin(); fake.values.removeValue(forKey: fake.a); fake.selected = [fake.b]; media.end()
        XCTAssertEqual(fake.values[fake.b], 0.6)
    }
    func testUnavailableOrReadOnlyVolumeNeverBlocksCaptureAndReportsStableCode() {
        let fake = FakeVolume(); fake.unavailable = true
        var warnings: [String] = []; let media = DictationMedia(volume: fake, journal: FakeMediaJournal()) { warnings.append($0) }
        var captured = 0; media.startCapture { captured += 1 }; media.end()
        fake.unavailable = false; fake.failedWrites = true
        media.startCapture { captured += 1 }; media.end()
        XCTAssertEqual(captured, 2); XCTAssertEqual(warnings, ["media: volume_unavailable", "media: volume_unavailable"])
        XCTAssertEqual(fake.values[fake.a], 0.8)
    }
    func testMutedOutputAndDisabledAdapterHaveNoWrites() {
        let fake = FakeVolume(); fake.values[fake.a] = 0
        let media = DictationMedia(volume: fake, journal: FakeMediaJournal()); media.begin(); media.end(); XCTAssertTrue(fake.writes.isEmpty)
        let disabled = DictationMedia(volume: nil); disabled.startCapture {}; disabled.end()
    }
    func testStereoChannelsRestoreIndependentlyAndQuantizedVolumeRestores() {
        let fake = FakeVolume(), other = MediaVolumeTarget(device: 1, uid: "fake-a", channel: 2)
        fake.selected = [fake.a, other]; fake.values[other] = 0.4
        let media = DictationMedia(volume: fake, journal: FakeMediaJournal()); media.begin(); fake.values[other] = 0.3; media.end()
        XCTAssertEqual(fake.values[fake.a], 0.8); XCTAssertEqual(fake.values[other], 0.3)
        fake.selected = [fake.a]; fake.values[fake.a] = 0.75; fake.quantize = true
        media.begin(); media.end(); XCTAssertEqual(fake.values[fake.a], 0.75)
    }
    func testMarkerIsPrivateAndDurableBeforeVolumeChangesThenNewHelperRestores() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("kiwi-media-crash-\(UUID())")
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("volume.json"), fake = FakeVolume()
        let journal = FileMediaVolumeJournal(file: file)
        fake.beforeWrite = { _, value in
            if value < 0.8 {
                XCTAssertTrue(FileManager.default.fileExists(atPath: file.path))
                XCTAssertEqual(try? journal.load()?.first?.original, 0.8)
                let permissions = try? FileManager.default.attributesOfItem(atPath: file.path)[.posixPermissions] as? NSNumber
                XCTAssertEqual(permissions?.intValue, 0o600)
                XCTAssertEqual(fake.values[fake.a], 0.8)
            }
        }
        var first: DictationMedia? = DictationMedia(volume: fake, journal: journal)
        first?.begin(); XCTAssertEqual(fake.values[fake.a], 0.2)
        first = nil // simulated process death: deliberately do not call end()
        let fresh = DictationMedia(volume: fake, journal: FileMediaVolumeJournal(file: file))
        fresh.restorePending()
        XCTAssertEqual(fake.values[fake.a], 0.8)
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    }
    func testCrashRecoveryPreservesManualChangeAndClearsMarker() throws {
        let journal = FakeMediaJournal(), fake = FakeVolume()
        var first: DictationMedia? = DictationMedia(volume: fake, journal: journal)
        first?.begin(); first = nil; fake.values[fake.a] = 0.45
        let fresh = DictationMedia(volume: fake, journal: journal)
        fresh.restorePending(); XCTAssertEqual(fake.values[fake.a], 0.45)
        XCTAssertNil(journal.changes); XCTAssertEqual(fake.writes.count, 1)
    }
    func testUnwritableMarkerNeverChangesVolumeOrBlocksCapture() {
        let journal = FakeMediaJournal(), fake = FakeVolume(); journal.failSave = true
        let media = DictationMedia(volume: fake, journal: journal)
        var captured = false; media.startCapture { captured = true }; media.end()
        XCTAssertTrue(captured); XCTAssertTrue(fake.writes.isEmpty); XCTAssertEqual(fake.values[fake.a], 0.8)
    }
    func testNormalRestoreClearsMarkerAndDisabledAdapterDoesNotReadIt() {
        let journal = FakeMediaJournal(), fake = FakeVolume()
        let owner = DictationMedia(volume: fake, journal: journal)
        owner.begin(); XCTAssertNotNil(journal.changes); owner.end(); XCTAssertNil(journal.changes)
        let loads = journal.loads
        let disabled = DictationMedia(volume: nil, journal: journal)
        disabled.restorePending(); disabled.begin(); disabled.end(); XCTAssertEqual(journal.loads, loads)
    }
    func testQuantizedVolumeIsPersistedForRecoveryAndRestoreFailureKeepsMarker() {
        let journal = FakeMediaJournal(), fake = FakeVolume(); fake.quantize = true; fake.values[fake.a] = 0.8125
        var first: DictationMedia? = DictationMedia(volume: fake, journal: journal)
        first?.begin(); XCTAssertEqual(journal.changes?.first?.lowered, 0.1875); first = nil
        fake.failedWrites = true
        let fresh = DictationMedia(volume: fake, journal: journal)
        fresh.restorePending(); XCTAssertNotNil(journal.changes)
        fake.failedWrites = false; fresh.restorePending()
        XCTAssertEqual(fake.values[fake.a], 0.8125); XCTAssertNil(journal.changes)
    }
    func testMalformedMarkerDoesNotChangeVolume() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("kiwi-media-invalid-\(UUID())")
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appendingPathComponent("volume.json"), fake = FakeVolume()
        try Data("invalid".utf8).write(to: file)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        let media = DictationMedia(volume: fake, journal: FileMediaVolumeJournal(file: file))
        media.restorePending(); media.begin(); media.end()
        XCTAssertTrue(fake.writes.isEmpty)
    }

    func testRestartRestoresSameUIDAfterDeviceIDChangesWithoutTouchingNewDefault() {
        let fake = FakeVolume(), journal = FakeMediaJournal()
        var first: DictationMedia? = DictationMedia(volume: fake, journal: journal)
        first?.begin(); first = nil
        let reconnected = MediaVolumeTarget(device: 42, uid: fake.a.uid, channel: fake.a.channel)
        fake.values[reconnected] = fake.values.removeValue(forKey: fake.a)
        fake.selected = [fake.b]
        let fresh = DictationMedia(volume: fake, journal: journal)
        fresh.restorePending()
        XCTAssertEqual(fake.values[reconnected], 0.8); XCTAssertEqual(fake.values[fake.b], 0.6)
        XCTAssertNil(journal.changes)
    }

    func testSIGKILLThenNewHelperRestoresPersistedFakeVolume() throws {
        if let directory = ProcessInfo.processInfo.environment["KIWI_MEDIA_CRASH_CHILD_DIR"] {
            let root = URL(fileURLWithPath: directory)
            let volume = FileFakeVolume(file: root.appendingPathComponent("fake-volume.txt"))
            let media = DictationMedia(volume: volume, journal: FileMediaVolumeJournal(file: root.appendingPathComponent("marker.json")))
            media.begin()
            withExtendedLifetime(media) { _ = Darwin.kill(getpid(), SIGKILL) }
            return
        }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("kiwi-media-kill-\(UUID())")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let volumeFile = root.appendingPathComponent("fake-volume.txt"), marker = root.appendingPathComponent("marker.json")
        try Data("0.8".utf8).write(to: volumeFile)
        let process = Process(); process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
        process.arguments = ["xctest", "-XCTest", "KiwiHelperCoreTests.DictationMediaTests/testSIGKILLThenNewHelperRestoresPersistedFakeVolume", Bundle(for: Self.self).bundleURL.path]
        var environment = ProcessInfo.processInfo.environment.filter { !$0.key.hasPrefix("XCTest") && !$0.key.hasPrefix("XCInject") && $0.key != "DYLD_INSERT_LIBRARIES" }
        environment["KIWI_MEDIA_CRASH_CHILD_DIR"] = root.path
        process.environment = environment; process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
        try process.run(); process.waitUntilExit()
        XCTAssertEqual(process.terminationReason, .uncaughtSignal); XCTAssertEqual(process.terminationStatus, SIGKILL)
        let volume = FileFakeVolume(file: volumeFile)
        XCTAssertEqual(volume.read(volume.target), 0.2)
        XCTAssertNotNil(try FileMediaVolumeJournal(file: marker).load())
        let fresh = DictationMedia(volume: volume, journal: FileMediaVolumeJournal(file: marker))
        fresh.restorePending()
        XCTAssertEqual(volume.read(volume.target), 0.8); XCTAssertFalse(FileManager.default.fileExists(atPath: marker.path))
    }

    func testDisconnectedPendingRecoveryDoesNotPreventDuckingNewOutput() {
        let fake = FakeVolume(), journal = FakeMediaJournal()
        let owner = DictationMedia(volume: fake, journal: journal)
        owner.begin(); fake.values.removeValue(forKey: fake.a); fake.selected = [fake.b]; owner.end()
        owner.begin(); XCTAssertEqual(fake.values[fake.b], 0.15)
        owner.end(); XCTAssertEqual(fake.values[fake.b], 0.6); XCTAssertNotNil(journal.changes)
        fake.values[fake.a] = 0.2; owner.restorePending()
        XCTAssertEqual(fake.values[fake.a], 0.8); XCTAssertNil(journal.changes)
    }

}
