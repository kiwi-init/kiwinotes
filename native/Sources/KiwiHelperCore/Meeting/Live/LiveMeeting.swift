import Foundation

/// A `meeting.segment` (R3, docs/meetings/notes.md): times in seconds since the meeting began, and the frames (16 kHz,
/// the R1 clock) for the ack. Always with `session` and `channel` (#5064). `id` is the place in the channel: the
/// provisional text of the next segment carries the id the final will have, so a UI replaces it.
public struct MeetingSegment: Equatable, Sendable {
    public let session: String
    public let channel: MeetingChannel
    public let index: Int
    public let startFrame: Int
    public let endFrame: Int
    public let speaker: String
    public let text: String
    public let final: Bool

    public var id: String { "\(channel.rawValue)-\(index)" }
    public var start: Double { Double(startFrame) / StreamClock.sampleRate }
    public var end: Double { Double(endFrame) / StreamClock.sampleRate }

    public var fields: [String: Any] {
        ["session": session, "channel": channel.rawValue, "id": id, "start": start, "end": end, "startFrame": startFrame,
         "endFrame": endFrame, "speaker": speaker, "text": text, "final": final]
    }
}

/// The live transcript of one meeting, both channels, without FluidAudio (R3). The helper feeds it the samples (to
/// map the stream clocks), the ASR's token revisions, the diarizer's turns, and the end of each stream; it answers
/// with the events to send:
/// - `segment`: provisional or final text (finals never change again);
/// - `settled`: on that channel, nothing new can come out before this frame, except the finals already sent. With
///   the R4 confirmations, the app acks the spool up to there;
/// - `drained`: the channel's stream ended at this frame (stop or recovery): all its finals are out;
/// - `warning`: once per meeting, the system channel brought only zeros (the permission, #5030).
public struct LiveMeeting: Sendable {
    public enum Event: Equatable, Sendable {
        case segment(MeetingSegment)
        case settled(MeetingChannel, Int)
        case drained(MeetingChannel, Int)
        case warning(String)
    }

    public static let systemSilentWarning = "system_audio_silent"

    public let session: String
    public var dictionary: TranscriptDictionary
    private var segmenters: [MeetingChannel: LiveSegmenter]
    private var clocks: [MeetingChannel: StreamClock] = [.mine: StreamClock(), .system: StreamClock()]
    private var next: [MeetingChannel: Int] = [.mine: 0, .system: 0]
    private var provisional: [MeetingChannel: String] = [:]
    private var settled: [MeetingChannel: Int] = [:]
    private var finished: Set<MeetingChannel> = []
    private var drainedSent: Set<MeetingChannel> = []
    private var names = SpeakerNames()
    private var timeline = SpeakerTimeline()
    private var echo: EchoFilter
    private var silent = SilentChannelDetector()

    /// `output`: `meeting.started.output` (R1). With headphones nothing plays into the mic, and the echo filter is off.
    public init(session: String, output: String, dictionary: TranscriptDictionary = .empty, segmenter: LiveSegmenter.Config = .init()) {
        self.session = session
        self.dictionary = dictionary
        segmenters = [.mine: LiveSegmenter(config: segmenter), .system: LiveSegmenter(config: segmenter)]
        echo = EchoFilter(enabled: output != "headphones")
    }

    /// Samples that went to the channel's ASR (and to the diarizer, for the system channel), with their place on the
    /// meeting clock.
    public mutating func fed(_ channel: MeetingChannel, clockFrame: Int, samples: [Float]) -> [Event] {
        clocks[channel]!.append(clockFrame: clockFrame, count: samples.count)
        guard channel == .system, silent.feed(samples) else { return [] }
        return [.warning(Self.systemSilentWarning)]
    }

    /// The diarizer's timeline now (system stream clock).
    public mutating func speakers(_ turns: [SpeakerTimeline.Turn]) {
        timeline.replace(turns)
    }

    /// One ASR update for the channel.
    public mutating func asr(_ channel: MeetingChannel, retained: Int, added: [LiveToken], stable: Int) -> [Event] {
        let fedUntil = clocks[channel]!.fedSeconds
        let out = segmenters[channel]!.apply(retained: retained, added: added, stable: stable, fedUntil: fedUntil, speakerOf: speakerLookup(channel))
        return finals(channel, out.finals) + provisionalEvent(channel, out.provisional) + progress()
    }

    /// Time passed with no ASR update (quiet audio): a trailing segment can end, and the channel settles further.
    public mutating func tick(_ channel: MeetingChannel) -> [Event] {
        guard !finished.contains(channel) else { return [] }
        let out = segmenters[channel]!.advance(fedUntil: clocks[channel]!.fedSeconds, speakerOf: speakerLookup(channel))
        return finals(channel, out.finals) + provisionalEvent(channel, out.provisional) + progress()
    }

    /// The channel's stream ended: what's left is final, and the channel is drained.
    public mutating func finish(_ channel: MeetingChannel) -> [Event] {
        guard !finished.contains(channel) else { return [] }
        let fedUntil = clocks[channel]!.fedSeconds
        var events = finals(channel, segmenters[channel]!.finish(fedUntil: fedUntil, speakerOf: speakerLookup(channel)))
        provisional[channel] = nil
        finished.insert(channel)
        // With the system stream over, no echo can be matched anymore.
        if finished.contains(.system) { events += echo.release(systemSettled: .max, all: true).map { emitFinal($0) } }
        events += progress()
        // A finished "you" channel with finals still held for the echo check drains when the system channel ends.
        for c in [MeetingChannel.mine, .system] where finished.contains(c) && !drainedSent.contains(c) && (c == .system || echo.heldFrom == nil) {
            drainedSent.insert(c)
            events.append(.drained(c, clocks[c]!.clockFrame(clocks[c]!.fedSeconds)))
        }
        return events
    }

    // MARK: Inside

    private func speakerLookup(_ channel: MeetingChannel) -> (Double, Double) -> Int? {
        guard channel == .system else { return { _, _ in nil } }
        let timeline = self.timeline
        return { timeline.speaker(from: $0, to: $1) }
    }

    private mutating func finals(_ channel: MeetingChannel, _ drafts: [LiveDraft]) -> [Event] {
        var events: [Event] = []
        let clock = clocks[channel]!
        for draft in drafts {
            let text = TranscriptPostProcessor.process(draft.text, dictionary: dictionary)
            guard !text.isEmpty else { continue }
            let speaker = channel == .mine ? SpeakerNames.you : names.name(timeline.speaker(from: draft.start, to: draft.end))
            let segment = LiveSegmentDraft(channel: channel, startFrame: clock.clockFrame(draft.start), endFrame: clock.clockFrame(draft.end),
                                           speaker: speaker, text: text)
            if channel == .mine {
                events += echo.mine(segment).map { emitFinal($0) }
            } else {
                echo.system(segment)
                events.append(emitFinal(segment))
            }
        }
        if channel == .system || clocks[.system]!.fed == 0 {
            let systemSettled = clocks[.system]!.fed == 0 ? Int.max : self.systemSettled()
            events += echo.release(systemSettled: systemSettled).map { emitFinal($0) }
        }
        return events
    }

    private mutating func emitFinal(_ s: LiveSegmentDraft) -> Event {
        let index = next[s.channel]!
        next[s.channel] = index + 1
        if provisional[s.channel] != nil { provisional[s.channel] = nil }
        return .segment(MeetingSegment(session: session, channel: s.channel, index: index, startFrame: s.startFrame, endFrame: s.endFrame,
                                       speaker: s.speaker, text: s.text, final: true))
    }

    private mutating func provisionalEvent(_ channel: MeetingChannel, _ draft: LiveDraft?) -> [Event] {
        guard let draft else {
            provisional[channel] = nil
            return []
        }
        let text = draft.text
        guard !text.isEmpty, provisional[channel] != text else { return [] }
        provisional[channel] = text
        let clock = clocks[channel]!
        let speaker = channel == .mine ? SpeakerNames.you : names.name(timeline.speaker(from: draft.start, to: draft.end))
        return [.segment(MeetingSegment(session: session, channel: channel, index: next[channel]!, startFrame: clock.clockFrame(draft.start),
                                        endFrame: clock.clockFrame(draft.end), speaker: speaker, text: text, final: false))]
    }

    private func systemSettled() -> Int {
        let clock = clocks[.system]!
        return clock.clockFrame(segmenters[.system]!.settledUntil(fedUntil: clock.fedSeconds))
    }

    /// The `settled` marks that moved forward.
    private mutating func progress() -> [Event] {
        var events: [Event] = []
        for channel in [MeetingChannel.mine, .system] {
            let clock = clocks[channel]!
            guard clock.fed > 0 else { continue }
            var frame = finished.contains(channel)
                ? clock.clockFrame(clock.fedSeconds)
                : clock.clockFrame(segmenters[channel]!.settledUntil(fedUntil: clock.fedSeconds))
            if channel == .mine, let held = echo.heldFrom { frame = min(frame, held) }
            if frame > settled[channel] ?? 0 {
                settled[channel] = frame
                events.append(.settled(channel, frame))
            }
        }
        return events
    }
}
