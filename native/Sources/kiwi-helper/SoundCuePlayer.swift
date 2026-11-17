import AVFoundation
import KiwiHelperCore

/// T5833 (#213): toca os sons de início e de fim. Um `AVAudioPlayer` por som, feitos uma vez a partir da receita
/// (`CueSynth`), sem arquivo nenhum. Volume próprio e baixo, fora do volume de alerta do macOS. Os agentes nunca chegam
/// aqui: o headless usa o `SilentCuePlayer`, e os testes um player falso.
final class SoundCuePlayer: CuePlaying {
    static let volume: Float = 0.35
    private var players: [Cue: AVAudioPlayer] = [:]

    init(recipe: CueRecipe = CueRecipe.named(CueRecipe.defaultName)!) {
        for cue in Cue.allCases {
            let data = WAV.encode(samples: CueSynth.render(recipe, cue), sampleRate: 44_100)
            guard let player = try? AVAudioPlayer(data: data) else { continue }
            player.volume = Self.volume
            player.prepareToPlay()
            players[cue] = player
        }
    }

    func play(_ cue: Cue) {
        guard let player = players[cue] else { return }
        player.currentTime = 0
        player.play()
    }
}

/// O headless (a CLI dos agentes): nunca toca som.
final class SilentCuePlayer: CuePlaying {
    func play(_ cue: Cue) {}
}
