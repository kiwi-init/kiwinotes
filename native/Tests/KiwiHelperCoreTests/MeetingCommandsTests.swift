import Foundation
import XCTest
@testable import KiwiHelperCore

private final class CommandFakeSource: MeetingAudioSource {
    var starts = 0
    var callback: (([Float], TimeInterval) -> Void)?
    func start(onSamples: @escaping ([Float], TimeInterval) -> Void) throws { starts += 1; callback = onSamples }
    func stop() {}
}

final class MeetingCommandsTests: XCTestCase {
    private func message(_ type: String, _ fields: [String: Any] = [:]) throws -> InboundMessage {
        try InboundMessage.decode(IPC.encode(type, id: "test", fields))
    }
    func testHeadlessAndMissingMicNeverStartEitherSourceOrAskPermission() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("kiwi-command-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let mine = CommandFakeSource(), system = CommandFakeSource()
        let capture = try MeetingCapture(root: root, mine: mine, system: system)
        var reads = 0
        var events: [String] = []
        let headless = MeetingCommands(capture: capture, headless: true, microphonePermission: { reads += 1; return "granted" }, emit: { events.append($0); _ = $1 })
        XCTAssertEqual(headless.handle(try message("meeting.start")).error, "headless_no_mic")
        XCTAssertEqual(headless.handle(try message("meeting.resumeMine")).error, "headless_no_mic")
        XCTAssertEqual(reads, 0)
        let denied = MeetingCommands(capture: capture, headless: false, microphonePermission: { "undetermined" }, emit: { events.append($0); _ = $1 })
        XCTAssertEqual(denied.handle(try message("meeting.start")).error, "microphone_permission")
        XCTAssertEqual(events, ["meeting.error"])
        XCTAssertEqual(mine.starts + system.starts, 0)
    }

    func testCommandsWithFakeTapDeliverSpoolAndWatermarkDrain() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("kiwi-command-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let mine = CommandFakeSource(), system = CommandFakeSource()
        let capture = try MeetingCapture(root: root, mine: mine, system: system, now: { 100 })
        var events: [(String, [String: Any])] = []
        let commands = MeetingCommands(capture: capture, headless: false, microphonePermission: { "granted" }, metadata: { ["output": "speaker"] }, emit: { events.append(($0, $1)) })
        XCTAssertFalse(commands.handle(try message("meeting.start", ["chunkDuration": "bad"])).ok)
        let result = commands.handle(try message("meeting.start", ["app": "Teams", "chunkDuration": 0.1]))
        XCTAssertTrue(result.ok)
        let session = try XCTUnwrap(result.data["session"] as? String)
        XCTAssertEqual(events.last?.0, "meeting.started")
        XCTAssertEqual(events.last?.1["output"] as? String, "speaker")
        mine.callback?(Array(repeating: 0.2, count: 1600), 100)
        system.callback?(Array(repeating: 0.4, count: 1600), 100)
        XCTAssertTrue(commands.handle(try message("meeting.pauseMine")).ok)
        XCTAssertTrue(commands.handle(try message("meeting.resumeMine")).ok)
        XCTAssertTrue(commands.handle(try message("meeting.stop")).ok)
        XCTAssertEqual(events.last?.0, "meeting.stopped")
        XCTAssertEqual((commands.handle(try message("meeting.pending")).data["chunks"] as? [[String: Any]])?.count, 2)
        for channel in ["mine", "system"] {
            XCTAssertTrue(commands.handle(try message("meeting.ack", ["session": session, "channel": channel, "finalThroughFrame": 1600, "contextFrames": 0])).ok)
        }
        XCTAssertTrue(capture.pendingChunks().isEmpty)
        XCTAssertFalse(commands.handle(try message("meeting.ack", ["session": session, "channel": "mine", "finalThroughFrame": -1])).ok)
    }
}
