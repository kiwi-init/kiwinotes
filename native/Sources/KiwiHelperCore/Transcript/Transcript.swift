import Foundation
import NaturalLanguage

/// One entry of `config.set {dictionary}`: a bare string ("DICOM") or T57's `{term, aliases}`
/// ("kubectl", aliases ["cube control"]).
public struct DictionaryEntry: Equatable, Sendable {
    public let term: String
    public let aliases: [String]

    public init(term: String, aliases: [String] = []) {
        self.term = term
        self.aliases = aliases
    }

    /// nil when `value` isn't a list; entries that aren't a string or `{term}` are skipped.
    public static func parse(_ value: Any?) -> [DictionaryEntry]? {
        guard let list = value as? [Any] else { return nil }
        return list.compactMap { item in
            if let term = item as? String {
                let trimmed = term.trimmingCharacters(in: .whitespacesAndNewlines)
                return trimmed.isEmpty ? nil : DictionaryEntry(term: trimmed)
            }
            guard let object = item as? [String: Any],
                  let term = (object["term"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !term.isEmpty else { return nil }
            let aliases = (object["aliases"] as? [Any] ?? []).compactMap { ($0 as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) }
            return DictionaryEntry(term: term, aliases: aliases.filter { !$0.isEmpty })
        }
    }
}

/// The dictionary as the transcript needs it, prepared once per `config.set` (the matcher indexes the terms).
public struct TranscriptDictionary: Sendable {
    /// The right spellings: CTC vocabulary boosting in the model, then the phonetic correction.
    public let terms: [String]
    let matcher: PhoneticVocabularyMatcher
    let replacements: WordReplacements

    public static let empty = TranscriptDictionary([])

    public init(_ entries: [DictionaryEntry]) {
        var seen = Set<String>()
        terms = entries.map(\.term).filter { seen.insert($0.lowercased()).inserted }
        matcher = PhoneticVocabularyMatcher(vocabulary: terms)
        replacements = WordReplacements(entries.filter { !$0.aliases.isEmpty }.map {
            WordReplacements.Rule(original: $0.aliases.joined(separator: ", "), replacement: $0.term)
        })
    }
}

/// What happens to the model's text before `transcript.final`, in VoiceInk's order
/// (`TranscriptionPipeline` @ 19546d2): filter → vocabulary correction → word replacement.
/// VoiceInk's paragraph formatting and AI enhancement are the cleanup's job here (T52).
public enum TranscriptPostProcessor {
    public static func process(_ raw: String, dictionary: TranscriptDictionary, fillerWords: [String] = []) -> String {
        var text = TranscriptionOutputFilter.filter(raw, fillerWords: fillerWords)
        text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return "" }
        text = dictionary.matcher.correct(text)
        return dictionary.replacements.apply(to: text)
    }
}

/// `transcript.final.lang`: the model doesn't say which language it heard, so it comes from the text
/// (`NLLanguageRecognizer`, on device; ADR 0003).
public enum SpokenLanguage {
    /// Below this, the second language is noise; at or above it, the sentence mixes both.
    public static let mixShare = 0.2

    /// Fewer words than this can't be told apart ("ok"): the likelier language wins, never "mix".
    public static let mixMinimumWords = 4

    /// "pt", "en", "mix" or "" (no text).
    public static func detect(_ text: String) -> String {
        guard text.contains(where: \.isLetter) else { return "" }
        let words = text.split(whereSeparator: { !$0.isLetter }).count
        let recognizer = NLLanguageRecognizer()
        recognizer.languageConstraints = [.portuguese, .english]
        recognizer.processString(text)
        let hypotheses = recognizer.languageHypotheses(withMaximum: 2)
        let pt = hypotheses[.portuguese] ?? 0, en = hypotheses[.english] ?? 0
        if words >= mixMinimumWords, min(pt, en) >= mixShare { return "mix" }
        return pt >= en ? "pt" : "en"
    }
}

/// The audio the model gets.
public enum STTInput {
    /// Parakeet refuses less than 0.3 s (`ASRConstants.minimumAudioDurationSeconds`).
    public static let minimumSamples = 4_800

    /// A short clip gets silence after it, as VoiceInk does after the VAD; an empty one stays empty.
    public static func padded(_ samples: [Float]) -> [Float] {
        guard !samples.isEmpty, samples.count < minimumSamples else { return samples }
        return samples + [Float](repeating: 0, count: minimumSamples - samples.count)
    }
}

/// `config.set {language}`: the hint VoiceInk passes to Parakeet v3/Ultra. `auto` passes none.
public enum TranscriptionLanguage: String, Sendable {
    case auto, pt, en
}

/// When the CTC vocabulary rescoring may change the model's text. The rescoring sometimes swaps real words for
/// dictionary terms: background speech became a term (T256), and in review "cluster de homologação" became
/// "DICOM" and "cubectuget" became "PACS" in a clearly spoken sentence (#335). So every stretch it changes has
/// to sound like what replaced it, and may not swallow more words than the replacement has, plus one.
/// The phonetic correction still runs on the model's text either way.
public enum VocabularyRescoreGuard {
    /// Below this many words there is too little text to tell a term from noise: no rescoring.
    public static let minimumWords = 4
    /// The largest `VocabularyPhonetics.distance` between a changed stretch and its replacement.
    public static let maximumSoundDistance = 0.5

    public static func accept(original: String, rescored: String) -> Bool {
        let before = words(original), after = words(rescored)
        guard before.count >= minimumWords else { return false }
        return changes(before, after).allSatisfy { removed, inserted in
            guard !removed.isEmpty, !inserted.isEmpty, removed.count <= inserted.count + 1 else { return false }
            let a = VocabularyPhonetics.phraseKey(removed), b = VocabularyPhonetics.phraseKey(inserted)
            // Words with accents or digits have no sound key: nothing to compare, so no swap.
            guard !a.isEmpty, !b.isEmpty else { return false }
            return VocabularyPhonetics.distance(a, b) <= maximumSoundDistance
        }
    }

    static func words(_ text: String) -> [String] {
        text.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init)
    }

    /// The stretches that differ, as (removed, inserted), from a word-level LCS alignment.
    static func changes(_ a: [String], _ b: [String]) -> [(removed: [String], inserted: [String])] {
        var lcs = [[Int]](repeating: [Int](repeating: 0, count: b.count + 1), count: a.count + 1)
        for i in stride(from: a.count - 1, through: 0, by: -1) {
            for j in stride(from: b.count - 1, through: 0, by: -1) {
                lcs[i][j] = a[i] == b[j] ? lcs[i + 1][j + 1] + 1 : max(lcs[i + 1][j], lcs[i][j + 1])
            }
        }
        var result: [(removed: [String], inserted: [String])] = []
        var removed: [String] = [], inserted: [String] = []
        var i = 0, j = 0
        func flush() {
            if !removed.isEmpty || !inserted.isEmpty { result.append((removed, inserted)) }
            removed = []; inserted = []
        }
        while i < a.count || j < b.count {
            if i < a.count, j < b.count, a[i] == b[j] {
                flush(); i += 1; j += 1
            } else if j < b.count, i == a.count || lcs[i][j + 1] >= lcs[i + 1][j] {
                inserted.append(b[j]); j += 1
            } else {
                removed.append(a[i]); i += 1
            }
        }
        flush()
        return result
    }
}
