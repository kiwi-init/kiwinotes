import Foundation

/// NDJSON contract with the Bun app (ADR 0001, `app/src/shared/ipc.ts`).
/// One line = one JSON object `{v:1, type, id?, ...}`. A command with `id` gets `{type:"result", id, ok, error?}`.
public enum IPC {
    public static let version = 1
    public static let maxLineBytes = 1 << 20

    public static func encode(_ type: String, id: String? = nil, _ fields: [String: Any] = [:]) throws -> Data {
        var object = fields
        object["v"] = version
        object["type"] = type
        if let id { object["id"] = id }
        var data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
        guard data.count <= maxLineBytes else { throw IPCError.lineTooLong }
        data.append(0x0A)
        return data
    }

    public static func result(id: String, ok: Bool, error: String? = nil, _ fields: [String: Any] = [:]) throws -> Data {
        var object = fields
        object["ok"] = ok
        if let error { object["error"] = error }
        return try encode("result", id: id, object)
    }
}

public enum IPCError: Error, Equatable {
    case lineTooLong
    case notAnObject
    case missingType
    case unsupportedVersion(Int)
}

public struct InboundMessage {
    public let type: String
    public let id: String?
    public let fields: [String: Any]

    public static func decode(_ line: Data) throws -> InboundMessage {
        guard let object = try JSONSerialization.jsonObject(with: line) as? [String: Any] else {
            throw IPCError.notAnObject
        }
        guard let type = object["type"] as? String, !type.isEmpty else { throw IPCError.missingType }
        if let v = object["v"] as? Int, v != IPC.version { throw IPCError.unsupportedVersion(v) }
        return InboundMessage(type: type, id: object["id"] as? String, fields: object)
    }

    public func string(_ key: String) -> String? { fields[key] as? String }
    public func double(_ key: String) -> Double? { (fields[key] as? NSNumber)?.doubleValue }
}

/// Splits a byte stream into lines. A line over `maxLineBytes` is dropped whole and reported once.
public struct LineFramer {
    public let maxLineBytes: Int
    private var buffer = Data()
    private var discarding = false

    public init(maxLineBytes: Int = IPC.maxLineBytes) {
        self.maxLineBytes = maxLineBytes
    }

    public mutating func push(_ chunk: Data) -> [Result<Data, IPCError>] {
        var lines: [Result<Data, IPCError>] = []
        buffer.append(chunk)
        while let newline = buffer.firstIndex(of: 0x0A) {
            var line = Data(buffer[buffer.startIndex..<newline])
            buffer = Data(buffer[buffer.index(after: newline)...])
            if discarding {
                discarding = false
                lines.append(.failure(.lineTooLong))
                continue
            }
            if line.last == 0x0D { line.removeLast() }
            if line.count > maxLineBytes {
                lines.append(.failure(.lineTooLong))
            } else if !line.isEmpty {
                lines.append(.success(line))
            }
        }
        if buffer.count > maxLineBytes {
            buffer.removeAll(keepingCapacity: false)
            discarding = true
        }
        return lines
    }
}
