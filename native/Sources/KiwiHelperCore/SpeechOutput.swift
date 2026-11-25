import Foundation

/// A voz do gato no alto-falante (T27825): o PCM que o app manda (`speech.play`), Int16 mono a 24 kHz, como o
/// `kiwi-voice` entrega (ADR 0014). A ordem, o corte e o nível são do player no app (`FalaPlayer`); aqui só a fila.
public enum SpeechPCM {
    public static let sampleRate: Double = 24_000

    /// Int16 little-endian em base64 → Float de -1 a 1. nil se não é base64, está vazio ou tem um byte sobrando.
    public static func floats(base64: String) -> [Float]? {
        guard let data = Data(base64Encoded: base64), !data.isEmpty, data.count % 2 == 0 else { return nil }
        var out = [Float](repeating: 0, count: data.count / 2)
        data.withUnsafeBytes { raw in
            for i in 0..<out.count {
                out[i] = Float(Int16(littleEndian: raw.loadUnaligned(fromByteOffset: i * 2, as: Int16.self))) / 32768
            }
        }
        return out
    }

    public static func seconds(_ samples: Int) -> Double { Double(samples) / sampleRate }
}

/// Quem toca a voz: o app usa o `AVAudioEngine`; o headless (a CLI dos agentes) e os testes, o `SilentSpeech`.
public protocol SpeechPlaying: AnyObject {
    /// Agenda o pedaço depois dos que já estão na fila. `done` roda uma vez, no main: quando ele acabou de tocar ou foi
    /// limpo pelo `stop`.
    func play(_ samples: [Float], done: @escaping () -> Void) throws
    /// Corta na hora: o que está tocando e a fila. Os `done` pendentes rodam.
    func stop()
    /// O volume com que a voz sai (0 a 1), para a boca do gato acompanhar o que se ouve.
    var volume: Float { get }
}

/// A fila dos `done` de uma saída: cada pedaço uma vez, e nada de um pedaço que o `stop` já limpou.
public final class SpeechPending {
    private var waiting: [Int: () -> Void] = [:]
    private var next = 0

    public init() {}

    public var count: Int { waiting.count }

    /// Guarda o `done` de um pedaço novo e devolve o número dele.
    public func add(_ done: @escaping () -> Void) -> Int {
        next += 1
        waiting[next] = done
        return next
    }

    /// O pedaço acabou: roda o `done` dele, se ainda não rodou.
    public func finish(_ id: Int) {
        waiting.removeValue(forKey: id)?()
    }

    /// O `stop`: roda todos, na ordem em que entraram.
    public func flush() {
        let all = waiting.sorted { $0.key < $1.key }.map(\.value)
        waiting = [:]
        for done in all { done() }
    }
}

/// O headless: "toca" cada pedaço pelo tempo dele, em fila, sem abrir dispositivo nenhum. Nada sai no alto-falante.
public final class SilentSpeech: SpeechPlaying {
    private let pending = SpeechPending()
    private let queue: DispatchQueue
    private var queueEnd = DispatchTime.now()

    public init(queue: DispatchQueue = .main) { self.queue = queue }

    public var volume: Float { 1 }

    public func play(_ samples: [Float], done: @escaping () -> Void) {
        let start = max(queueEnd, .now())
        queueEnd = start + .nanoseconds(Int(SpeechPCM.seconds(samples.count) * 1e9))
        let id = pending.add(done)
        queue.asyncAfter(deadline: queueEnd) { [weak self] in self?.pending.finish(id) }
    }

    public func stop() {
        queueEnd = .now()
        pending.flush()
    }
}
