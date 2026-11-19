/// O tempo das palavras depois de uma correção do texto (T22375): o banco de reuniões corrige o texto de um pedaço pelo
/// dicionário da pessoa e precisa saber em que tempo, e com isso em que fala, cada palavra corrigida cai.
public enum WordRetiming {
    /// As palavras de `text` com os tempos das de `words` (T22375): a palavra que ficou igual guarda o seu, e as trocadas
    /// entre duas iguais dividem o trecho das que saíram dali. Pelo LCS das palavras sem pontuação e sem caixa.
    public static func retimed(_ words: [(text: String, start: Double, end: Double, firmAt: Double?)], as text: String)
        -> [(text: String, start: Double, end: Double, firmAt: Double?)] {
        let new = text.split(separator: " ").map(String.init)
        let key = { (w: String) in w.lowercased().filter { $0.isLetter || $0.isNumber } }
        let a = words.map { key($0.text) }, b = new.map(key)
        var lcs = Array(repeating: Array(repeating: 0, count: b.count + 1), count: a.count + 1)
        for i in stride(from: a.count - 1, through: 0, by: -1) {
            for j in stride(from: b.count - 1, through: 0, by: -1) {
                lcs[i][j] = a[i] == b[j] ? lcs[i + 1][j + 1] + 1 : max(lcs[i + 1][j], lcs[i][j + 1])
            }
        }
        var out: [(text: String, start: Double, end: Double, firmAt: Double?)] = []
        var i = 0, j = 0, gapI = 0, gapJ = 0
        func flush() {
            // As novas de gapJ..<j ocupam o trecho das antigas de gapI..<i (ou o ponto entre as vizinhas).
            let n = j - gapJ
            guard n > 0 else { return }
            let from = gapI < i ? words[gapI].start : (gapI > 0 ? words[gapI - 1].end : (words.first?.start ?? 0))
            let to = gapI < i ? words[i - 1].end : from
            for k in 0..<n {
                let s = from + (to - from) * Double(k) / Double(n), e = from + (to - from) * Double(k + 1) / Double(n)
                out.append((new[gapJ + k], s, e, nil))
            }
        }
        while i < a.count || j < b.count {
            if i < a.count, j < b.count, a[i] == b[j] {
                flush()
                out.append((new[j], words[i].start, words[i].end, words[i].firmAt))
                i += 1; j += 1; gapI = i; gapJ = j
            } else if j < b.count, i == a.count || lcs[i][j + 1] >= lcs[i + 1][j] {
                j += 1
            } else {
                i += 1
            }
        }
        flush()
        return out
    }

}
