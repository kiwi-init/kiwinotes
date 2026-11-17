import Darwin
import AVFoundation
import Foundation
import XCTest
@testable import KiwiHelperCore

final class RecordingJournalTests: XCTestCase {
    private var directory: URL!
    override func setUpWithError() throws {
        directory = ProcessInfo.processInfo.environment["KIWI_RECORDING_TEST_DIR"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.temporaryDirectory.appendingPathComponent("kiwi-recording-test-\(UUID())")
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: directory) }

    func testUnavailableStorageWarnsWithoutThrowingAndNextRecordingRetries() throws {
        try Data("blocked directory".utf8).write(to: directory)
        let journal = RecordingJournal(directory: directory)
        var warnings: [String] = []
        journal.onError = { warnings.append($0) }
        XCTAssertNil(journal.beginIfAvailable())
        XCTAssertEqual(warnings, ["recording_storage"])
        journal.append([0.25], at: 0)
        XCTAssertNil(try journal.finish())
        XCTAssertEqual(try String(contentsOf: directory), "blocked directory")
        try FileManager.default.removeItem(at: directory)
        let ref = try XCTUnwrap(journal.beginIfAvailable())
        journal.append([0.25], at: 0)
        XCTAssertEqual(try journal.finish(), ref)
        XCTAssertEqual(warnings.count, 1)
    }
    func testBestEffortBeginNeverOverwritesAnActiveRecovery() throws {
        let journal = RecordingJournal(directory: directory)
        let ref = try journal.begin()
        journal.append([0.25], at: 0)
        XCTAssertNil(journal.beginIfAvailable())
        XCTAssertEqual(try journal.finish(), ref)
        XCTAssertEqual(try RecordingJournal.repair(journal.audioURL(ref.id)), 1)
    }

    func testCheckpointsAreReadableWhileRecordingWithoutFinish() throws {
        let journal = RecordingJournal(directory: directory), metadata = try journal.begin()
        let file = try journal.audioURL(metadata.id)
        journal.append(Array(repeating: 0.25, count: 320), at: 0); try journal.checkpoint()
        XCTAssertEqual(try AVAudioFile(forReading: file).length, 320)
        journal.append(Array(repeating: -0.25, count: 160), at: 320); try journal.checkpoint()
        XCTAssertEqual(try AVAudioFile(forReading: file).length, 480)
        // No finish/finalizer: the file is already readable if its process disappears.
        XCTAssertEqual(try RecordingJournal.repair(file), 480)
    }
    func testSIGKILLLeavesAReadableRecordingWithoutFinalization() throws {
        if ProcessInfo.processInfo.environment["KIWI_RECORDING_TEST_CHILD"] == "1" {
            let journal = RecordingJournal(directory: directory)
            _ = try journal.begin()
            journal.append(Array(repeating: 0.2, count: 8000), at: 0)
            try journal.checkpoint()
            withExtendedLifetime(journal) { _ = Darwin.kill(getpid(), SIGKILL) }
            return
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
        process.arguments = ["xctest", "-XCTest", "KiwiHelperCoreTests.RecordingJournalTests/testSIGKILLLeavesAReadableRecordingWithoutFinalization", Bundle(for: Self.self).bundleURL.path]
        var environment = ProcessInfo.processInfo.environment.filter { !$0.key.hasPrefix("XCTest") && !$0.key.hasPrefix("XCInject") && $0.key != "DYLD_INSERT_LIBRARIES" }
        environment["KIWI_RECORDING_TEST_CHILD"] = "1"
        environment["KIWI_RECORDING_TEST_DIR"] = directory.path
        process.environment = environment
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run(); process.waitUntilExit()
        XCTAssertEqual(process.terminationReason, .uncaughtSignal)
        XCTAssertEqual(process.terminationStatus, SIGKILL)
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        let file = try XCTUnwrap(files.first { $0.pathExtension == "wav" })
        XCTAssertEqual(try RecordingJournal.repair(file), 8000)
        XCTAssertEqual(try AVAudioFile(forReading: file).length, 8000)
    }

    func testPrivateFilesAndManifestSurviveFinish() throws {
        let journal = RecordingJournal(directory: directory)
        let metadata = try journal.begin(app: RecordingApp(bundleId: "fake.test"), target: "note", at: Date(timeIntervalSince1970: 1_700_000_000))
        journal.append([0.2, 0.3, 0.4], at: 0); XCTAssertEqual(try journal.finish(), metadata)
        let manifest = directory.appendingPathComponent(metadata.id + ".json")
        XCTAssertEqual(try JSONDecoder().decode(RecordingRecovery.self, from: Data(contentsOf: manifest)), metadata)
        for file in [try journal.audioURL(metadata.id), manifest] {
            XCTAssertEqual((try FileManager.default.attributesOfItem(atPath: file.path)[.posixPermissions] as! NSNumber).intValue & 0o777, 0o600)
        }
        XCTAssertEqual((try FileManager.default.attributesOfItem(atPath: directory.path)[.posixPermissions] as! NSNumber).intValue & 0o777, 0o700)
    }
    func testRepairUsesActualFramesAndTruncatesHalfAFrame() throws {
        let journal = RecordingJournal(directory: directory), metadata = try journal.begin()
        journal.append(Array(repeating: 0.1, count: 320), at: 0); try journal.checkpoint()
        let file = try journal.audioURL(metadata.id), interrupted = try FileHandle(forWritingTo: file)
        try interrupted.seek(toOffset: 4); try interrupted.write(contentsOf: Data(repeating: 0, count: 4))
        try interrupted.seek(toOffset: 40); try interrupted.write(contentsOf: Data(repeating: 0, count: 4))
        try interrupted.seekToEnd(); try interrupted.write(contentsOf: Data([0xff])); try interrupted.close()
        XCTAssertEqual(try RecordingJournal.repair(file), 320)
        XCTAssertEqual(try Data(contentsOf: file).count, 44 + 640)
        XCTAssertEqual(try AVAudioFile(forReading: file).length, 320)
    }
    func testCancelAndEmptyRecordingLeaveNoFiles() throws {
        let journal = RecordingJournal(directory: directory)
        _ = try journal.begin(); journal.append([0.5], at: 0); try journal.cancel()
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path), [])
        _ = try journal.begin(); XCTAssertNil(try journal.finish())
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path), [])
    }
    func testEngineStartRetryCanResetRetainedOffset() throws {
        let journal = RecordingJournal(directory: directory), metadata = try journal.begin()
        journal.append(Array(repeating: 0.1, count: 20), at: 0)
        journal.append(Array(repeating: 0.2, count: 10), at: 0); _ = try journal.finish()
        XCTAssertEqual(try AVAudioFile(forReading: journal.audioURL(metadata.id)).length, 10)
    }
    func testLookupAndRepairRefusePathsAndSymlinks() throws {
        let journal = RecordingJournal(directory: directory), metadata = try journal.begin()
        journal.append([0.1], at: 0); _ = try journal.finish()
        let link = directory.appendingPathComponent("link.wav")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: journal.audioURL(metadata.id))
        XCTAssertThrowsError(try RecordingJournal.repair(link))
        XCTAssertThrowsError(try journal.audioURL("../../other"))
        XCTAssertFalse(RecordingJournal.isIdentifier("not-a-uuid"))
    }
    func testFakeCapturePersistsBeforeStopAndDrainsAllAcceptedBuffers() throws {
        let engine = JournalEngine(), journal = RecordingJournal(directory: directory)
        let capture = AudioCapture(makeEngine: { engine }, watchdogInterval: nil)
        let metadata = try journal.begin()
        capture.onRetainedSamples = { samples, offset in journal.append(samples, at: offset) }
        try capture.start(); defer { _ = capture.stop() }
        engine.feed(); try journal.checkpoint()
        XCTAssertTrue(capture.isRecording)
        XCTAssertGreaterThan(try AVAudioFile(forReading: journal.audioURL(metadata.id)).length, 0)
        engine.feed(); let samples = capture.stop(); _ = try journal.finish()
        XCTAssertEqual(Int(try AVAudioFile(forReading: journal.audioURL(metadata.id)).length), samples.count)
    }
}
private final class JournalEngine: MicEngine {
    var onConfigurationChange: (() -> Void)?
    var preparedFormat: InputFormat? { nil }
    private var callback: ((AVAudioPCMBuffer) -> Void)?
    func prepare(onBuffer: @escaping (AVAudioPCMBuffer) -> Void) throws { callback = onBuffer }
    func start() throws {}
    func stop() {}
    func discard() {}
    func hardwareFormat() -> InputFormat? { nil }
    func feed() {
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 1, interleaved: false)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 320)!; buffer.frameLength = 320
        for i in 0..<320 { buffer.floatChannelData![0][i] = 0.25 }
        callback?(buffer)
    }
}
