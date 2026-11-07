// O texto do modo preciso (T6602, ADR 0003): o Whisper small com o dicionário como prompt. Só lógica pura, para o
// `swift test`; quem roda o modelo é o `PreciseTranscriber` do helper.

import Foundation

public enum WhisperPrompt {
    /// O Whisper lê no máximo ~224 tokens de prompt e corta o começo do que passar disso. Com 600 caracteres, um
    /// dicionário grande cabe inteiro até onde dá, e os termos que ficam de fora são os do fim, nunca um pela metade.
    public static let maxCharacters = 600

    /// Os termos separados por vírgula, como o VoiceInk passa ao `LibWhisper` (o formato medido no ADR 0003). `nil` sem
    /// termos: sem prompt, o Whisper transcreve como sempre.
    public static func make(_ terms: [String], limit: Int = maxCharacters) -> String? {
        var prompt = ""
        for term in terms {
            let clean = term.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !clean.isEmpty else { continue }
            let next = prompt.isEmpty ? clean : "\(prompt), \(clean)"
            guard next.count <= limit else { break }
            prompt = next
        }
        return prompt.isEmpty ? nil : prompt
    }

    /// O Whisper às vezes devolve o próprio prompt em vez da fala: num chiado de 4 s, "QIDO, STOW-RS, C-FIND." (o
    /// ADR 0003 viu o mesmo com o turbo, em 2 de 12 clipes). `true` quando todas as palavras do texto são palavras
    /// dos termos: aí o ditado vai pelo Parakeet, que não inventa nada no ruído. Uma fala que é só termos ("DICOM,
    /// PACS") também cai aqui, e sai como sairia sem o modo preciso.
    public static func echoes(_ text: String, terms: [String]) -> Bool {
        let said = words(text)
        guard !said.isEmpty else { return false }
        let prompt = Set(terms.flatMap(words))
        return said.allSatisfy(prompt.contains)
    }

    static func words(_ text: String) -> [String] {
        text.lowercased().split { !$0.isLetter && !$0.isNumber }.map(String.init)
    }
}

/// O Whisper às vezes entra em loop e repete um trecho: na voz do harry, "para o serviço, para o serviço, para o
/// serviço sacado" (1 de 15 gravações, com o turbo). Uma fala de verdade quase nunca repete o mesmo trecho três vezes
/// seguidas; a mesma palavra sozinha, sim ("não, não, não"), então uma palavra só precisa de cinco repetições.
public enum RepetitionGuard {
    static let longestRun = 8

    static func minimumRepeats(words: Int) -> Int { words == 1 ? 5 : 3 }

    /// O texto com cada trecho repetido em loop uma vez só. A pontuação que fica é a da última cópia, que é a que
    /// emenda com o resto da frase.
    public static func collapse(_ text: String) -> String {
        let tokens = text.split(whereSeparator: \.isWhitespace).map(String.init)
        let keys = tokens.map { $0.lowercased().trimmingCharacters(in: .punctuationCharacters) }
        var out: [String] = []
        var i = 0
        while i < tokens.count {
            var collapsed = false
            // O menor trecho primeiro: seis cópias de uma frase também são três cópias de duas.
            for size in stride(from: 1, through: min(longestRun, (tokens.count - i) / 2), by: 1) {
                let run = keys[i..<i + size]
                guard !run.allSatisfy(\.isEmpty) else { continue }
                var copies = 1
                while i + (copies + 1) * size <= tokens.count, keys[i + copies * size..<i + (copies + 1) * size].elementsEqual(run) {
                    copies += 1
                }
                guard copies >= minimumRepeats(words: size) else { continue }
                let lastCopy = i + (copies - 1) * size
                out += tokens[lastCopy..<lastCopy + size]
                i += copies * size
                collapsed = true
                break
            }
            if !collapsed {
                out.append(tokens[i])
                i += 1
            }
        }
        return out.joined(separator: " ")
    }
}

/// Quem transcreve cada ditado no modo preciso. Numa palavra solta, o Whisper small erra a língua e inventa: na voz
/// sintética, "sim" saiu "Thing", "ok" saiu "Key" e "não" saiu "Middle", e o Parakeet acertou os dois primeiros. Com
/// um segundo de fala ou mais, ele empata ou ganha. Então, abaixo de um segundo, o ditado vai pelo Parakeet.
public enum PreciseRoute {
    public static let minimumSpeechSeconds = 1.0
    /// Um quadro de 20 ms abaixo disso (RMS, ~-40 dBFS) é silêncio.
    static let silence: Float = 0.01

    /// Quanto do clipe é fala: do primeiro ao último quadro de 20 ms acima do silêncio.
    public static func speechSeconds(_ samples: [Float], sampleRate: Double = 16_000) -> Double {
        let frame = max(1, Int(sampleRate * 0.02))
        var first: Int?
        var last = 0
        var start = 0
        while start < samples.count {
            let end = min(samples.count, start + frame)
            var sum: Float = 0
            for i in start..<end { sum += samples[i] * samples[i] }
            if (sum / Float(end - start)).squareRoot() >= silence {
                if first == nil { first = start }
                last = end
            }
            start = end
        }
        guard let first else { return 0 }
        return Double(last - first) / sampleRate
    }

    public static func usesWhisper(_ samples: [Float], sampleRate: Double = 16_000) -> Bool {
        speechSeconds(samples, sampleRate: sampleRate) >= minimumSpeechSeconds
    }
}
