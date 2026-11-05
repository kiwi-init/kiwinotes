import Foundation

public enum MeetingChannel: String, Codable, CaseIterable, Sendable { case mine, system }

/// Headerless, little-endian Float32, mono at 16 kHz. Audio stays in the helper; IPC carries metadata only.
public struct MeetingChunk: Equatable, Sendable {
    public let session: String
    public let channel: MeetingChannel
    public let startFrame: Int
    public let frames: Int
    public let url: URL
    public var id: String { url.deletingPathExtension().lastPathComponent }
    public var fields: [String: Any] {
        ["session": session, "chunkId": id, "channel": channel.rawValue, "startFrame": startFrame,
         "frames": frames, "sampleRate": 16_000, "format": "f32le", "path": url.path]
    }
}

public enum MeetingFailure: String, Error { case invalidValue = "invalid_value", alreadyRecording = "already_recording", notRecording = "not_recording", invalidChunk = "invalid_chunk", storage = "meeting_storage" }

/// A crash-safe spool. Every callback goes to disk immediately, not only when a chunk fills. A `.part` is valid
/// Float32 too: after a crash recovery seals its complete frames. Only an explicit final-text ack removes audio.
/// One instance per recording, used on its owner's serial queue. Directory names and chunk IDs are generated here.
public final class MeetingBuffer {
    public static let sampleRate = 16_000
    public let directory: URL
    public let session: String
    public let chunkFrames: Int
    private struct OpenChunk { let url: URL; let handle: FileHandle; let start: Int; var frames: Int }
    private var open: [MeetingChannel: OpenChunk] = [:]

    public init(root: URL, chunkDuration: Double, session: UUID = UUID()) throws {
        guard chunkDuration.isFinite, (0.02...60).contains(chunkDuration) else { throw MeetingFailure.invalidValue }
        self.session = session.uuidString
        chunkFrames = Int((chunkDuration * Double(Self.sampleRate)).rounded())
        directory = root.appendingPathComponent(self.session, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
    }

    /// Packet start on the meeting's common clock, so pause/resume and late input never shift one channel onto the other.
    public func append(_ samples: [Float], channel: MeetingChannel, startFrame: Int) throws -> [MeetingChunk] {
        guard startFrame >= 0 else { throw MeetingFailure.invalidValue }
        var ready: [MeetingChunk] = []
        if let current = open[channel], abs(startFrame - (current.start + current.frames)) > 1_600 {
            if let chunk = try seal(channel) { ready.append(chunk) }
        }
        var offset = 0
        while offset < samples.count {
            if open[channel] == nil {
                let start = startFrame + offset
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                let url = directory.appendingPathComponent("\(channel.rawValue)-\(start)-\(UUID().uuidString).part")
                guard FileManager.default.createFile(atPath: url.path, contents: nil, attributes: [.posixPermissions: 0o600]) else { throw MeetingFailure.storage }
                open[channel] = OpenChunk(url: url, handle: try FileHandle(forWritingTo: url), start: start, frames: 0)
            }
            var current = open[channel]!
            let count = min(chunkFrames - current.frames, samples.count - offset)
            var bytes = Data(capacity: count * 4)
            for sample in samples[offset..<(offset + count)] {
                var bits = sample.bitPattern.littleEndian
                withUnsafeBytes(of: &bits) { bytes.append(contentsOf: $0) }
            }
            try current.handle.write(contentsOf: bytes)
            try current.handle.synchronize()
            current.frames += count
            open[channel] = current
            offset += count
            if current.frames == chunkFrames, let chunk = try seal(channel) { ready.append(chunk) }
        }
        return ready
    }

    public func finish() throws -> [MeetingChunk] {
        try MeetingChannel.allCases.compactMap { try seal($0) }
    }

    private func seal(_ channel: MeetingChannel) throws -> MeetingChunk? {
        guard let current = open[channel] else { return nil }
        try current.handle.synchronize()
        try current.handle.close()
        open.removeValue(forKey: channel)
        let url = current.url.deletingPathExtension().appendingPathExtension("pcm")
        try FileManager.default.moveItem(at: current.url, to: url)
        return MeetingChunk(session: session, channel: channel, startFrame: current.start, frames: current.frames, url: url)
    }

    deinit { for current in open.values { try? current.handle.close() } }

    /// Never follows caller paths or symlinks. Reopening doesn't start any capture or delete pending speech.
    public static func recover(root: URL) throws -> [MeetingChunk] {
        let fm = FileManager.default
        guard fm.fileExists(atPath: root.path) else { return [] }
        var chunks: [MeetingChunk] = []
        for dir in try fm.contentsOfDirectory(at: root, includingPropertiesForKeys: [.isSymbolicLinkKey, .isDirectoryKey]) {
            let kind = try dir.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey])
            guard kind.isSymbolicLink != true, kind.isDirectory == true, UUID(uuidString: dir.lastPathComponent) != nil else { continue }
            for file in try fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.isSymbolicLinkKey, .isRegularFileKey, .fileSizeKey]) {
                let kind = try file.resourceValues(forKeys: [.isSymbolicLinkKey, .isRegularFileKey, .fileSizeKey])
                guard kind.isSymbolicLink != true, kind.isRegularFile == true, ["part", "pcm"].contains(file.pathExtension) else { continue }
                let bits = file.deletingPathExtension().lastPathComponent.split(separator: "-", maxSplits: 2)
                guard bits.count == 3, let channel = MeetingChannel(rawValue: String(bits[0])), let start = Int(bits[1]), start >= 0,
                      UUID(uuidString: String(bits[2])) != nil else { continue }
                let bytes = kind.fileSize ?? 0
                guard bytes >= 4 else { try fm.removeItem(at: file); continue }
                // A process can die between writes: ignore only the incomplete last Float32, not the whole chunk.
                if bytes % 4 != 0 {
                    let handle = try FileHandle(forWritingTo: file)
                    defer { try? handle.close() }
                    try handle.truncate(atOffset: UInt64(bytes / 4 * 4))
                    try handle.synchronize()
                }
                let sealed = file.deletingPathExtension().appendingPathExtension("pcm")
                if file.pathExtension == "part" { try fm.moveItem(at: file, to: sealed) }
                chunks.append(MeetingChunk(session: dir.lastPathComponent, channel: channel, startFrame: start, frames: bytes / 4, url: sealed))
            }
            if try fm.contentsOfDirectory(atPath: dir.path).isEmpty { try fm.removeItem(at: dir) }
        }
        return chunks.sorted { ($0.session, $0.startFrame, $0.channel.rawValue) < ($1.session, $1.startFrame, $1.channel.rawValue) }
    }

    /// Call only after the final text is durably committed. R3 supplies that acknowledgment, including recovery.
    public static func acknowledge(_ chunk: MeetingChunk, root: URL) throws {
        let expected = root.appendingPathComponent(chunk.session).appendingPathComponent(chunk.id + ".pcm")
        guard expected.standardizedFileURL == chunk.url.standardizedFileURL,
              UUID(uuidString: chunk.session) != nil, !chunk.id.contains("/") else { throw MeetingFailure.invalidChunk }
        try FileManager.default.removeItem(at: expected)
        let dir = expected.deletingLastPathComponent()
        if try FileManager.default.contentsOfDirectory(atPath: dir.path).isEmpty { try FileManager.default.removeItem(at: dir) }
    }
}
