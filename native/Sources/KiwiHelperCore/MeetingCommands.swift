import Foundation

public struct MeetingReply {
    public let ok: Bool
    public let error: String?
    public let data: [String: Any]
    init(ok: Bool = true, error: String? = nil, data: [String: Any] = [:]) {
        self.ok = ok; self.error = error; self.data = data
    }
}

/// Command policy is tested with fake capture sources and fake permissions, never a macOS prompt.
public final class MeetingCommands {
    public let capture: MeetingCapture
    private let headless: Bool
    private let microphonePermission: () -> String
    private let metadata: () -> [String: Any]
    private let emit: (String, [String: Any]) -> Void

    public init(capture: MeetingCapture, headless: Bool, microphonePermission: @escaping () -> String,
                metadata: @escaping () -> [String: Any] = { [:] }, emit: @escaping (String, [String: Any]) -> Void) {
        self.capture = capture
        self.headless = headless
        self.microphonePermission = microphonePermission
        self.metadata = metadata
        self.emit = emit
        capture.onChunk = { chunk in emit("meeting.chunk", chunk.fields) }
        capture.onLevel = { channel, rms in emit("meeting.level", ["channel": channel.rawValue, "rms": rms]) }
    }

    public func recover() {
        for chunk in capture.pendingChunks() { emit("meeting.chunk", chunk.fields.merging(["recovered": true]) { _, new in new }) }
    }

    public func handle(_ message: InboundMessage) -> MeetingReply {
        do {
            switch message.type {
            case "meeting.start":
                guard !headless else { return MeetingReply(ok: false, error: "headless_no_mic") }
                let permission = microphonePermission()
                guard permission == "granted" else {
                    emit("meeting.error", ["error": "microphone_permission", "microphone": permission])
                    return MeetingReply(ok: false, error: "microphone_permission", data: ["microphone": permission])
                }
                if let app = message.fields["app"], !(app is String) { throw MeetingFailure.invalidValue }
                if message.fields["chunkDuration"] != nil, message.double("chunkDuration") == nil { throw MeetingFailure.invalidValue }
                let session = try capture.start(chunkDuration: message.double("chunkDuration") ?? 10)
                var fields = metadata()
                fields["session"] = session
                fields["sampleRate"] = 16_000
                if let app = message.string("app") { fields["app"] = app }
                emit("meeting.started", fields)
                return MeetingReply(data: ["session": session])
            case "meeting.stop":
                let session = capture.session
                try capture.stop()
                if let session { emit("meeting.stopped", ["session": session, "pendingChunks": capture.pendingChunks().filter { $0.session == session }.count]) }
            case "meeting.pauseMine": try capture.pauseMine()
            case "meeting.resumeMine":
                guard !headless else { return MeetingReply(ok: false, error: "headless_no_mic") }
                guard microphonePermission() == "granted" else { return MeetingReply(ok: false, error: "microphone_permission") }
                try capture.resumeMine()
            case "meeting.pending":
                return MeetingReply(data: ["chunks": capture.pendingChunks().map(\.fields)])
            case "meeting.ack":
                guard let session = message.string("session"), let name = message.string("channel"), let channel = MeetingChannel(rawValue: name),
                      let through = message.double("finalThroughFrame"), through.isFinite, through >= 0, through <= Double(Int32.max), through.rounded() == through else { throw MeetingFailure.invalidValue }
                let context = message.double("contextFrames") ?? 32_000
                guard context.isFinite, context >= 0, context <= Double(Int32.max), context.rounded() == context else { throw MeetingFailure.invalidValue }
                if message.fields["contextFrames"] != nil, message.double("contextFrames") == nil { throw MeetingFailure.invalidValue }
                try capture.acknowledge(session: session, channel: channel, finalThroughFrame: Int(through), contextFrames: Int(context))
            default: return MeetingReply(ok: false, error: "unknown_type")
            }
            return MeetingReply()
        } catch {
            let code = (error as? MeetingFailure)?.rawValue ?? "meeting_capture_failed"
            emit("meeting.error", ["error": code])
            return MeetingReply(ok: false, error: code)
        }
    }
}
