// O som do helper headless (spec #17697, T18410): a prova de que falar com o Kiwi-cat abaixa a mídia e devolve, sem
// o mic de verdade e sem mexer no som do Mac. Os dois só existem no `--headless` (a CLI dos agentes):
// - `SilentMic`: um "mic" que entrega silêncio (zeros) a cada 50 ms enquanto grava, sem abrir dispositivo nenhum.
//   `starved` corta os buffers, e o watchdog da captura derruba a gravação como um mic que caiu (`no_audio`).
// - `LoggedVolume`: um volume de saída falso, 0,60 no começo, que só escreve no log o que a L8 faria.
import AVFoundation
import Foundation

/// O "mic" do headless: a fábrica dos motores silenciosos e o interruptor da queda. `starved` vale para todos os motores,
/// até o próximo `starved = false`: a captura troca de motor quando para de receber áudio, e o novo também fica mudo.
public final class SilentMic: @unchecked Sendable {
    private let lock = NSLock()
    private var _starved = false
    public init() {}
    public var starved: Bool {
        get { lock.withLock { _starved } }
        set { lock.withLock { _starved = newValue } }
    }
    public func engine() -> SilentMicEngine { SilentMicEngine(mic: self) }
}

public final class SilentMicEngine: MicEngine {
    public var onConfigurationChange: (() -> Void)?
    public static let format = InputFormat(sampleRate: 48_000, channels: 1)
    private let avFormat = AVAudioFormat(standardFormatWithSampleRate: SilentMicEngine.format.sampleRate, channels: 1)!
    private let mic: SilentMic
    private var onBuffer: ((AVAudioPCMBuffer) -> Void)?
    private var timer: DispatchSourceTimer?
    private let queue = DispatchQueue(label: "kiwi.silent-mic")
    public private(set) var preparedFormat: InputFormat?

    init(mic: SilentMic) { self.mic = mic }

    public func hardwareFormat() -> InputFormat? { Self.format }

    public func prepare(onBuffer: @escaping (AVAudioPCMBuffer) -> Void) throws {
        self.onBuffer = onBuffer
        preparedFormat = Self.format
    }

    public func start() throws {
        let frames = AVAudioFrameCount(Self.format.sampleRate / 20)
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now(), repeating: .milliseconds(50))
        t.setEventHandler { [weak self] in
            guard let self, !self.mic.starved, let onBuffer = self.onBuffer,
                  let b = AVAudioPCMBuffer(pcmFormat: self.avFormat, frameCapacity: frames) else { return }
            b.frameLength = frames // zeros: o buffer novo vem zerado
            onBuffer(b)
        }
        timer?.cancel()
        timer = t
        t.resume()
    }

    public func stop() {
        timer?.cancel()
        timer = nil
    }

    public func discard() {
        stop()
        onBuffer = nil
    }
}

/// O volume falso do headless: um alvo só, 0,60 no começo. A escrita muda o valor e vai ao log, e nada sai do processo.
public final class LoggedVolume: MediaVolumeControl {
    public static let target = MediaVolumeTarget(device: 1, uid: "kiwi-headless-output", channel: 0) // o diário exige device > 0
    public private(set) var value: Float
    private let log: (String) -> Void

    public init(initial: Float = 0.6, log: @escaping (String) -> Void) {
        value = initial
        self.log = log
    }

    public func targets() -> [MediaVolumeTarget] { [Self.target] }

    public func read(_ target: MediaVolumeTarget) -> Float? { target == Self.target ? value : nil }

    public func write(_ new: Float, to target: MediaVolumeTarget) -> Bool {
        guard target == Self.target else { return false }
        log(String(format: "media: volume %.2f → %.2f (headless)", value, new))
        value = new
        return true
    }
}
