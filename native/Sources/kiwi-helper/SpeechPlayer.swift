import AVFoundation
import KiwiHelperCore

/// T27825: a voz do gato no alto-falante. Um `AVAudioPlayerNode` num `AVAudioEngine` próprio, na saída padrão do Mac,
/// com os pedaços em fila (sem buraco entre eles). O motor sobe no 1º pedaço e pausa depois de um tempo sem fala, para
/// o Kiwi ficar quieto no Mac (spec #24228). Os agentes nunca chegam aqui: o headless usa o `SilentSpeech`.
///
/// A voz não passa pelo volume que o #17697 abaixa: quem abaixa só os outros apps é o T26830.
final class EngineSpeech: SpeechPlaying {
    private static let idlePause: TimeInterval = 3
    private let engine = AVAudioEngine()
    private let node = AVAudioPlayerNode()
    private let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: SpeechPCM.sampleRate, channels: 1, interleaved: false)!
    private let pending = SpeechPending()
    private let device = OutputVolume()
    private var idle: DispatchWorkItem?

    init() {
        engine.attach(node)
        engine.connect(node, to: engine.mainMixerNode, format: format)
    }

    /// O volume do dispositivo de saída: a voz mais baixa no Mac, a boca do gato mexe menos. Sem controle de volume
    /// (uma saída digital), 1.
    var volume: Float {
        guard let target = device.targets().first, let value = device.read(target) else { return 1 }
        return max(0, min(1, value))
    }

    func play(_ samples: [Float], done: @escaping () -> Void) throws {
        idle?.cancel()
        idle = nil
        if !engine.isRunning {
            engine.prepare()
            try engine.start()
        }
        guard !samples.isEmpty, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)) else {
            return DispatchQueue.main.async(execute: done)
        }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { buffer.floatChannelData![0].update(from: $0.baseAddress!, count: samples.count) }
        let id = pending.add(done)
        node.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            DispatchQueue.main.async { self?.finished(id) }
        }
        if !node.isPlaying { node.play() }
    }

    func stop() {
        // O `stop` do nó joga fora a fila; os `done` rodam aqui, e o retorno atrasado de cada pedaço já não acha nada.
        node.stop()
        pending.flush()
        scheduleIdle()
    }

    private func finished(_ id: Int) {
        pending.finish(id)
        if pending.count == 0 { scheduleIdle() }
    }

    private func scheduleIdle() {
        idle?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.pending.count == 0 else { return }
            self.node.stop()
            self.engine.pause()
        }
        idle = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.idlePause, execute: work)
    }
}
