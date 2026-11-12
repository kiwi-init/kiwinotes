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

    /// A rota com o VAD (T7454): o som acima do silêncio não é fala. Num zumbido ou num bipe, a regra da energia mandava
    /// o clipe ao Whisper, que inventava texto ("Good morning.", "DICOM, Coalition."), e o texto era colado; o Parakeet
    /// devolve vazio no mesmo áudio. Com `vadSpeechSeconds` (a fala que o Silero achou), o Whisper só entra com um
    /// segundo de fala de verdade. Sem o VAD (`nil`: o modelo não carregou), vale a regra da energia, como antes.
    public static func usesWhisper(_ samples: [Float], sampleRate: Double = 16_000, vadSpeechSeconds: Double?) -> Bool {
        guard let vadSpeechSeconds else { return usesWhisper(samples, sampleRate: sampleRate) }
        return vadSpeechSeconds >= minimumSpeechSeconds
    }
}

public extension WhisperPrompt {
    /// O texto começa pelo prompt (#7082): num ditado longo com ruído, o Whisper devolveu "DICOM, PACS, Kiwi Notes" e
    /// só depois a fala. `true` quando o texto é todo eco (`echoes`), ou começa por três ou mais palavras seguidas do
    /// prompt, ou pelo prompt inteiro (de duas palavras para cima). É só uma suspeita: uma fala de verdade também
    /// pode começar por um termo ("Kiwi Notes é um aplicativo"), então quem chama não corta o texto, e sim transcreve
    /// o pedaço de novo sem o prompt.
    static func startsWithEcho(_ text: String, terms: [String]) -> Bool {
        if echoes(text, terms: terms) { return true }
        let prompt = words(make(terms) ?? "")
        let said = words(text)
        guard prompt.count >= 2, let first = said.first else { return false }
        var longest = 0
        for start in prompt.indices where prompt[start] == first {
            var run = 0
            while start + run < prompt.count, run < said.count, prompt[start + run] == said[run] { run += 1 }
            longest = max(longest, run)
        }
        return longest >= 3 || longest == prompt.count
    }
}

/// O ditado longo do modo preciso em pedaços (#7082). O Whisper lê o áudio em blocos de 30 s, e num ditado de mais
/// de 30 s com ruído ele devolveu o prompt (o dicionário) no lugar de um bloco inteiro: de 71 s de fala saíram os
/// últimos 11 s. Cada pedaço de até 28 s cabe num bloco só, e os mesmos pedaços, transcritos sozinhos, saem inteiros.
public enum PreciseChunks {
    /// O maior pedaço: abaixo dos 30 s do bloco do Whisper, com folga.
    public static let maxSeconds = 28.0
    /// O corte fica na segunda metade do pedaço: onde o áudio está mais quieto entre 14 e 28 s.
    static let minSeconds = maxSeconds / 2
    /// O último pedaço nunca fica menor que isto: um resto de meio segundo o Whisper erra (`PreciseRoute`).
    static let minTailSeconds = 2.0
    /// O silêncio procurado: a média de 200 ms.
    static let quietSeconds = 0.2
    static let frameSeconds = 0.02

    /// Os pedaços do ditado, em ordem e sem buraco. Até `maxSeconds`, um só: o ditado inteiro, como sempre foi.
    /// O corte vai no trecho mais quieto, e não abaixo de um limiar fixo: com ruído de fundo, a pausa não é silêncio.
    public static func split(_ samples: [Float], sampleRate: Double = 16_000) -> [Range<Int>] {
        let most = Int(maxSeconds * sampleRate)
        guard samples.count > most else { return [0..<samples.count] }
        let frame = max(1, Int(sampleRate * frameSeconds))
        let energy = frameEnergy(samples, frame: frame)
        // sums[i]: a energia dos quadros antes do i.
        var sums = [Float](repeating: 0, count: energy.count + 1)
        for i in energy.indices { sums[i + 1] = sums[i] + energy[i] }
        let quiet = max(1, Int(quietSeconds / frameSeconds))
        var chunks: [Range<Int>] = []
        var start = 0
        while samples.count - start > most {
            let low = (start + Int(minSeconds * sampleRate)) / frame
            let high = min(start + most, samples.count - Int(minTailSeconds * sampleRate)) / frame
            var cut = high * frame
            if high - quiet >= low {
                var best = Float.infinity
                for at in low...(high - quiet) {
                    let e = sums[at + quiet] - sums[at]
                    // No empate, o mais tarde: menos pedaços.
                    if e <= best {
                        best = e
                        cut = (at + quiet / 2) * frame
                    }
                }
            }
            chunks.append(start..<cut)
            start = cut
        }
        chunks.append(start..<samples.count)
        return chunks
    }

    /// Quanto do pedaço tem voz, em segundos: os quadros de 20 ms acima do silêncio e bem acima do chão de ruído do
    /// próprio pedaço (o décimo percentil). Com chiado de fundo, o silêncio fixo do `PreciseRoute` daria o clipe todo.
    /// Numa fala quase sem pausa, o décimo percentil já é voz: sem contraste entre ele e os quadros mais fortes, vale
    /// só o silêncio fixo.
    public static func voicedSeconds(_ samples: [Float], sampleRate: Double = 16_000) -> Double {
        let frame = max(1, Int(sampleRate * frameSeconds))
        let rms = frameEnergy(samples, frame: frame).map { ($0 / Float(frame)).squareRoot() }.sorted()
        guard !rms.isEmpty else { return 0 }
        let floor = rms[rms.count / 10] * 1.6
        let loud = rms[rms.count * 9 / 10]
        let threshold = loud < floor ? PreciseRoute.silence : max(PreciseRoute.silence, floor)
        return Double(rms.filter { $0 >= threshold }.count) * frameSeconds
    }

    /// Um texto curto demais para a voz do pedaço: menos de 4 caracteres por segundo de voz, com 3 s de voz ou mais.
    /// A fala em português dá de 12 a 15 por segundo; nos ditados em que o bloco sumiu, saíram 2 a 3. Sem texto
    /// nenhum, basta 1 s de voz.
    public static func tooShort(_ text: String, for samples: [Float], sampleRate: Double = 16_000) -> Bool {
        let voiced = voicedSeconds(samples, sampleRate: sampleRate)
        if text.isEmpty { return voiced >= PreciseRoute.minimumSpeechSeconds }
        return voiced >= 3 && Double(text.count) < 4 * voiced
    }

    /// O texto do ditado pelo Whisper, pedaço por pedaço, ou `nil` quando o ditado inteiro deve ir pelo Parakeet.
    ///
    /// Um pedaço só (até 28 s) segue como sempre: o Whisper que falha ou devolve só o prompt manda o ditado ao
    /// Parakeet, e o texto não é mexido. Em vários pedaços, cada um tem a sua guarda: se o texto começa pelo prompt
    /// (`startsWithEcho`), o pedaço vai de novo sem o prompt, e fica esse texto (o que a pessoa disse continua lá,
    /// mesmo que sejam os termos); e o que sai vazio ou curto demais (`tooShort`) é transcrito pelo Parakeet, e fica
    /// o texto mais comprido. Assim nenhum trecho do ditado se perde.
    public static func transcribe(
        _ samples: [Float], terms: [String], sampleRate: Double = 16_000,
        whisper: ([Float], [String]) async throws -> String,
        parakeet: ([Float]) async throws -> String,
        log: (String) -> Void = { _ in }
    ) async -> String? {
        let chunks = split(samples, sampleRate: sampleRate)
        if chunks.count == 1 {
            guard let raw = try? await whisper(samples, terms) else {
                log("precise: whisper failed, this dictation goes through parakeet")
                return nil
            }
            if WhisperPrompt.echoes(raw, terms: terms) {
                log("precise: whisper gave back the prompt, this dictation goes through parakeet")
                return nil
            }
            return raw
        }
        var texts: [String] = []
        for (n, range) in chunks.enumerated() {
            let chunk = Array(samples[range])
            let label = "precise: chunk \(n + 1)/\(chunks.count)"
            var text = ""
            do {
                text = try await whisper(chunk, terms)
                if WhisperPrompt.startsWithEcho(text, terms: terms) {
                    log("\(label): the text starts with the prompt, again without it")
                    text = try await whisper(chunk, [])
                }
            } catch {
                log("\(label): whisper failed")
                text = ""
            }
            if tooShort(text, for: chunk, sampleRate: sampleRate) {
                let other = ((try? await parakeet(chunk)) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                log("\(label): \(text.count) characters from whisper, \(other.count) from parakeet")
                if other.count > text.count { text = other }
            }
            if !text.isEmpty { texts.append(text) }
        }
        return texts.isEmpty ? nil : texts.joined(separator: " ")
    }

    /// A energia (soma dos quadrados) de cada quadro inteiro.
    private static func frameEnergy(_ samples: [Float], frame: Int) -> [Float] {
        var out = [Float](repeating: 0, count: samples.count / frame)
        samples.withUnsafeBufferPointer { s in
            for i in out.indices {
                var sum: Float = 0
                for j in (i * frame)..<((i + 1) * frame) { sum += s[j] * s[j] }
                out[i] = sum
            }
        }
        return out
    }
}
