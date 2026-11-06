import Darwin
import Foundation

public struct MediaVolumeChange: Codable, Equatable, Sendable {
    public let target: MediaVolumeTarget
    public let original: Float
    public var lowered: Float
    public init(target: MediaVolumeTarget, original: Float, lowered: Float) {
        self.target = target; self.original = original; self.lowered = lowered
    }
}
public protocol MediaVolumeJournal: AnyObject {
    func load() throws -> [MediaVolumeChange]?
    func save(_ changes: [MediaVolumeChange]) throws
    func clear() throws
}
public enum MediaVolumeJournalError: Error { case unavailable, invalid }

/// Atomic owner-only recovery marker. Written and fsynced before changing any output channel.
public final class FileMediaVolumeJournal: MediaVolumeJournal {
    public let file: URL
    private struct Record: Codable { let version: Int; let changes: [MediaVolumeChange] }
    public init(file: URL) { self.file = file }
    public func load() throws -> [MediaVolumeChange]? {
        let fd = Darwin.open(file.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
        if fd < 0 { if errno == ENOENT { return nil }; throw MediaVolumeJournalError.unavailable }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        defer { try? handle.close() }
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_mode & S_IFMT == S_IFREG, info.st_uid == geteuid(),
              info.st_mode & 0o077 == 0, info.st_size > 0, info.st_size <= 65_536,
              let data = try handle.read(upToCount: 65_536) else { throw MediaVolumeJournalError.invalid }
        let record = try JSONDecoder().decode(Record.self, from: data)
        guard record.version == 1, Self.valid(record.changes) else { throw MediaVolumeJournalError.invalid }
        return record.changes
    }
    public func save(_ changes: [MediaVolumeChange]) throws {
        guard Self.valid(changes) else { throw MediaVolumeJournalError.invalid }
        let directory = file.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let data = try JSONEncoder().encode(Record(version: 1, changes: changes))
        guard data.count <= 65_536 else { throw MediaVolumeJournalError.invalid }
        let temporary = directory.appendingPathComponent(".media-volume-\(UUID()).tmp")
        let fd = Darwin.open(temporary.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw MediaVolumeJournalError.unavailable }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        defer { try? handle.close(); Darwin.unlink(temporary.path) }
        try handle.write(contentsOf: data); try handle.synchronize(); try handle.close()
        guard Darwin.rename(temporary.path, file.path) == 0 else { throw MediaVolumeJournalError.unavailable }
    }
    public func clear() throws {
        guard Darwin.unlink(file.path) == 0 || errno == ENOENT else { throw MediaVolumeJournalError.unavailable }
    }
    private static func valid(_ changes: [MediaVolumeChange]) -> Bool {
        !changes.isEmpty && changes.count <= 64 && Set(changes.map { "\($0.target.uid)#\($0.target.channel)" }).count == changes.count && changes.allSatisfy {
            $0.target.device > 0 && !$0.target.uid.isEmpty && $0.target.uid.utf8.count <= 1024 && $0.target.channel <= 32
            && $0.original.isFinite && $0.original > 0 && $0.original <= 1
            && $0.lowered.isFinite && $0.lowered >= 0 && $0.lowered <= 1
        }
    }
}
