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
        // The aliases are matched by sound too, so a near form of what the person said ("Daikon Stor") still
        // lands on the alias, and the replacement below turns it into the term (T591).
        let aliases = entries.flatMap(\.aliases).filter { seen.insert($0.lowercased()).inserted }
        matcher = PhoneticVocabularyMatcher(vocabulary: terms + aliases, strict: Set(aliases))
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
/// to sound like what replaced it, and may not swallow more words than the replacement has, plus one. Since T1973
/// each swap is judged on its own, and also needs a lead in the CTC score (`minimumMargin`).
/// The phonetic correction still runs on the model's text either way.
public enum VocabularyRescoreGuard {
    /// Below this many words there is too little text to tell a term from noise: no rescoring.
    public static let minimumWords = 4
    /// The largest `VocabularyPhonetics.distance` between a changed stretch and its replacement.
    public static let maximumSoundDistance = 0.5

    /// The smallest lead, in average CTC log-probability per token, a term needs over the words it replaces (T1973).
    /// The CTC model is English, so on Portuguese every word scores low and any term wins by a little: on the
    /// battery's sentences the right swaps won by 0.39, 0.63 and 1.77, and the wrong ones by 0.08 and 0.12.
    public static let minimumMargin = 0.25

    /// One swap the rescorer proposed: the words it replaces, the term, and by how much the term's CTC score beat theirs.
    public struct Swap: Equatable {
        public let from: String, to: String, margin: Double
        public init(from: String, to: String, margin: Double) {
            self.from = from; self.to = to; self.margin = margin
        }
    }

    /// The model's text with only the swaps that pass on their own (T1973). On Portuguese the rescorer makes the
    /// right swap ("Pax" → "PACS") next to a wrong one ("caiu de novo" → "Kiwi Notes") in the same answer, and judging
    /// the whole text threw the right ones away with it. Each swap needs the acoustic margin and to sound like its
    /// stretch. The model splits a term it doesn't know into words ("dicom" → "de condu", "kiwi" → "Q e") and the
    /// rescorer's stretch can miss one of them, so the stretch may take one word on either side when that sounds
    /// closer to the term. Punctuation around the stretch stays.
    public static func apply(original: String, swaps: [Swap]) -> String {
        guard words(original).count >= minimumWords else { return original }
        var tokens = original.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
        var replaced = Set<Int>()
        for swap in swaps where swap.margin >= minimumMargin {
            let removed = words(swap.from), inserted = words(swap.to)
            let keys = tokens.map { words($0) }
            /// The single word of a token no swap has touched yet, or nil.
            func word(_ i: Int) -> String? {
                tokens.indices.contains(i) && !replaced.contains(i) && keys[i].count == 1 ? keys[i][0] : nil
            }
            // The first stretch of the text with these words.
            guard !removed.isEmpty, let start = tokens.indices.first(where: { i in
                (0..<removed.count).allSatisfy { word(i + $0) == removed[$0] }
            }) else { continue }
            let end = start + removed.count - 1
            // The stretch itself, or with one more word before or after it: the one that sounds closest.
            var best: (start: Int, end: Int, distance: Double)?
            for (s, e) in [(start, end), (start - 1, end), (start, end + 1)] {
                let stretch = (s...e).compactMap(word)
                guard stretch.count == e - s + 1, opensAlike(stretch, inserted),
                      let d = soundDistance(stretch, inserted) else { continue }
                if best == nil || d < best!.distance { best = (s, e, d) }
            }
            guard let best else { continue }
            let lead = String(tokens[best.start].prefix { !$0.isLetter && !$0.isNumber })
            let trail = String(tokens[best.end].reversed().prefix { !$0.isLetter && !$0.isNumber }.reversed())
            let term = swap.to.trimmingCharacters(in: .whitespacesAndNewlines.union(.punctuationCharacters))
            tokens.replaceSubrange(best.start...best.end, with: [lead + term + trail])
            // The indices after the swap moved by the words it took away.
            let shift = best.end - best.start
            replaced = Set(replaced.map { $0 > best.end ? $0 - shift : $0 })
            replaced.insert(best.start)
        }
        return tokens.joined(separator: " ")
    }

    /// The stretch opens with the term's letter, or both open with the K sound (c, k, q): the matcher's conservative
    /// rule. The sound key doesn't tell b from p or g from k, so without it "bags" became "PACS" (T1973, #2097).
    static func opensAlike(_ removed: [String], _ inserted: [String]) -> Bool {
        guard let a = removed.first?.first, let b = inserted.first?.first else { return false }
        return a == b || (VocabularyPhonetics.phraseKey(removed).first == "K" && VocabularyPhonetics.phraseKey(inserted).first == "K")
    }

    /// The `VocabularyPhonetics.distance` between the stretch and its replacement, or nil when they may not swap.
    static func soundDistance(_ removed: [String], _ inserted: [String]) -> Double? {
        guard !removed.isEmpty, !inserted.isEmpty, removed.count <= inserted.count + 1 else { return nil }
        let a = VocabularyPhonetics.phraseKey(removed), b = VocabularyPhonetics.phraseKey(inserted)
        // Words with accents or digits have no sound key: nothing to compare, so no swap.
        guard !a.isEmpty, !b.isEmpty else { return nil }
        let d = VocabularyPhonetics.distance(a, b)
        return d <= maximumSoundDistance ? d : nil
    }

    static func words(_ text: String) -> [String] {
        text.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init)
    }
}
