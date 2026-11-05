import XCTest
@testable import KiwiHelperCore

/// R3 (#196): the live meeting transcript without FluidAudio. Token revisions, diarizer turns and samples are made up.
final class LiveMeetingTests: XCTestCase {
    let session = "7D1C2C3E-0000-4000-8000-000000000001"

    /// Tokens for words, one token per word, `gap` seconds apart, starting at `from`.
    func tokens(_ text: String, from: Double, word: Double = 0.4, gap: Double = 0.1) -> [LiveToken] {
        var t = from
        return text.split(separator: " ").map { w in
            defer { t += word + gap }
            return LiveToken("▁" + w, start: t, end: t + word)
        }
    }

    func zeros(_ seconds: Double) -> [Float] { Array(repeating: 0, count: Int(seconds * 16_000)) }
    func noise(_ seconds: Double) -> [Float] { Array(repeating: 0.01, count: Int(seconds * 16_000)) }

    func segments(_ events: [LiveMeeting.Event], final: Bool = true) -> [MeetingSegment] {
        events.compactMap { if case let .segment(s) = $0, s.final == final { return s } else { return nil } }
    }

    // MARK: Words and segments

    func testTokensJoinIntoWords() {
        let t = [LiveToken("▁reu", start: 0, end: 0.2), LiveToken("ni", start: 0.2, end: 0.3), LiveToken("ão", start: 0.3, end: 0.5),
                 LiveToken("▁hoje", start: 0.6, end: 0.9)]
        let words = LiveWords.join(t[...], stable: 2)
        XCTAssertEqual(words.map(\.text), ["reunião", "hoje"])
        XCTAssertEqual(words.map(\.firm), [false, false], "a word is firm only when all its tokens are")
        XCTAssertEqual(words[0].end, 0.5)
        XCTAssertEqual(LiveWords.join(t[...], stable: 3).map(\.firm), [true, false])
    }

    /// Only firm words become final; a pause cuts; the rest stays provisional and can still change.
    func testFinalsAtAPauseOverFirmWordsOnly() {
        var s = LiveSegmenter()
        let first = tokens("bom dia pessoal", from: 0)
        let second = tokens("vamos começar", from: 3)
        var out = s.apply(retained: 0, added: first + second, stable: 2, fedUntil: 4)
        XCTAssertEqual(out.finals, [], "\"pessoal\" isn't firm yet")
        XCTAssertEqual(out.provisional?.text, "bom dia pessoal vamos começar")
        out = s.apply(retained: 5, added: [], stable: 4, fedUntil: 4.5)
        XCTAssertEqual(out.finals.map(\.text), ["bom dia pessoal"])
        XCTAssertEqual(out.provisional?.text, "vamos começar")
        // The ASR revises the unstable tail.
        out = s.apply(retained: 3, added: tokens("vamos começar pelo PACS.", from: 3), stable: 3, fedUntil: 6)
        XCTAssertEqual(out.finals, [])
        XCTAssertEqual(out.provisional?.text, "vamos começar pelo PACS.")
    }

    func testTrailingQuietEndsTheLastSegment() {
        var s = LiveSegmenter()
        let t = tokens("certo obrigado", from: 0)
        XCTAssertEqual(s.apply(retained: 0, added: t, stable: 2, fedUntil: 1.5).finals, [])
        XCTAssertEqual(s.advance(fedUntil: 3.2).finals.map(\.text), ["certo obrigado"])
        XCTAssertEqual(s.advance(fedUntil: 10).finals, [], "never twice")
    }

    func testSentenceEndAndLongMonologueCut() {
        var s = LiveSegmenter()
        let t = tokens("fechado. próximo ponto", from: 0)
        XCTAssertEqual(s.apply(retained: 0, added: t, stable: 4, fedUntil: 2).finals.map(\.text), ["fechado."])
        var long = LiveSegmenter()
        let words = Array(repeating: "palavra", count: 60).joined(separator: " ")
        let finals = long.apply(retained: 0, added: tokens(words, from: 0), stable: 60, fedUntil: 33).finals
        XCTAssertGreaterThanOrEqual(finals.count, 2, "\(finals.map { ($0.start, $0.end, $0.words.count) })")
        XCTAssertTrue(finals.allSatisfy { $0.end - $0.start <= 25.5 })
    }

    /// A revision can't take back what was already final.
    func testRevisionNeverUndoesFinals() {
        var s = LiveSegmenter()
        let t = tokens("um dois", from: 0) + tokens("três", from: 2)
        XCTAssertEqual(s.apply(retained: 0, added: t, stable: 3, fedUntil: 3).finals.map(\.text), ["um dois"])
        let out = s.apply(retained: 0, added: tokens("outra coisa", from: 0), stable: 0, fedUntil: 3)
        XCTAssertEqual(out.finals, [])
        XCTAssertEqual(s.consumed, 2)
    }

    func testFinishMakesEverythingFinal() {
        var s = LiveSegmenter()
        _ = s.apply(retained: 0, added: tokens("até amanhã", from: 0), stable: 0, fedUntil: 1)
        XCTAssertEqual(s.finish(fedUntil: 1).map(\.text), ["até amanhã"])
    }

    // MARK: Clocks and speakers

    /// The "you" channel paused 30 s (mute): its stream never saw that gap, the meeting clock did.
    func testStreamClockSkipsThePause() {
        var c = StreamClock()
        c.append(clockFrame: 0, count: 16_000 * 5)
        c.append(clockFrame: 16_000 * 35, count: 16_000 * 5)
        XCTAssertEqual(c.clockFrame(2), 32_000)
        XCTAssertEqual(c.clockFrame(6), 16_000 * 36)
        XCTAssertEqual(c.fedSeconds, 10)
    }

    func testSpeakersByOverlapAndStableNames() {
        var timeline = SpeakerTimeline()
        timeline.replace([.init(speaker: 3, start: 0, end: 4), .init(speaker: 1, start: 4, end: 9)])
        XCTAssertEqual(timeline.speaker(from: 3, to: 6), 1)
        XCTAssertEqual(timeline.speaker(from: 0, to: 3), 3)
        XCTAssertNil(timeline.speaker(from: 20, to: 21))
        var names = SpeakerNames()
        XCTAssertEqual(names.name(3), "Pessoa 1")
        XCTAssertEqual(names.name(1), "Pessoa 2")
        XCTAssertEqual(names.name(3), "Pessoa 1")
    }

    func testSystemSegmentsCutAtASpeakerChange() {
        var m = LiveMeeting(session: session, output: "headphones")
        _ = m.fed(.system, clockFrame: 0, samples: noise(4)) // "ótimo" ends at 2.9 s: not yet 2 s of quiet after it
        m.speakers([.init(speaker: 0, start: 0, end: 1.9), .init(speaker: 1, start: 1.95, end: 4)])
        let events = m.asr(.system, retained: 0, added: tokens("oi tudo bem", from: 0, gap: 0.2) + tokens("tudo ótimo", from: 2), stable: 5)
        XCTAssertEqual(segments(events).map { "\($0.speaker): \($0.text)" }, ["Pessoa 1: oi tudo bem"])
        let end = m.finish(.system)
        XCTAssertEqual(segments(end).map { "\($0.speaker): \($0.text)" }, ["Pessoa 2: tudo ótimo"])
    }

    // MARK: The meeting

    func testYouSegmentsGoOutWithSessionChannelAndFrames() {
        var m = LiveMeeting(session: session, output: "headphones")
        _ = m.fed(.mine, clockFrame: 16_000 * 10, samples: noise(5))
        let events = m.asr(.mine, retained: 0, added: tokens("bom dia", from: 0) + tokens("pessoal", from: 3), stable: 3)
        let s = segments(events)
        XCTAssertEqual(s.count, 1)
        XCTAssertEqual(s[0].fields["session"] as? String, session)
        XCTAssertEqual(s[0].fields["channel"] as? String, "mine")
        XCTAssertEqual(s[0].speaker, "Você")
        XCTAssertEqual(s[0].id, "mine-0")
        XCTAssertEqual(s[0].startFrame, 160_000, "on the meeting clock, not the stream's")
        XCTAssertEqual(s[0].start, 10)
    }

    func testProvisionalCarriesTheIdOfTheNextFinal() {
        var m = LiveMeeting(session: session, output: "headphones")
        _ = m.fed(.mine, clockFrame: 0, samples: noise(2))
        let p = segments(m.asr(.mine, retained: 0, added: tokens("estou falando", from: 0), stable: 0), final: false)
        XCTAssertEqual(p.map(\.id), ["mine-0"])
        XCTAssertEqual(segments(m.asr(.mine, retained: 2, added: [], stable: 0), final: false), [], "the same text doesn't go out twice")
        let f = segments(m.finish(.mine))
        XCTAssertEqual(f.map(\.id), ["mine-0"])
    }

    func testDictionaryAppliesToFinals() {
        var m = LiveMeeting(session: session, output: "headphones", dictionary: TranscriptDictionary([DictionaryEntry(term: "DICOM", aliases: ["dai com"])]))
        _ = m.fed(.mine, clockFrame: 0, samples: noise(3))
        _ = m.asr(.mine, retained: 0, added: tokens("o arquivo dai com chegou", from: 0), stable: 0)
        XCTAssertEqual(segments(m.finish(.mine)).first?.text, "o arquivo DICOM chegou")
    }

    /// #5094: with the speakers on, the system's speech leaks into the mic. The same words at the same time leave the
    /// "you" channel; what only "you" said stays.
    func testEchoLeavesTheYouChannel() {
        var m = LiveMeeting(session: session, output: "speaker")
        _ = m.fed(.mine, clockFrame: 0, samples: noise(20))
        _ = m.fed(.system, clockFrame: 0, samples: noise(20))
        var events = m.asr(.mine, retained: 0, added: tokens("a migração termina sexta", from: 1.1) + tokens("concordo com isso", from: 8), stable: 7)
        XCTAssertEqual(segments(events), [], "the \"you\" finals wait for the system channel")
        events = m.asr(.system, retained: 0, added: tokens("a migração termina na sexta", from: 1) + tokens("próximo", from: 12), stable: 6)
        events += m.tick(.mine)
        events += m.finish(.system) + m.finish(.mine)
        let all = segments(events)
        XCTAssertEqual(all.filter { $0.channel == .mine }.map(\.text), ["concordo com isso"])
        XCTAssertEqual(all.filter { $0.channel == .system }.map(\.text), ["a migração termina na sexta", "próximo"])
        XCTAssertTrue(events.contains(.drained(.mine, 320_000)))
        XCTAssertTrue(events.contains(.drained(.system, 320_000)))
    }

    func testNoEchoFilterWithHeadphones() {
        var m = LiveMeeting(session: session, output: "headphones")
        _ = m.fed(.mine, clockFrame: 0, samples: noise(5))
        _ = m.fed(.system, clockFrame: 0, samples: noise(5))
        var events = m.asr(.system, retained: 0, added: tokens("bom dia", from: 0), stable: 2)
        events += m.asr(.mine, retained: 0, added: tokens("bom dia", from: 0.1), stable: 2)
        events += m.finish(.mine) + m.finish(.system)
        XCTAssertEqual(Set(segments(events).map(\.channel)), [.mine, .system], "with headphones, both stay")
    }

    /// The ack can only pass what is settled: on "you", also nothing still held for the echo check.
    func testSettledMarks() {
        var m = LiveMeeting(session: session, output: "speaker")
        _ = m.fed(.mine, clockFrame: 0, samples: noise(10))
        _ = m.fed(.system, clockFrame: 0, samples: noise(10))
        let events = m.asr(.mine, retained: 0, added: tokens("só eu", from: 1) + tokens("de novo", from: 5), stable: 4)
        let marks = events.compactMap { if case let .settled(c, f) = $0, c == .mine { return f } else { return nil } }
        XCTAssertEqual(marks.last, 16_000, "held from the first \"you\" final, at 1 s")
        XCTAssertTrue(events.contains(.settled(.system, 16_000 * 7)), "quiet system channel: settled up to the look-ahead")
        // The system channel settled past "só eu": the echo check is done, it goes out, and "you" settles up to the next.
        let later = m.tick(.system)
        XCTAssertEqual(segments(later).map(\.text), ["só eu"])
        XCTAssertTrue(later.contains(.settled(.mine, 16_000 * 5)))
    }

    func testSilentSystemChannelWarnsOnce() {
        var m = LiveMeeting(session: session, output: "headphones")
        XCTAssertEqual(m.fed(.system, clockFrame: 0, samples: zeros(9.9)), [])
        XCTAssertEqual(m.fed(.system, clockFrame: 158_400, samples: zeros(0.2)), [.warning("system_audio_silent")])
        XCTAssertEqual(m.fed(.system, clockFrame: 161_600, samples: zeros(20)), [])
        var heard = SilentChannelDetector()
        XCTAssertFalse(heard.feed(noise(1)))
        XCTAssertFalse(heard.feed(zeros(60)), "after real audio, quiet is just quiet")
    }
}
