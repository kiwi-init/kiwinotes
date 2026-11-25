import Foundation

/// A mídia durante a fala do gato (T26830, opção B do harry, #28538): a saída do Mac desce 6 dB, metade do som, na
/// escala de dB do próprio aparelho, e a voz do gato sobe ×2 no player (`gain`), para se ouvir igual. Os outros apps
/// ficam com metade do som.
/// - O mesmo `DictationMedia` do ditado, com o journal próprio: uma queda do helper no meio da fala devolve o volume na
///   próxima abertura.
/// - Um aparelho sem a escala em dB não abaixa: sem saber quanto desceu, a voz não teria como voltar ao mesmo som.
/// - Com o mic gravando (o ditado já abaixou mais) ou numa reunião, nada desce.
/// - Um ditado que começa no meio da fala devolve antes a mídia da fala (`beforeDictation`): as duas nunca se empilham,
///   e cada uma devolve o volume da pessoa.
public final class SpeechMedia {
    /// Metade da amplitude, em dB.
    public static let step = Float(20 * log10(0.5))
    private let media: DictationMedia

    public init(volume: MediaVolumeControl?, journal: MediaVolumeJournal? = nil, notify: @escaping (String) -> Void = { _ in }) {
        media = DictationMedia(volume: volume, journal: journal, lowering: .decibels(Self.step), notify: notify)
    }

    /// A fala começou a tocar.
    public func duck(recording: Bool, meeting: Bool) {
        if recording { return }
        media.begin(meetingActive: meeting)
    }

    /// A fala acabou, foi cortada ou deu erro.
    public func unduck() { media.end() }

    /// O mic do ditado ou do gato vai abrir, ou uma reunião começou: a mídia da fala volta antes.
    public func release() {
        if media.isLowered { media.end() }
    }

    /// A abertura do helper e a troca de aparelho: devolve o que uma queda deixou abaixado.
    public func restorePending() { media.restorePending() }

    /// O ganho da voz agora: o que a mídia abaixada tirou, até ×2. 1 sem nada abaixado.
    public var gain: Float { media.compensation() }

    /// O volume para a boca do gato: com a mídia abaixada, a voz se ouve com o volume de antes.
    public func mouthVolume(device: Float) -> Float { media.originalVolume ?? device }
}
