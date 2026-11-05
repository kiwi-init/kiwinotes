import Foundation
import XCTest
@testable import KiwiHelperCore

private final class MeetingFakeSource: MeetingAudioSource {
    var starts = 0
    var stops = 0
    var fail = false
    var callback: (([Float], TimeInterval) -> Void)?
    func start(onSamples: @escaping ([Float], TimeInterval) -> Void) throws {
        starts += 1
        if fail { throw MeetingFailure.invalidValue }
        callback = onSamples
    }
    func stop() { stops += 1 }
    func send(_ value: Float, frames: Int, at time: Double) { callback?(Array(repeating: value, count: frames), time) }
}

final class MeetingCaptureTests: XCTestCase {
    private func temporary() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("kiwi-meeting-test-\(UUID())")
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }
    private func floats(_ chunk: MeetingChunk) throws -> [Float] {
        let data = try Data(contentsOf: chunk.url)
        return stride(from: 0, to: data.count, by: 4).map { offset in
            let bits = data[offset..<(offset + 4)].enumerated().reduce(UInt32(0)) { $0 | UInt32($1.element) << ($1.offset * 8) }
            return Float(bitPattern: bits)
        }
    }

    func testTwoIndependentChannelsChunkingAndFinalAckLeavesNoAudio() throws {
        let root = try temporary(), mine = MeetingFakeSource(), system = MeetingFakeSource()
        let capture = try MeetingCapture(root: root, mine: mine, system: system, now: { 100 })
        XCTAssertEqual(mine.starts + system.starts, 0, "construction/recovery never captures")
        try capture.start(chunkDuration: 0.1)
        XCTAssertThrowsError(try capture.start(chunkDuration: 0.1))
        mine.send(0.25, frames: 2000, at: 100)
        system.send(-0.5, frames: 3200, at: 100)
        XCTAssertEqual(capture.pendingChunks().count, 3)
        try capture.stop()
        let pending = capture.pendingChunks()
        XCTAssertEqual(pending.filter { $0.channel == .mine }.map(\.frames), [1600, 400])
        XCTAssertEqual(pending.filter { $0.channel == .system }.map(\.frames), [1600, 1600])
        for chunk in pending {
            XCTAssertTrue(try floats(chunk).allSatisfy { $0 == (chunk.channel == .mine ? 0.25 : -0.5) })
            let mode = try FileManager.default.attributesOfItem(atPath: chunk.url.path)[.posixPermissions] as! NSNumber
            XCTAssertEqual(mode.intValue, 0o600)
            try capture.acknowledge(session: chunk.session, channel: chunk.channel, finalThroughFrame: chunk.startFrame + chunk.frames, contextFrames: 0)
        }
        XCTAssertTrue(capture.pendingChunks().isEmpty)
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
        XCTAssertThrowsError(try capture.acknowledge(session: "../../no", channel: .mine, finalThroughFrame: 0))
    }

    func testPauseMineKeepsSystemAndCommonTimelineAndRejectsLateBuffers() throws {
        let root = try temporary(), mine = MeetingFakeSource(), system = MeetingFakeSource()
        let capture = try MeetingCapture(root: root, mine: mine, system: system, now: { 100 })
        try capture.start(chunkDuration: 0.1)
        mine.send(0.25, frames: 800, at: 100)
        let lateMine = mine.callback
        try capture.pauseMine()
        lateMine?(Array(repeating: 0.99, count: 1600), 100.2)
        system.send(-0.5, frames: 1600, at: 101)
        try capture.resumeMine()
        lateMine?(Array(repeating: 0.99, count: 1600), 102)
        mine.send(0.5, frames: 800, at: 102)
        try capture.stop()
        mine.send(0.99, frames: 1600, at: 103)
        let chunks = capture.pendingChunks()
        XCTAssertEqual(chunks.filter { $0.channel == .mine }.map(\.startFrame), [0, 32_000])
        XCTAssertEqual(chunks.filter { $0.channel == .system }.first?.startFrame, 16_000)
        XCTAssertEqual(try chunks.flatMap { try floats($0) }.filter { $0 == 0.99 }.count, 0)
    }

    func testCrashRecoveryIncludesPartialPacketAndOnlyAckDeletesIt() throws {
        let root = try temporary()
        var spool: MeetingBuffer? = try MeetingBuffer(root: root, chunkDuration: 0.1)
        _ = try spool!.append(Array(repeating: 0.3, count: 1900), channel: .mine, startFrame: 200)
        _ = try spool!.append(Array(repeating: -0.4, count: 400), channel: .system, startFrame: 300)
        spool = nil // process lost before stop: partial file already persisted
        let capture = try MeetingCapture(root: root, mine: MeetingFakeSource(), system: MeetingFakeSource())
        let chunks = capture.pendingChunks()
        XCTAssertEqual(chunks.count, 3)
        XCTAssertEqual(chunks.reduce(0) { $0 + $1.frames }, 2300)
        XCTAssertNil(capture.session)
        XCTAssertEqual(try MeetingBuffer.recover(root: root), chunks)
        try capture.acknowledge(session: chunks[0].session, channel: chunks[0].channel, finalThroughFrame: chunks[0].startFrame + chunks[0].frames, contextFrames: 0)
        XCTAssertEqual(try MeetingBuffer.recover(root: root).count, 2)
    }

    func testAckWhileRecordingCanContinueAfterDirectoryIsEmpty() throws {
        let root = try temporary(), mine = MeetingFakeSource(), system = MeetingFakeSource()
        let capture = try MeetingCapture(root: root, mine: mine, system: system, now: { 100 })
        try capture.start(chunkDuration: 0.1)
        mine.send(0.1, frames: 1600, at: 100)
        try capture.acknowledge(session: capture.pendingChunks()[0].session, channel: .mine, finalThroughFrame: 1600, contextFrames: 0)
        mine.send(0.2, frames: 1600, at: 100.1)
        try capture.stop()
        XCTAssertEqual(capture.pendingChunks().count, 1)
        XCTAssertEqual(try floats(capture.pendingChunks()[0]), Array(repeating: 0.2, count: 1600))
    }

    func testStartFailureClosesBothSourcesAndPreservesAlreadyCapturedAudio() throws {
        let root = try temporary(), mine = MeetingFakeSource(), system = MeetingFakeSource()
        mine.fail = true
        let capture = try MeetingCapture(root: root, mine: mine, system: system)
        XCTAssertThrowsError(try capture.start(chunkDuration: 0.1))
        XCTAssertNil(capture.session)
        XCTAssertEqual(system.stops, 1)
        XCTAssertEqual(mine.stops, 1)
        XCTAssertThrowsError(try capture.pauseMine())
        XCTAssertThrowsError(try capture.start(chunkDuration: .nan))
        XCTAssertThrowsError(try capture.start(chunkDuration: 0))
        XCTAssertEqual(system.starts, 1)
    }
}

extension MeetingCaptureTests {
    func testWatermarkRetainsLookBehindUncommittedAudioAndOtherChannel() throws {
        let root = try temporary(), mine = MeetingFakeSource(), system = MeetingFakeSource()
        let capture = try MeetingCapture(root: root, mine: mine, system: system, now: { 100 })
        let session = try capture.start(chunkDuration: 1)
        mine.send(0.1, frames: 80_000, at: 100) // five one-second chunks
        system.send(0.2, frames: 80_000, at: 100)
        // Final through 4 s, retain 2 s look-behind: remove only mine [0,1] and [1,2].
        try capture.acknowledge(session: session, channel: .mine, finalThroughFrame: 64_000)
        XCTAssertEqual(capture.pendingChunks().filter { $0.channel == .mine }.map(\.startFrame), [32_000, 48_000, 64_000])
        XCTAssertEqual(capture.pendingChunks().filter { $0.channel == .system }.count, 5)
        // A stale watermark must never bring deleted audio back or eat uncommitted speech.
        try capture.acknowledge(session: session, channel: .mine, finalThroughFrame: 16_000)
        XCTAssertEqual(capture.pendingChunks().count, 8)
        try capture.stop()
        for channel in MeetingChannel.allCases {
            try capture.acknowledge(session: session, channel: channel, finalThroughFrame: 80_000, contextFrames: 0)
        }
        XCTAssertTrue(capture.pendingChunks().isEmpty)
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
    }
}

extension MeetingCaptureTests {
    func testStreamingAndSpoolShareTheClockEvenWhenOneSourceStartsLate() throws {
        let root = try temporary(), mine = MeetingFakeSource(), system = MeetingFakeSource()
        let capture = try MeetingCapture(root: root, mine: mine, system: system, now: { 100 })
        var starts: [MeetingChannel: [Int]] = [:]
        capture.onSamples = { channel, frame, _ in starts[channel, default: []].append(frame) }
        try capture.start(chunkDuration: 0.1)
        system.send(0.2, frames: 1600, at: 100)
        mine.send(0.3, frames: 1600, at: 100.2)
        // Small delivery jitter uses the sample counter, not independent per-channel zero-based clocks.
        mine.send(0.4, frames: 1600, at: 100.301)
        try capture.stop()
        XCTAssertEqual(starts[.mine], [3200, 4800])
        XCTAssertEqual(starts[.system], [0])
        XCTAssertEqual(capture.pendingChunks().filter { $0.channel == .mine }.map(\.startFrame), [3200, 4800])
    }

    func testRecoveryIgnoresSymlinksAndOnlyTruncatesAnIncompleteLastFloat() throws {
        let root = try temporary()
        var spool: MeetingBuffer? = try MeetingBuffer(root: root, chunkDuration: 1)
        _ = try spool!.append([0.25, 0.5], channel: .mine, startFrame: 123)
        let dir = spool!.directory
        spool = nil
        let part = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil).first)
        let handle = try FileHandle(forWritingTo: part)
        try handle.seekToEnd()
        try handle.write(contentsOf: Data([1, 2, 3]))
        try handle.close()
        let outside = try temporary()
        try Data([9, 9, 9, 9]).write(to: outside)
        try FileManager.default.createSymbolicLink(at: dir.appendingPathComponent("system-0-\(UUID()).pcm"), withDestinationURL: outside)
        let recovered = try MeetingBuffer.recover(root: root)
        XCTAssertEqual(recovered.count, 1)
        XCTAssertEqual(recovered[0].startFrame, 123)
        XCTAssertEqual(try floats(recovered[0]), [0.25, 0.5])
        XCTAssertEqual(try Data(contentsOf: outside), Data([9, 9, 9, 9]))
    }
}
