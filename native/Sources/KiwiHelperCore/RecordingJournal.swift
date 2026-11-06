import Darwin
import Foundation

public struct RecordingApp: Codable, Equatable, Sendable {
    public let bundleId: String
    public let name: String?
    public init(bundleId: String, name: String? = nil) { self.bundleId = bundleId; self.name = name }
}

public struct RecordingRecovery: Codable, Equatable, Sendable {
    public let id: String
    public let at: String
    public let app: RecordingApp?
    public let target: String?
    public var fields: [String: Any] { ["id": id, "at": at] }
}

public enum RecordingStorageError: Error { case busy, invalidAudio, nonContiguous, tooLarge, openFailed }

/// The dictation's private, incremental PCM16 WAV. No device APIs: the capture hands over retained buffers.
/// Appends are queued off the engine thread. The capture calls this inside its own serial buffer queue, so finish
/// can drain every accepted buffer. Neither closing the file nor a finalizer is needed to read a checkpoint.
public final class RecordingJournal: @unchecked Sendable {
    public static let sampleRate = 16_000
    public let directory: URL
    public var onError: ((String) -> Void)?
    private let queue = DispatchQueue(label: "kiwi.dictation.journal")
    private struct Open {
        let metadata: RecordingRecovery
        let handle: FileHandle
        var frames: Int = 0
        var syncedAt: TimeInterval = ProcessInfo.processInfo.systemUptime
        var failure: Error?
    }
    private var active: Open?

    public init(directory: URL) { self.directory = directory }

    public static func isIdentifier(_ id: String) -> Bool {
        UUID(uuidString: id)?.uuidString.lowercased() == id
    }

    public func begin(app: RecordingApp? = nil, target: String? = nil, at: Date = Date()) throws -> RecordingRecovery {
        try queue.sync {
            guard active == nil else { throw RecordingStorageError.busy }
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let date = ISO8601DateFormatter(); date.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let metadata = RecordingRecovery(id: UUID().uuidString.lowercased(), at: date.string(from: at), app: app, target: target)
            let wav = url(metadata.id, "wav"), manifest = url(metadata.id, "json")
            let handle = try Self.create(wav)
            do {
                try handle.write(contentsOf: Self.header(frames: 0)); try handle.synchronize()
                let json = try Self.create(manifest)
                do { try json.write(contentsOf: JSONEncoder().encode(metadata)); try json.synchronize(); try json.close() }
                catch { try? json.close(); throw error }
                active = Open(metadata: metadata, handle: handle)
                return metadata
            } catch {
                try? handle.close(); try? FileManager.default.removeItem(at: wav); try? FileManager.default.removeItem(at: manifest)
                throw error
            }
        }
    }

    /// `offset` is the count already retained by AudioCapture, before this chunk. An engine start retry may reset it.
    public func append(_ samples: [Float], at offset: Int) {
        guard !samples.isEmpty else { return }
        queue.async { [self] in
            guard var open = active, open.failure == nil else { return }
            do {
                guard offset >= 0, offset <= open.frames else { throw RecordingStorageError.nonContiguous }
                if offset < open.frames {
                    try open.handle.truncate(atOffset: UInt64(44 + offset * 2)); open.frames = offset
                }
                guard open.frames + samples.count <= (Int(UInt32.max) - 36) / 2 else { throw RecordingStorageError.tooLarge }
                var pcm = Data(capacity: samples.count * 2)
                for sample in samples {
                    let value = Int16((sample.isFinite ? min(1, max(-1, sample)) : 0) * Float(Int16.max)).littleEndian
                    withUnsafeBytes(of: value) { pcm.append(contentsOf: $0) }
                }
                try open.handle.seekToEnd(); try open.handle.write(contentsOf: pcm)
                open.frames += samples.count
                try open.handle.seek(toOffset: 0); try open.handle.write(contentsOf: Self.header(frames: open.frames))
                let now = ProcessInfo.processInfo.systemUptime
                if now - open.syncedAt >= 1 { try open.handle.synchronize(); open.syncedAt = now }
            } catch {
                open.failure = error
                onError?("recording_storage") // no paths, samples or speech in the log
            }
            active = open
        }
    }

    /// For a checkpoint/test; finish also drains the queue. No microphone is opened here.
    public func checkpoint() throws {
        try queue.sync {
            guard let open = active else { return }
            if let failure = open.failure { throw failure }
            try open.handle.synchronize()
        }
    }

    @discardableResult public func finish() throws -> RecordingRecovery? {
        try queue.sync {
            guard let open = active else { return nil }
            active = nil
            defer { try? open.handle.close() }
            try open.handle.synchronize()
            if let failure = open.failure { throw failure }
            if open.frames == 0 { try remove(open.metadata.id); return nil }
            return open.metadata
        }
    }

    public func cancel() throws {
        try queue.sync {
            guard let open = active else { return }
            active = nil; try? open.handle.close(); try remove(open.metadata.id)
        }
    }

    public func audioURL(_ id: String) throws -> URL {
        guard Self.isIdentifier(id) else { throw RecordingStorageError.invalidAudio }
        return url(id, "wav")
    }
    private func url(_ id: String, _ ext: String) -> URL { directory.appendingPathComponent("\(id).\(ext)") }

    private func remove(_ id: String) throws {
        for ext in ["wav", "json"] {
            let file = url(id, ext)
            if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
        }
    }

    /// A crash can land between PCM append and header update. Trust only complete frames in our fixed-format file.
    /// O_NOFOLLOW rejects a substituted symlink. This is only for managed UUID files, never a user's arbitrary WAV.
    @discardableResult public static func repair(_ url: URL) throws -> Int {
        let fd = Darwin.open(url.path, O_RDWR | O_NOFOLLOW)
        guard fd >= 0 else { throw RecordingStorageError.openFailed }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        defer { try? handle.close() }
        let header = try handle.read(upToCount: 44) ?? Data()
        guard header.count == 44,
              String(data: header[0..<4], encoding: .utf8) == "RIFF",
              String(data: header[8..<16], encoding: .utf8) == "WAVEfmt ",
              Array(header[16..<24]) == [16, 0, 0, 0, 1, 0, 1, 0],
              Array(header[24..<28]) == [128, 62, 0, 0],
              Array(header[32..<34]) == [2, 0],
              Array(header[34..<36]) == [16, 0],
              String(data: header[36..<40], encoding: .utf8) == "data" else { throw RecordingStorageError.invalidAudio }
        let size = try handle.seekToEnd()
        guard size >= 44, size - 44 <= UInt64(UInt32.max) - 36 else { throw RecordingStorageError.tooLarge }
        let frames = Int((size - 44) / 2)
        try handle.truncate(atOffset: UInt64(44 + frames * 2))
        try handle.seek(toOffset: 0); try handle.write(contentsOf: Self.header(frames: frames)); try handle.synchronize()
        return frames
    }

    private static func create(_ url: URL) throws -> FileHandle {
        let fd = Darwin.open(url.path, O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw RecordingStorageError.openFailed }
        return FileHandle(fileDescriptor: fd, closeOnDealloc: true)
    }

    private static func header(frames: Int) -> Data {
        var data = WAV.encode(samples: [], sampleRate: sampleRate)
        var size = UInt32(frames * 2).littleEndian
        withUnsafeBytes(of: &size) { data.replaceSubrange(40..<44, with: $0) }
        var riff = UInt32(36 + frames * 2).littleEndian
        withUnsafeBytes(of: &riff) { data.replaceSubrange(4..<8, with: $0) }
        return data
    }
}
