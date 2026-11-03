import Foundation
import KiwiHelperCore

// stt-bench --report [results-dir]: one table, in ADR 0003's format, of every engine in results-dir, with the
// sidecar's own post-processing (T256) on top of each engine's text: none, the dictionary's terms, and the terms
// plus aliases learned from the training takes. Only numbers come out: on real voice, the transcripts and the
// learned aliases stay in results-voz/ (git-ignored).
//
// Aliases are learned as the person would add them in the dictionary after seeing a mistake (T57): wherever a
// term of vocab.txt is in the reference, the words the engine wrote in its place become an alias of that term.
// They are learned on the training takes and measured on the others:
//   - takes `_r1` and `_r2` (record.sh with KIWI_TAKE=r2): learn on r1, measure on r2;
//   - takes `_v1` and `_v2` (gen-audio.sh): learn on v1, measure on v2;
//   - one take per sentence: learn on the first half of the mixed sentences, measure on the rest (weak: an
//     alias only helps the term it was learned for, and different sentences have different terms).

struct ReportRow: Decodable {
    let id, lang, size, ref, hyp: String
    let latencySeconds: Double
}

struct ReportFile: Decodable {
    let engine: String
    let loadSeconds, peakMB: Double
    let rows: [ReportRow]
}

/// A word as written (for the alias) and as compared (for the alignment).
private struct Token {
    let surface, key: String
}

private func tokens(_ text: String) -> [Token] {
    text.split(whereSeparator: \.isWhitespace).compactMap { piece in
        let surface = String(piece).trimmingCharacters(in: .punctuationCharacters)
        let key = normalize(surface).joined()
        return key.isEmpty ? nil : Token(surface: surface, key: key)
    }
}

/// For each reference token, the hypothesis token it matches exactly in a word-level Levenshtein alignment, or nil.
private func exactMatches(_ ref: [Token], _ hyp: [Token]) -> [Int?] {
    let n = ref.count, m = hyp.count
    var d = [[Int]](repeating: [Int](repeating: 0, count: m + 1), count: n + 1)
    for i in 0...n { d[i][0] = i }
    for j in 0...m { d[0][j] = j }
    if n > 0, m > 0 {
        for i in 1...n {
            for j in 1...m {
                d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1].key == hyp[j - 1].key ? 0 : 1))
            }
        }
    }
    var match = [Int?](repeating: nil, count: n)
    var i = n, j = m
    while i > 0, j > 0 {
        let same = ref[i - 1].key == hyp[j - 1].key
        if d[i][j] == d[i - 1][j - 1] + (same ? 0 : 1) {
            if same { match[i - 1] = j - 1 }
            i -= 1; j -= 1
        } else if d[i][j] == d[i][j - 1] + 1 {
            j -= 1
        } else {
            i -= 1
        }
    }
    return match
}

/// The aliases a person would add after seeing `hyp` for `ref`: term → the words the engine wrote in its place,
/// that is, everything between the nearest words it got right on each side. Longer terms go first, and a term
/// inside a longer one ("DICOM" in "DICOM store") is that one's business.
func learnAliases(ref: String, hyp: String, terms: [String]) -> [(term: String, alias: String)] {
    let r = tokens(ref), h = tokens(hyp)
    let match = exactMatches(r, h)
    var taken = [Bool](repeating: false, count: r.count)
    var found: [(String, String)] = []
    for term in terms.sorted(by: { tokens($0).count > tokens($1).count }) {
        let t = tokens(term).map(\.key)
        guard !t.isEmpty, r.count >= t.count else { continue }
        for start in 0...(r.count - t.count) {
            let end = start + t.count
            guard r[start..<end].map(\.key) == t, !taken[start..<end].contains(true) else { continue }
            for k in start..<end { taken[k] = true }
            // The engine got the term right.
            if match[start..<end].allSatisfy({ $0 != nil }) { continue }
            let left = (0..<start).reversed().lazy.compactMap { match[$0] }.first.map { $0 + 1 } ?? 0
            let right = (end..<r.count).lazy.compactMap { match[$0] }.first ?? h.count
            guard left < right, right - left <= t.count + 4 else { continue }
            let written = h[left..<right]
            // Already right, or too short to be a safe alias ("e", "o").
            guard written.map(\.key) != t, written.map(\.key).joined().count >= 3 else { continue }
            found.append((term, written.map(\.surface).joined(separator: " ")))
        }
    }
    return found
}

func runReport(root: URL, resultsDir: URL) throws {
    let terms = try String(contentsOf: root.appendingPathComponent("vocab.txt"), encoding: .utf8)
        .split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty && !$0.hasPrefix("#") }
    let files = try FileManager.default.contentsOfDirectory(atPath: resultsDir.path)
        .filter { $0.hasSuffix(".json") }.sorted()
    let reports = try files.map { try JSONDecoder().decode(ReportFile.self, from: Data(contentsOf: resultsDir.appendingPathComponent($0))) }
    guard let sample = reports.first else { print("no results in \(resultsDir.path)"); exit(1) }

    // Which takes teach the aliases and which measure them.
    let sentence: (ReportRow) -> String = { String($0.id.split(separator: "_")[0]) }
    let ids = sample.rows.map(\.id)
    let isTraining: (ReportRow) -> Bool
    let measured: (ReportRow) -> Bool
    let split: String
    if let (learn, test) = [("_r1", "_r2"), ("_v1", "_v2")].first(where: { pair in ids.contains { $0.hasSuffix(pair.1) } }) {
        // A sentence with a second take is measured on it; one without (no terms to learn) is measured as it is.
        let twice = Set(sample.rows.filter { $0.id.hasSuffix(test) }.map(sentence))
        isTraining = { $0.id.hasSuffix(learn) }
        measured = { !twice.contains(sentence($0)) || $0.id.hasSuffix(test) }
        split = "aliases learned on take \(learn.dropFirst()), measured on \(test.dropFirst())"
    } else {
        let mixed = Array(Set(sample.rows.filter { $0.lang == "mix" }.map(sentence))).sorted()
        let learn = Set(mixed.prefix(mixed.count / 2))
        isTraining = { learn.contains(sentence($0)) }
        measured = { !learn.contains(sentence($0)) }
        split = "WEAK: one take per sentence; aliases learned on \(learn.sorted().joined(separator: ", ")), measured on the other sentences"
    }

    let termsOnly = TranscriptDictionary(terms.map { DictionaryEntry(term: $0) })
    print("\(split). \(sample.rows.filter(measured).count) of \(sample.rows.count) clips measured.\n")
    print("| motor | pós-processamento | aliases | curta p50 | curta p90 | longa p50 | WER pt | WER en | WER mix | total | load | pico |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for report in reports {
        var aliases: [String: [String]] = [:]
        for row in report.rows where isTraining(row) {
            let seen = TranscriptPostProcessor.process(row.hyp, dictionary: termsOnly)
            for (term, alias) in learnAliases(ref: row.ref, hyp: seen, terms: terms) where !(aliases[term] ?? []).contains(alias) {
                aliases[term, default: []].append(alias)
            }
        }
        if ProcessInfo.processInfo.environment["STT_SHOW_ALIASES"] == "1", !resultsDir.path.contains("voz") {
            // Synthetic audio only: on real voice these are pieces of what the person said.
            for (term, list) in aliases.sorted(by: { $0.key < $1.key }) { print("<!-- \(report.engine): \(term) ← \(list) -->") }
        }
        let withAliases = TranscriptDictionary(terms.map { DictionaryEntry(term: $0, aliases: aliases[$0] ?? []) })
        let short = report.rows.filter { $0.size == "short" }.map(\.latencySeconds)
        let long = report.rows.filter { $0.size == "long" }.map(\.latencySeconds)
        let timing = String(format: "%.2f s | %.2f s | %.2f s", percentile(short, 0.5), percentile(short, 0.9), percentile(long, 0.5))
        let load = String(format: "%.1f s | %.0f MB", report.loadSeconds, report.peakMB)
        let variants: [(String, TranscriptDictionary?, String)] = [
            ("nenhum", nil, "-"),
            ("termos", termsOnly, "-"),
            ("termos + aliases", withAliases, "\(aliases.values.map(\.count).reduce(0, +))"),
        ]
        for (label, dictionary, aliasCount) in variants {
            func wer(_ keep: (ReportRow) -> Bool) -> String {
                let rows = report.rows.filter { measured($0) && keep($0) }
                guard !rows.isEmpty else { return "-" }
                var errors = 0, words = 0
                for row in rows {
                    let text = dictionary.map { TranscriptPostProcessor.process(row.hyp, dictionary: $0) } ?? row.hyp
                    let ref = normalize(row.ref)
                    errors += wordErrors(ref: ref, hyp: normalize(text))
                    words += ref.count
                }
                return String(format: "%.1f%%", Double(errors) / Double(max(1, words)) * 100).replacingOccurrences(of: ".", with: ",")
            }
            print("| \(report.engine) | \(label) | \(aliasCount) | \(timing.replacingOccurrences(of: ".", with: ",")) | \(wer { $0.lang == "pt" }) | \(wer { $0.lang == "en" }) | \(wer { $0.lang == "mix" }) | \(wer { _ in true }) | \(load.replacingOccurrences(of: ".", with: ",")) |")
        }
    }
}
