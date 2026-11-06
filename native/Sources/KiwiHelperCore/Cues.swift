import Foundation

// Os sons de início e de fim do ditado e da reunião (T5833, issue 213). Sons nossos, sintetizados aqui (a "receita"
// está no código): nenhum sample, nenhuma gravação, nada de jogo nenhum. A régua do harry (#5287) é a sensação dos
// sons de interface da Nintendo: curtos, limpos e gostosos, o início subindo e o fim descendo.

public enum Cue: String, CaseIterable, Sendable {
    case start
    case end
}

/// Uma proposta de som: um timbre e duas notas, que sobem no início e descem no fim.
public struct CueRecipe: Equatable, Sendable {
    public let name: String
    /// As duas notas (Hz), na ordem do início; o fim toca ao contrário.
    public let notes: (Double, Double)
    /// Quando a segunda nota entra (ms).
    public let gapMs: Double
    /// Os parciais do timbre: (múltiplo da fundamental, ganho, quanto mais rápido ele some).
    public let partials: [(ratio: Double, gain: Double, decay: Double)]
    /// A constante de decaimento da nota (ms): a "cauda".
    public let decayMs: Double
    /// Um pequeno deslize de afinação no ataque (fração da nota; 0 = nenhum), o "bloop" da gota.
    public let glide: Double
    public let lengthMs: Double

    public static func == (a: CueRecipe, b: CueRecipe) -> Bool { a.name == b.name }

    /// Três propostas para o harry escolher (o PR leva os WAVs, `kiwi-helper --render-cues`).
    public static let proposals: [CueRecipe] = [
        // Marimba: madeira macia, uma quinta (Mi6 → Si6). O 4º parcial da marimba, que some rápido, dá o "toc".
        CueRecipe(name: "marimba", notes: (1318.5, 1975.5), gapMs: 70,
                  partials: [(1, 1, 1), (4, 0.22, 3.2), (9.8, 0.05, 6)], decayMs: 55, glide: 0, lengthMs: 220),
        // Gota: um "bloop" que sobe de leve, uma quarta (Sol5 → Dó6). Mais brincalhão.
        CueRecipe(name: "gota", notes: (783.99, 1046.5), gapMs: 65,
                  partials: [(1, 1, 1), (2, 0.12, 2.5)], decayMs: 45, glide: 0.18, lengthMs: 200),
        // Kalimba: metal suave e inarmônico, uma terça maior (Dó6 → Mi6). O mais "brinquedo".
        CueRecipe(name: "kalimba", notes: (1046.5, 1318.5), gapMs: 75,
                  partials: [(1, 1, 1), (2.76, 0.3, 2.8), (5.4, 0.08, 5)], decayMs: 70, glide: 0, lengthMs: 240),
    ]

    public static let defaultName = "marimba"

    public static func named(_ name: String) -> CueRecipe? { proposals.first { $0.name == name } }
}

/// Sintetiza um som. Pura: a receita entra, as amostras (−1…1) saem.
public enum CueSynth {
    /// O pico: baixo de propósito (−8 dBFS); o player ainda aplica o volume dele.
    public static let peak: Float = 0.4

    public static func render(_ recipe: CueRecipe, _ cue: Cue, sampleRate: Double = 44_100) -> [Float] {
        let count = Int(recipe.lengthMs / 1000 * sampleRate)
        var out = [Float](repeating: 0, count: count)
        let (first, second) = cue == .start ? recipe.notes : (recipe.notes.1, recipe.notes.0)
        for (index, note) in [first, second].enumerated() {
            let offset = Int(Double(index) * recipe.gapMs / 1000 * sampleRate)
            // A segunda nota um pouco mais baixa: a frase "termina" nela sem gritar.
            let level = index == 0 ? 1.0 : 0.85
            var phases = [Double](repeating: 0, count: recipe.partials.count)
            for i in offset..<count {
                let t = Double(i - offset) / sampleRate
                // Ataque de 3 ms (sem estalo) e cauda exponencial.
                let attack = min(1, t / 0.003)
                let glide = 1 - recipe.glide * exp(-t / 0.012)
                var sample = 0.0
                for (p, partial) in recipe.partials.enumerated() {
                    let freq = note * partial.ratio * glide
                    guard freq < sampleRate / 2 else { continue }
                    phases[p] += 2 * .pi * freq / sampleRate
                    sample += partial.gain * sin(phases[p]) * exp(-t * 1000 / (recipe.decayMs / partial.decay))
                }
                out[i] += Float(sample * attack * level)
            }
        }
        // Normaliza para o pico e fecha com 12 ms de fade: o fim nunca corta no meio de uma onda (estalo).
        let maxAbs = out.map(abs).max() ?? 0
        if maxAbs > 0 { for i in out.indices { out[i] = out[i] / maxAbs * peak } }
        let fade = Int(0.012 * sampleRate)
        for i in 0..<min(fade, count) { out[count - 1 - i] *= Float(i) / Float(fade) }
        return out
    }
}

/// Quem toca o som: o de verdade no helper (`SoundCuePlayer`), um falso nos testes. Nenhum agente toca som.
public protocol CuePlaying: AnyObject {
    func play(_ cue: Cue)
}

/// A ordem do som em volta da gravação (T5833, combinada com a L8 no #5880). O som nunca deve ir para a gravação, e o
/// controle de mídia da L8 mexe no volume global:
/// - **começo:** o som de início, depois baixar ou pausar a mídia (L8), e só então o mic abre;
/// - **fim:** o mic fecha, a mídia volta (L8), e só então o som de fim.
public final class RecordingCues {
    public var enabled: Bool
    private let player: CuePlaying

    public init(player: CuePlaying, enabled: Bool = true) {
        self.player = player
        self.enabled = enabled
    }

    /// `duck`: o gancho da L8 (baixar ou pausar a mídia). `open`: abre o mic; um erro dele passa adiante.
    public func begin(duck: () -> Void = {}, open: () throws -> Void) rethrows {
        if enabled { player.play(.start) }
        duck()
        try open()
    }

    /// Só o som de início, quando quem chama já põe o resto em ordem logo depois (o `startRecording` do helper).
    public func playStart() { if enabled { player.play(.start) } }

    /// Só o som de fim: o mic já fechou e a mídia já voltou.
    public func playEnd() { if enabled { player.play(.end) } }

    /// `close`: fecha o mic. `restore`: o gancho da L8 (a mídia volta).
    public func end(close: () -> Void, restore: () -> Void = {}) {
        close()
        restore()
        if enabled { player.play(.end) }
    }
}

/// O tap do áudio do sistema na reunião (R1) pega tudo o que o Mac toca, então os processos do próprio Kiwi ficam de
/// fora: senão o som de início e de fim iria para o canal "sistema" e para a transcrição (T5833). `translate` é o
/// `kAudioHardwarePropertyTranslatePIDToProcessObject` (0 quando o processo ainda não falou com o áudio).
public enum MeetingTapExclusion {
    public static func processObjects(pids: [Int32], translate: (Int32) -> UInt32) -> [UInt32] {
        var seen = Set<UInt32>()
        return pids.compactMap { pid in
            let object = translate(pid)
            guard object != 0, seen.insert(object).inserted else { return nil }
            return object
        }
    }
}
