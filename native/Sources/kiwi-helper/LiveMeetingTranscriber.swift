import AVFoundation
import FluidAudio
import Foundation
import KiwiHelperCore

/// R3 (T4943, issue #196): the live transcript of a meeting, with FluidAudio. One `SlidingWindowAsrManager` per channel
/// (`.streaming`, Parakeet Ultra) and the Sortformer only on the system channel, as ADR 0009 proposes; the model, the
/// diarizer and the feed step are injectable until the harry's choice. The decisions (what is final, who spoke, the
/// echo, the settled marks) are `LiveMeeting`'s, in `KiwiHelperCore`.
///
/// Fed by R1's `MeetingCapture.onSamples` (any thread; each channel keeps its order through its own stream), and by
/// the recovered chunks after a crash. It sends `meeting.segment`, `meeting.settled`, `meeting.drained` and
/// `meeting.warning`. It never touches the spool: the app acks it once R4 has saved the text (#5061, #5064).
final class LiveMeetingTranscriber: @unchecked Sendable {
    enum DiarizerKind: String { case sortformer, lseend, none }

    struct Options {
        var asr: SlidingWindowAsrConfig = .streaming
        var diarizer: DiarizerKind = .sortformer
        /// How often the quiet channels are re-checked (a segment ends after enough silence).
        var tick: TimeInterval = 1
        /// Option B of #5131: the VBx over the whole system channel at the end corrects the speakers.
        var vbx = true

        /// `KIWI_MEETING_DIARIZER=sortformer|lseend|none` until ADR 0009 is decided.
        static func fromEnvironment() -> Options {
            var o = Options()
            if let name = ProcessInfo.processInfo.environment["KIWI_MEETING_DIARIZER"], let kind = DiarizerKind(rawValue: name) { o.diarizer = kind }
            if ProcessInfo.processInfo.environment["KIWI_MEETING_VBX"] == "off" { o.vbx = false }
            return o
        }
    }

    typealias Emit = @Sendable (String, [String: Any]) -> Void

    private let session: String
    private let options: Options
    private let emit: Emit
    private let core: Core
    /// The system channel's chunks of this meeting, still in the spool (#5131 keeps them until the end).
    private let systemChunks: @Sendable () -> [MeetingChunk]
    private var inputs: [MeetingChannel: AsyncStream<(Int, [Float])>.Continuation] = [:]
    private var workers: [Task<Void, Never>] = []
    private var ticker: Task<Void, Never>?

    /// `output`: `meeting.started.output` (headphones turns the echo filter off).
    init(session: String, output: String, dictionary: TranscriptDictionary, options: Options = .fromEnvironment(),
         systemChunks: @escaping @Sendable () -> [MeetingChunk], emit: @escaping Emit) {
        self.systemChunks = systemChunks
        self.session = session
        self.options = options
        self.emit = emit
        core = Core(meeting: LiveMeeting(session: session, output: output, dictionary: dictionary), emit: emit)
        for channel in MeetingChannel.allCases {
            let (stream, continuation) = AsyncStream<(Int, [Float])>.makeStream(bufferingPolicy: .unbounded)
            inputs[channel] = continuation
            workers.append(Task { [core, options] in await Self.run(channel, input: stream, core: core, options: options) })
        }
        let tick = options.tick
        ticker = Task { [core] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(tick * 1e9))
                await core.tick()
            }
        }
    }

    /// Samples from the capture (or the recovery), with their place on the meeting clock. Any thread.
    func feed(_ channel: MeetingChannel, startFrame: Int, samples: [Float]) {
        inputs[channel]?.yield((startFrame, samples))
    }

    func setDictionary(_ dictionary: TranscriptDictionary) {
        Task { [core] in await core.setDictionary(dictionary) }
    }

    /// The capture stopped: drain both streams, then the last finals and `meeting.drained` go out.
    func finish() async {
        for continuation in inputs.values { continuation.finish() }
        inputs = [:]
        for worker in workers { await worker.value }
        ticker?.cancel()
        let (finals, drainedSystem) = await core.finishAll()
        // The speakers corrected over the whole system channel, after the ASR is done (it peaks at ~1 GB, ADR 0009).
        if options.vbx, let drainedSystem, !finals.isEmpty {
            do {
                let audio = try Self.audio(systemChunks())
                if !audio.isEmpty {
                    let manager = OfflineDiarizerManager(config: .default)
                    try await manager.prepareModels()
                    let result = try await manager.process(audio: audio)
                    var ids: [String: Int] = [:]
                    let turns = result.segments.map { s -> SpeakerTimeline.Turn in
                        let id = ids[s.speakerId] ?? ids.count
                        ids[s.speakerId] = id
                        return SpeakerTimeline.Turn(speaker: id, start: Double(s.startTimeSeconds), end: Double(s.endTimeSeconds))
                    }
                    let changes = SpeakerRelabel.plan(finals: finals, vbx: turns)
                    emit("log", ["level": "info", "message": "meeting: vbx found \(ids.count) speakers, \(changes.count) segments relabeled"])
                    if !changes.isEmpty { emit("meeting.relabel", ["session": session, "changes": changes.map(\.fields)]) }
                }
            } catch {
                // Without the correction the live labels stay, and the audio goes as usual.
                emit("log", ["level": "warn", "message": "meeting: vbx failed: \(error)"])
            }
        }
        if let drainedSystem { emit("meeting.drained", ["session": session, "channel": "system", "frame": drainedSystem]) }
    }

    /// The system channel on the meeting clock, from its chunks (zeros where nothing came).
    static func audio(_ chunks: [MeetingChunk]) throws -> [Float] {
        let sorted = chunks.filter { $0.channel == .system }.sorted { $0.startFrame < $1.startFrame }
        guard let last = sorted.last else { return [] }
        var out = [Float](repeating: 0, count: last.startFrame + last.frames)
        for chunk in sorted {
            let data = try Data(contentsOf: chunk.url)
            let count = min(data.count / 4, out.count - chunk.startFrame)
            data.withUnsafeBytes { raw in
                for i in 0..<count {
                    out[chunk.startFrame + i] = Float(bitPattern: UInt32(littleEndian: raw.loadUnaligned(fromByteOffset: i * 4, as: UInt32.self)))
                }
            }
        }
        return out
    }

    // MARK: One channel

    private static func run(_ channel: MeetingChannel, input: AsyncStream<(Int, [Float])>, core: Core, options: Options) async {
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: StreamClock.sampleRate, channels: 1, interleaved: false)!
        let asr: SlidingWindowAsrManager
        let updates: Task<Void, Never>
        do {
            asr = SlidingWindowAsrManager(config: options.asr)
            try await asr.loadModels(try await SharedModels.asr())
            // Subscribed before any audio (FluidAudio: one subscriber, before the job takes audio).
            let stream = await asr.tokenUpdates
            try await asr.startStreaming(source: channel == .mine ? .microphone : .system)
            updates = Task {
                do {
                    for try await update in stream {
                        let tokens = update.tokens.map { LiveToken($0.token, start: $0.startTime, end: $0.endTime) }
                        await core.asr(channel, retained: update.revision.retainedTokenCount, added: tokens, stable: update.revision.stableTokenCount)
                    }
                } catch {
                    await core.failed(channel, "asr_stream: \(error)")
                }
            }
        } catch {
            await core.failed(channel, "asr_unavailable: \(error)")
            for await _ in input {} // keep draining so the capture never blocks
            await core.finish(channel)
            return
        }
        let diarizer = channel == .system ? await SharedModels.diarizer(options.diarizer) : nil

        for await (frame, samples) in input {
            guard !samples.isEmpty else { continue }
            await core.fed(channel, frame: frame, samples: samples)
            let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count))!
            buffer.frameLength = AVAudioFrameCount(samples.count)
            samples.withUnsafeBufferPointer { buffer.floatChannelData![0].update(from: $0.baseAddress!, count: samples.count) }
            await asr.streamAudio(buffer)
            if let diarizer {
                do {
                    if try diarizer.process(samples: samples, sourceSampleRate: nil) != nil {
                        await core.speakers(Self.turns(diarizer.timeline))
                    }
                } catch {
                    await core.failed(channel, "diarizer: \(error)")
                }
            }
        }
        _ = try? await asr.finish()
        await updates.value
        if let diarizer, (try? diarizer.finalizeSession()) != nil { await core.speakers(Self.turns(diarizer.timeline)) }
        await asr.cleanup()
        await core.finish(channel)
    }

    private static func turns(_ timeline: DiarizerTimeline) -> [SpeakerTimeline.Turn] {
        timeline.speakers.values.flatMap { speaker in
            (speaker.finalizedSegments + speaker.tentativeSegments).map {
                SpeakerTimeline.Turn(speaker: speaker.index, start: Double($0.startTime), end: Double($0.endTime))
            }
        }
    }

    // MARK: The state, one at a time

    private actor Core {
        private var meeting: LiveMeeting
        private let emit: Emit
        private var finished: Set<MeetingChannel> = []
        /// A channel whose ASR failed never says `settled` or `drained`: its audio stays in the spool for the recovery.
        private var failedChannels: Set<MeetingChannel> = []

        init(meeting: LiveMeeting, emit: @escaping Emit) {
            self.meeting = meeting
            self.emit = emit
        }

        func setDictionary(_ dictionary: TranscriptDictionary) { meeting.dictionary = dictionary }
        func fed(_ channel: MeetingChannel, frame: Int, samples: [Float]) { send(meeting.fed(channel, clockFrame: frame, samples: samples)) }
        func speakers(_ turns: [SpeakerTimeline.Turn]) { meeting.speakers(turns) }

        func asr(_ channel: MeetingChannel, retained: Int, added: [LiveToken], stable: Int) {
            send(meeting.asr(channel, retained: retained, added: added, stable: stable))
        }

        func tick() {
            for channel in MeetingChannel.allCases where !finished.contains(channel) { send(meeting.tick(channel)) }
        }

        /// The system channel ends first, so the "you" finals held for the echo check are decided against all of it.
        func finish(_ channel: MeetingChannel) {
            finished.insert(channel)
        }

        /// The last finals go out; the system channel's `drained` is held for after the VBx correction.
        func finishAll() -> (finals: [MeetingSegment], drainedSystem: Int?) {
            var events = meeting.finish(.system) + meeting.finish(.mine)
            var drainedSystem: Int?
            events.removeAll { event in
                guard case let .drained(.system, frame) = event else { return false }
                drainedSystem = failedChannels.contains(.system) ? nil : frame
                return true
            }
            send(events)
            return (meeting.systemFinals, drainedSystem)
        }

        func failed(_ channel: MeetingChannel, _ message: String) {
            failedChannels.insert(channel)
            emit("log", ["level": "warn", "message": "meeting \(channel.rawValue): \(message)"])
            emit("meeting.warning", ["session": meeting.session, "channel": channel.rawValue, "warning": "transcription_unavailable"])
        }

        private func send(_ events: [LiveMeeting.Event]) {
            for event in events {
                switch event {
                case let .segment(s):
                    emit("meeting.segment", s.fields)
                case let .settled(channel, _) where failedChannels.contains(channel), let .drained(channel, _) where failedChannels.contains(channel):
                    continue
                case let .settled(channel, frame):
                    emit("meeting.settled", ["session": meeting.session, "channel": channel.rawValue, "frame": frame])
                case let .drained(channel, frame):
                    emit("meeting.drained", ["session": meeting.session, "channel": channel.rawValue, "frame": frame])
                case let .warning(warning):
                    emit("meeting.warning", ["session": meeting.session, "channel": "system", "warning": warning])
                }
            }
        }
    }
}

/// The models, loaded once per helper and shared by the meetings (the dictation keeps its own `AsrManager`).
enum SharedModels {
    private actor Store {
        var asr: Task<AsrModels, Error>?
        func asrModels() async throws -> AsrModels {
            if let asr { return try await asr.value }
            let task = Task { try await AsrModels.downloadAndLoad(version: .ultra) }
            asr = task
            do { return try await task.value } catch {
                asr = nil
                throw error
            }
        }
    }

    private static let store = Store()

    static func asr() async throws -> AsrModels { try await store.asrModels() }

    /// A new diarizer for one meeting (its state is the meeting's speakers), or nil when off or unavailable.
    static func diarizer(_ kind: LiveMeetingTranscriber.DiarizerKind) async -> (any Diarizer)? {
        switch kind {
        case .none:
            return nil
        case .sortformer:
            guard let models = try? await SortformerModels.loadFromHuggingFace(config: .default) else { return nil }
            let d = SortformerDiarizer(config: .default)
            d.initialize(models: models)
            return d
        case .lseend:
            return try? await LSEENDDiarizer(variant: .ami)
        }
    }
}

/// The live transcriber of the meeting being recorded, reachable from the capture's threads. The few packets that
/// arrive between the capture starting and `meeting.started` (where the transcriber is made) wait here, so the first
/// words aren't lost.
final class LiveMeetingSlot: @unchecked Sendable {
    private let lock = NSLock()
    private var current: LiveMeetingTranscriber?
    private var early: [(MeetingChannel, Int, [Float])] = []
    private var earlyFrames = 0
    /// At most ~5 s per channel before the transcriber exists.
    private let earlyLimit = 16_000 * 10

    func feed(_ channel: MeetingChannel, startFrame: Int, samples: [Float]) {
        lock.lock()
        defer { lock.unlock() }
        if let current {
            current.feed(channel, startFrame: startFrame, samples: samples)
        } else if earlyFrames + samples.count <= earlyLimit {
            early.append((channel, startFrame, samples))
            earlyFrames += samples.count
        }
    }

    func start(_ transcriber: LiveMeetingTranscriber) {
        lock.lock()
        defer { lock.unlock() }
        current = transcriber
        for (channel, frame, samples) in early { transcriber.feed(channel, startFrame: frame, samples: samples) }
        early = []
        earlyFrames = 0
    }

    /// The meeting stopped: the transcriber leaves the slot (it finishes on its own).
    func take() -> LiveMeetingTranscriber? {
        lock.lock()
        defer { lock.unlock() }
        let t = current
        current = nil
        early = []
        earlyFrames = 0
        return t
    }

    var transcriber: LiveMeetingTranscriber? {
        lock.lock()
        defer { lock.unlock() }
        return current
    }
}

extension LiveMeetingTranscriber {
    /// One chunk's samples (headerless little-endian Float32, R1).
    static func floats(_ chunk: MeetingChunk) throws -> [Float] {
        let data = try Data(contentsOf: chunk.url)
        return data.withUnsafeBytes { raw in
            (0..<(data.count / 4)).map { Float(bitPattern: UInt32(littleEndian: raw.loadUnaligned(fromByteOffset: $0 * 4, as: UInt32.self))) }
        }
    }
}
