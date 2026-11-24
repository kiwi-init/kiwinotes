// O protocolo do `kiwi-voice` (T26732): uma linha de JSON por mensagem, pelo stdin e pelo stdout. O log vai ao stderr.
//
// Entra:
//   {"type":"load","modelDir":"…","refAudio":"…","refText":"…","language":"portuguese","cacheMB":512}
//   {"type":"speak","id":"t1","text":"…"}   uma frase por vez; uma nova espera a anterior acabar
//   {"type":"cancel","id":"t1"}             corta a geração no próximo passo do codec, ou tira da fila
//   {"type":"warmup"}                       uma frase curta, jogada fora: compila os kernels Metal
//   {"type":"quit"}
// Sai:
//   {"type":"ready","sampleRate":24000,"loadMs":…}
//   {"type":"pcm","id":"t1","seq":0,"pcm":"<Int16 LE mono, base64>"}
//   {"type":"done","id":"t1"}   {"type":"cancelled","id":"t1"}   {"type":"warm","ms":…}
//   {"type":"error","id":"t1"?,"message":"…"}

import Foundation

public enum VoiceCommand: Equatable, Sendable {
    case load(modelDir: String, refAudio: String, refText: String, language: String, cacheMB: Int)
    case speak(id: String, text: String)
    case cancel(id: String)
    case warmup
    case quit
}

public enum VoiceProtocolError: Error, Equatable {
    case notJSON
    case unknownType(String)
    case missing(String)
}

/// O teto de cache do MLX que o ADR 0014 pede, quando o `load` não diz outro.
public let defaultCacheMB = 512

public func decodeCommand(_ line: String) throws -> VoiceCommand {
    guard let data = line.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw VoiceProtocolError.notJSON }
    func str(_ key: String) throws -> String {
        guard let v = obj[key] as? String, !v.isEmpty else { throw VoiceProtocolError.missing(key) }
        return v
    }
    switch obj["type"] as? String ?? "" {
    case "load":
        let cache = (obj["cacheMB"] as? NSNumber)?.intValue ?? defaultCacheMB
        return .load(modelDir: try str("modelDir"), refAudio: try str("refAudio"), refText: try str("refText"),
                     language: (obj["language"] as? String) ?? "portuguese", cacheMB: cache > 0 ? cache : defaultCacheMB)
    case "speak": return .speak(id: try str("id"), text: try str("text"))
    case "cancel": return .cancel(id: try str("id"))
    case "warmup": return .warmup
    case "quit": return .quit
    case let other: throw VoiceProtocolError.unknownType(other)
    }
}

public enum VoiceEvent: Equatable, Sendable {
    case ready(sampleRate: Int, loadMs: Int)
    case pcm(id: String, seq: Int, samples: [Int16])
    case done(id: String)
    case cancelled(id: String)
    case warm(ms: Int)
    case error(id: String?, message: String)
}

/// Uma linha de JSON, sem a quebra de linha.
public func encodeEvent(_ e: VoiceEvent) -> String {
    var obj: [String: Any]
    switch e {
    case let .ready(sr, ms): obj = ["type": "ready", "sampleRate": sr, "loadMs": ms]
    case let .pcm(id, seq, samples): obj = ["type": "pcm", "id": id, "seq": seq, "pcm": int16Base64(samples)]
    case let .done(id): obj = ["type": "done", "id": id]
    case let .cancelled(id): obj = ["type": "cancelled", "id": id]
    case let .warm(ms): obj = ["type": "warm", "ms": ms]
    case let .error(id, message):
        obj = ["type": "error", "message": message]
        if let id { obj["id"] = id }
    }
    let data = try! JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys, .withoutEscapingSlashes])
    return String(decoding: data, as: UTF8.self)
}

/// Float do modelo (−1…1) para Int16, cortando o que passa do limite.
public func toInt16(_ samples: [Float]) -> [Int16] {
    samples.map { s in
        let v = (s.isFinite ? max(-1, min(1, s)) : 0) * 32767
        return Int16(v.rounded())
    }
}

public func int16Base64(_ samples: [Int16]) -> String {
    samples.withUnsafeBufferPointer { buf in
        Data(buffer: buf).base64EncodedString() // o Mac é little-endian, como o contrato pede
    }
}

/// A fila das frases: uma toca por vez, na ordem; o `cancel` tira a que ainda não começou.
public struct SpeakQueue: Sendable {
    public private(set) var pending: [(id: String, text: String)] = []
    public init() {}
    public mutating func push(id: String, text: String) { pending.append((id, text)) }
    public mutating func next() -> (id: String, text: String)? { pending.isEmpty ? nil : pending.removeFirst() }
    /// Verdadeiro se a frase estava na fila (e saiu dela).
    public mutating func remove(id: String) -> Bool {
        guard let i = pending.firstIndex(where: { $0.id == id }) else { return false }
        pending.remove(at: i)
        return true
    }
}
