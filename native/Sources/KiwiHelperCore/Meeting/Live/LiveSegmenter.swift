import Foundation

// R3 (T4943, issue #196): the live meeting transcript, without FluidAudio. The streaming ASR (one per channel) hands
// over token revisions; this turns them into segments that are provisional (can still change) or final (never
// change again), on the meeting's common clock. Pure, for `swift test` with made-up token revisions.

/// One ASR token, on the ASR stream's own clock (seconds since the first sample fed to it). SentencePiece: "▁" (or a
/// space) opens a word.
public struct LiveToken: Equatable, Sendable {
    public let text: String
    public let start: Double
    public let end: Double

    public init(_ text: String, start: Double, end: Double) {
        self.text = text
        self.start = start
        self.end = end
    }
}

/// A word made of tokens, on the stream clock.
public struct LiveWord: Equatable, Sendable {
    public var text: String
    public var start: Double
    public var end: Double
    /// All its tokens are stable: the ASR won't revise it.
    public var firm: Bool
    /// How many tokens it took.
    public var tokens: Int
}

public enum LiveWords {
    public static let punctuationSlack = 0.2
    public static let maxWord = 2.0

    /// Joins tokens into words, like the R0 bench (`MeetingBench.words`). `stable`: the first `stable` tokens of the
    /// slice are firm.
    public static func join(_ tokens: ArraySlice<LiveToken>, stable: Int) -> [LiveWord] {
        var out: [LiveWord] = []
        for (i, t) in zip(tokens.indices, tokens) {
            let opens = t.text.hasPrefix("▁") || t.text.hasPrefix(" ") || out.isEmpty
            let clean = t.text.replacingOccurrences(of: "▁", with: "").trimmingCharacters(in: .whitespaces)
            let firm = i - tokens.startIndex < stable // `stable` counts from the start of the slice
            // The decoder gives a sentence's last token (often just ".") a duration that runs into the silence after it:
            // that made a finished sentence look like it overlapped the next speaker (R3 measure, the echo filter).
            // A punctuation token adds at most `punctuationSlack`, and no word lasts more than `maxWord`.
            let punctuation = !clean.isEmpty && clean.unicodeScalars.allSatisfy { CharacterSet.punctuationCharacters.contains($0) }
            if opens {
                out.append(LiveWord(text: clean, start: t.start, end: min(t.end, t.start + maxWord), firm: firm, tokens: 1))
            } else {
                let previous = out[out.count - 1].end
                let end = punctuation ? min(t.end, previous + punctuationSlack) : t.end
                out[out.count - 1].text += clean
                out[out.count - 1].end = min(max(previous, end), out[out.count - 1].start + maxWord)
                out[out.count - 1].firm = out[out.count - 1].firm && firm
                out[out.count - 1].tokens += 1
            }
        }
        return out
    }
}

/// A run of words the segmenter cut, on the stream clock.
public struct LiveDraft: Equatable, Sendable {
    public let words: [LiveWord]
    public var text: String { words.map(\.text).filter { !$0.isEmpty }.joined(separator: " ") }
    public var start: Double { words.first?.start ?? 0 }
    public var end: Double { words.last?.end ?? 0 }
}

/// Cuts one channel's token revisions into final segments: at a pause, at the end of a sentence, at a speaker change
/// (the "system" channel) or when a segment gets too long, and only over words the ASR has made firm. What's left is
/// the provisional tail.
public struct LiveSegmenter: Sendable {
    public struct Config: Equatable, Sendable {
        /// A gap this long between two words ends a segment.
        public var pause: Double = 0.8
        /// After the last firm word, this much fed audio with nothing new ends the segment too (speech, then quiet).
        public var trailingSilence: Double = 2.0
        /// A segment never gets longer than this (a monologue still reaches the note).
        public var maxDuration: Double = 25
        public init() {}
    }

    public var config: Config
    /// The current token list, after the ASR's revisions.
    private var tokens: [LiveToken] = []
    /// Tokens already turned into final segments. They are stable, so the ASR never revises them again.
    public private(set) var consumed = 0
    private var stable = 0

    public init(config: Config = Config()) {
        self.config = config
    }

    /// One ASR update: keep the first `retained` tokens, append `added`; the first `stable` tokens are firm.
    /// `fedUntil`: how much audio the ASR has seen (stream seconds). `speakerOf`: the speaker of a stretch of time
    /// (nil: unknown, or the "you" channel).
    public mutating func apply(retained: Int, added: [LiveToken], stable: Int, fedUntil: Double,
                               speakerOf: (Double, Double) -> Int? = { _, _ in nil }) -> (finals: [LiveDraft], provisional: LiveDraft?) {
        // A revision never takes back a stable token; if one claims to, keep what was already final.
        tokens = Array(tokens.prefix(max(retained, consumed))) + added
        self.stable = max(min(stable, tokens.count), consumed)
        return cut(fedUntil: fedUntil, final: false, speakerOf: speakerOf)
    }

    /// More audio went by with no new tokens: a trailing segment can end after enough quiet.
    public mutating func advance(fedUntil: Double, speakerOf: (Double, Double) -> Int? = { _, _ in nil }) -> (finals: [LiveDraft], provisional: LiveDraft?) {
        cut(fedUntil: fedUntil, final: false, speakerOf: speakerOf)
    }

    /// The stream ended (stop, or the end of a recovered file): everything left is final.
    public mutating func finish(fedUntil: Double, speakerOf: (Double, Double) -> Int? = { _, _ in nil }) -> [LiveDraft] {
        stable = tokens.count
        return cut(fedUntil: fedUntil, final: true, speakerOf: speakerOf).finals
    }

    /// The stream time before which nothing new can come out of this channel: the start of the provisional tail, or
    /// (with no tail) the audio fed so far minus the ASR's look-ahead.
    public func settledUntil(fedUntil: Double, lookAhead: Double = 3) -> Double {
        let rest = LiveWords.join(tokens[consumed...], stable: stable - consumed).filter { !$0.text.isEmpty }
        if let first = rest.first { return first.start }
        return max(0, fedUntil - lookAhead)
    }

    private mutating func cut(fedUntil: Double, final: Bool, speakerOf: (Double, Double) -> Int?) -> (finals: [LiveDraft], provisional: LiveDraft?) {
        var finals: [LiveDraft] = []
        while true {
            let words = LiveWords.join(tokens[consumed...], stable: stable - consumed)
            guard let n = cutPoint(words, fedUntil: fedUntil, final: final, speakerOf: speakerOf) else {
                let rest = words.filter { !$0.text.isEmpty }
                return (finals, rest.isEmpty ? nil : LiveDraft(words: rest))
            }
            let taken = Array(words.prefix(n))
            consumed += taken.reduce(0) { $0 + $1.tokens }
            let spoken = taken.filter { !$0.text.isEmpty }
            if !spoken.isEmpty { finals.append(LiveDraft(words: spoken)) }
        }
    }

    /// How many words (from the start) make the next final segment, or nil when it isn't decided yet.
    private func cutPoint(_ words: [LiveWord], fedUntil: Double, final: Bool, speakerOf: (Double, Double) -> Int?) -> Int? {
        guard !words.isEmpty else { return nil }
        let first = words[0]
        for i in words.indices {
            let w = words[i]
            guard w.firm || final else { return nil }
            if i + 1 < words.count {
                let next = words[i + 1]
                let sentence = w.text.last.map { ".?!…".contains($0) } ?? false
                let speakers = (speakerOf(w.start, w.end), speakerOf(next.start, next.end))
                let changed = speakers.0 != nil && speakers.1 != nil && speakers.0 != speakers.1
                if next.start - w.end >= config.pause || sentence || changed || w.end - first.start >= config.maxDuration {
                    return i + 1
                }
            } else {
                // The last word known: final at the end of the stream, or after enough quiet with nothing new.
                if final || fedUntil - w.end >= config.trailingSilence { return i + 1 }
                if w.end - first.start >= config.maxDuration { return i + 1 }
            }
        }
        return nil
    }
}

/// The ASR stream only sees the audio fed to it: a paused "you" channel (mute) leaves a gap on the meeting clock that
/// the stream never sees. This maps stream time back to the meeting clock (frames at 16 kHz).
public struct StreamClock: Sendable {
    public static let sampleRate = 16_000.0
    private struct Piece: Sendable { let stream: Int; let clock: Int; let count: Int }
    private var pieces: [Piece] = []
    public private(set) var fed = 0

    public init() {}

    /// `count` samples fed to the stream, which started at `clockFrame` on the meeting clock.
    public mutating func append(clockFrame: Int, count: Int) {
        guard count > 0 else { return }
        if let last = pieces.last, last.clock + last.count == clockFrame, last.stream + last.count == fed {
            pieces[pieces.count - 1] = Piece(stream: last.stream, clock: last.clock, count: last.count + count)
        } else {
            pieces.append(Piece(stream: fed, clock: clockFrame, count: count))
        }
        fed += count
    }

    public var fedSeconds: Double { Double(fed) / Self.sampleRate }

    /// The meeting-clock frame of a stream time.
    public func clockFrame(_ streamSeconds: Double) -> Int {
        let s = Int((max(0, streamSeconds) * Self.sampleRate).rounded())
        guard let piece = pieces.last(where: { $0.stream <= s }) ?? pieces.first else { return s }
        return piece.clock + min(max(0, s - piece.stream), piece.count)
    }
}

/// "Você" for the mic; "Pessoa 1, 2…" for the diarizer's speakers on the system channel, numbered in the order they
/// first talk, and stable for the whole meeting.
public struct SpeakerNames: Sendable {
    public static let you = "Você"
    public static let unknown = "Pessoa"
    private var names: [Int: String] = [:]

    public init() {}

    public mutating func name(_ speaker: Int?) -> String {
        guard let speaker else { return names.isEmpty ? "Pessoa 1" : Self.unknown }
        if let known = names[speaker] { return known }
        let name = "Pessoa \(names.count + 1)"
        names[speaker] = name
        return name
    }
}

/// The diarizer's speaker turns, on the system stream clock. A stretch of time gets the speaker who overlaps it most.
public struct SpeakerTimeline: Sendable {
    public struct Turn: Equatable, Sendable {
        public let speaker: Int
        public let start: Double
        public let end: Double
        public init(speaker: Int, start: Double, end: Double) {
            self.speaker = speaker
            self.start = start
            self.end = end
        }
    }

    public private(set) var turns: [Turn] = []

    public init() {}

    /// The whole timeline as the diarizer has it now (it can revise the recent part).
    public mutating func replace(_ turns: [Turn]) {
        self.turns = turns.filter { $0.end > $0.start }.sorted { $0.start < $1.start }
    }

    public func speaker(from start: Double, to end: Double) -> Int? {
        var overlap: [Int: Double] = [:]
        let a = start, b = max(end, start + 0.01)
        for t in turns where t.end > a && t.start < b {
            overlap[t.speaker, default: 0] += min(b, t.end) - max(a, t.start)
        }
        return overlap.max { $0.value < $1.value || ($0.value == $1.value && $0.key > $1.key) }?.key
    }
}

/// The same speech in both channels at the same time is echo (the speakers playing into the mic): it leaves the "you"
/// channel. A "you" final waits until the system channel has settled past it, then goes out only if no system final
/// overlapping it says the same words.
public struct EchoFilter: Sendable {
    public struct Config: Equatable, Sendable {
        /// How far apart in time the two can be (the echo arrives a little late, and the segments are cut differently).
        public var slack: Double = 1.5
        /// The share of the "you" words that must also be in the system segments.
        public var similarity: Double = 0.5
        /// How much of the "you" segment's time the system speech must cover (echo arrives at the same time).
        public var coverage: Double = 0.5
        /// The tolerance on each side of a system segment for that coverage (the echo's delay, different cuts).
        public var timePad: Double = 0.3
        public init() {}
    }

    public var config: Config
    /// Off with headphones: nothing plays into the mic.
    public var enabled: Bool
    private var held: [LiveSegmentDraft] = []
    private var system: [LiveSegmentDraft] = []

    public init(enabled: Bool, config: Config = Config()) {
        self.enabled = enabled
        self.config = config
    }

    /// The earliest held "you" final, which the ack of the "you" channel can't pass yet.
    public var heldFrom: Int? { held.map(\.startFrame).min() }

    public mutating func system(_ segment: LiveSegmentDraft) {
        guard enabled else { return }
        system.append(segment)
    }

    /// A "you" final: out now (filter off), or held until `release`.
    public mutating func mine(_ segment: LiveSegmentDraft) -> [LiveSegmentDraft] {
        guard enabled else { return [segment] }
        held.append(segment)
        return []
    }

    /// The system channel has settled up to `systemSettled` (a frame): the held "you" finals that end well before it
    /// are decided. `all`: the meeting is over, decide them all.
    public mutating func release(systemSettled: Int, all: Bool = false) -> [LiveSegmentDraft] {
        let slack = Int(config.slack * StreamClock.sampleRate)
        var out: [LiveSegmentDraft] = []
        var keep: [LiveSegmentDraft] = []
        for s in held {
            guard all || s.endFrame + slack <= systemSettled else {
                keep.append(s)
                continue
            }
            if !isEcho(s) { out.append(s) }
        }
        held = keep
        // What no held segment can match anymore.
        let horizon = (held.map(\.startFrame).min() ?? systemSettled) - 4 * slack
        system.removeAll { $0.endFrame < horizon }
        return out
    }

    func isEcho(_ s: LiveSegmentDraft) -> Bool {
        let slack = Int(config.slack * StreamClock.sampleRate)
        let near = system.filter { $0.endFrame + slack >= s.startFrame && $0.startFrame - slack <= s.endFrame }
        guard !near.isEmpty else { return false }
        // Echo is the same sound a few ms late: the system speech covers most of the "you" segment. Someone repeating
        // your words a moment later (or talking over you) is not echo (R3 measure: "Bom, e a produção…" was lost).
        let pad = Int(config.timePad * StreamClock.sampleRate)
        let covered = near.reduce(0) { $0 + max(0, min(s.endFrame, $1.endFrame + pad) - max(s.startFrame, $1.startFrame - pad)) }
        guard Double(covered) >= config.coverage * Double(max(1, s.endFrame - s.startFrame)) else { return false }
        // Only content words count (3+ letters): "e", "a", "o" are in every sentence. Two must match, or, for a one-word
        // segment, the system speech must cover nearly all of it (a reply that repeats the question's word isn't echo).
        let mine = EchoFilter.words(s.text).filter { $0.count >= 3 }
        guard !mine.isEmpty else { return Double(covered) >= 0.9 * Double(max(1, s.endFrame - s.startFrame)) }
        let theirs = Set(near.flatMap { EchoFilter.words($0.text) })
        let shared = mine.filter { theirs.contains($0) }.count
        if mine.count == 1 { return shared == 1 && Double(covered) >= 0.9 * Double(max(1, s.endFrame - s.startFrame)) }
        return shared >= 2 && Double(shared) / Double(mine.count) >= config.similarity
    }

    /// Lowercased words without accents or punctuation.
    static func words(_ text: String) -> [String] {
        text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "pt_BR"))
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
    }
}

/// A segment on the meeting clock, before it goes out as `meeting.segment`.
public struct LiveSegmentDraft: Equatable, Sendable {
    public let channel: MeetingChannel
    public var startFrame: Int
    public var endFrame: Int
    public var speaker: String
    public var text: String
    /// The words on the meeting clock (seconds).
    public var words: [(text: String, start: Double, end: Double)] = []

    public static func == (a: LiveSegmentDraft, b: LiveSegmentDraft) -> Bool {
        (a.channel, a.startFrame, a.endFrame, a.speaker, a.text) == (b.channel, b.startFrame, b.endFrame, b.speaker, b.text)
    }

    public init(channel: MeetingChannel, startFrame: Int, endFrame: Int, speaker: String, text: String) {
        self.channel = channel
        self.startFrame = startFrame
        self.endFrame = endFrame
        self.speaker = speaker
        self.text = text
    }
}

/// R1's follow-up (#5030): a denied system-audio tap delivers zeros without an error. When the system channel brings
/// only exact zeros for ~10 s from the start, warn once (the permission is likely off). One real sample, and it never
/// warns for this meeting: a quiet stretch later is just quiet.
public struct SilentChannelDetector: Sendable {
    public let after: Int
    private var zeros = 0
    private var heard = false
    private var warned = false

    public init(seconds: Double = 10) {
        after = Int(seconds * StreamClock.sampleRate)
    }

    /// True once: the moment to warn.
    public mutating func feed(_ samples: [Float]) -> Bool {
        guard !heard, !warned else { return false }
        if samples.contains(where: { $0 != 0 }) {
            heard = true
            return false
        }
        zeros += samples.count
        guard zeros >= after else { return false }
        warned = true
        return true
    }
}
