import Foundation

/// A microphone with its existing watchdog, or a Core Audio system tap. Tests supply two sources with no device.
public protocol MeetingAudioSource: AnyObject {
    func start(onSamples: @escaping ([Float], TimeInterval) -> Void) throws
    func stop()
}

/// Owns two independent 16 kHz mono sources and their spool, never a transcription engine. Start/stop/pause are
/// explicit commands on the main thread. Source callbacks may arrive concurrently, including after a source stops.
public final class MeetingCapture {
    public let root: URL
    public private(set) var session: String?
    public private(set) var minePaused = false
    public var onChunk: ((MeetingChunk) -> Void)?
    /// Live ASR/diarization input, after the same packet has been durably spooled.
    public var onSamples: ((MeetingChannel, Int, [Float]) -> Void)?
    public var onLevel: ((MeetingChannel, Float) -> Void)?
    public var onError: ((String) -> Void)?
    private let mine: MeetingAudioSource
    private let system: MeetingAudioSource
    private let now: () -> TimeInterval
    private let queue = DispatchQueue(label: "kiwi.meeting.spool")
    private var buffer: MeetingBuffer?
    private var startedAt: TimeInterval = 0
    private var generation = 0
    private var mineGeneration = 0
    private var accepting = false
    private var pending: [String: MeetingChunk] = [:]
    private var nextFrame: [MeetingChannel: Int] = [:]
    private var watermarks: [String: [MeetingChannel: Int]] = [:]

    public init(root: URL, mine: MeetingAudioSource, system: MeetingAudioSource,
                now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) throws {
        self.root = root
        self.mine = mine
        self.system = system
        self.now = now
        for chunk in try MeetingBuffer.recover(root: root) { pending[chunk.id] = chunk }
    }

    @discardableResult
    public func start(chunkDuration: Double) throws -> String {
        guard session == nil else { throw MeetingFailure.alreadyRecording }
        let spool = try MeetingBuffer(root: root, chunkDuration: chunkDuration)
        session = spool.session
        minePaused = false
        queue.sync {
            buffer = spool
            nextFrame = [:]
            startedAt = now()
            generation += 1
            mineGeneration += 1
            accepting = true
        }
        let token = generation, mineToken = mineGeneration
        do {
            try system.start { [weak self] samples, time in self?.receive(samples, at: time, channel: .system, token: token, mineToken: 0) }
            try mine.start { [weak self] samples, time in self?.receive(samples, at: time, channel: .mine, token: token, mineToken: mineToken) }
        } catch {
            try? stop()
            throw error
        }
        return spool.session
    }

    /// Seal trailing audio; R3 drains and acknowledges it. Never erase speech just because recording stopped.
    public func stop() throws {
        guard session != nil else { return }
        mine.stop()
        system.stop()
        let chunks = try queue.sync { () throws -> [MeetingChunk] in
            accepting = false
            generation += 1
            let chunks = try buffer?.finish() ?? []
            for chunk in chunks { pending[chunk.id] = chunk }
            try discardAcknowledged()
            buffer = nil
            return chunks.filter { pending[$0.id] != nil }
        }
        session = nil
        minePaused = false
        chunks.forEach { onChunk?($0) }
    }

    public func pauseMine() throws {
        guard session != nil else { throw MeetingFailure.notRecording }
        guard !minePaused else { return }
        queue.sync { mineGeneration += 1 }
        mine.stop()
        minePaused = true
    }

    public func resumeMine() throws {
        guard session != nil else { throw MeetingFailure.notRecording }
        guard minePaused else { return }
        let token = generation
        let mineToken = queue.sync { () -> Int in mineGeneration += 1; return mineGeneration }
        try mine.start { [weak self] samples, time in self?.receive(samples, at: time, channel: .mine, token: token, mineToken: mineToken) }
        minePaused = false
    }

    public func pendingChunks() -> [MeetingChunk] {
        queue.sync { pending.values.sorted { ($0.session, $0.startFrame, $0.channel.rawValue) < ($1.session, $1.startFrame, $1.channel.rawValue) } }
    }

    /// The ASR's final watermark and its look-behind are different: only discard chunks ending at or before
    /// finalThroughFrame − contextFrames. Whole chunks straddling the boundary stay until the next watermark.
    /// At the end R3 flushes its final window and sends contextFrames: 0. Session scoping also covers crash recovery.
    public func acknowledge(session: String, channel: MeetingChannel, finalThroughFrame: Int, contextFrames: Int = 32_000) throws {
        guard UUID(uuidString: session) != nil, finalThroughFrame >= 0, contextFrames >= 0 else { throw MeetingFailure.invalidValue }
        try queue.sync {
            let boundary = max(0, finalThroughFrame - contextFrames)
            watermarks[session, default: [:]][channel] = max(watermarks[session]?[channel] ?? 0, boundary)
            try discardAcknowledged()
        }
    }

    private func discardAcknowledged() throws {
        for chunk in Array(pending.values) {
            if let boundary = watermarks[chunk.session]?[chunk.channel], chunk.startFrame + chunk.frames <= boundary {
                try MeetingBuffer.acknowledge(chunk, root: root)
                pending.removeValue(forKey: chunk.id)
            }
        }
    }

    private func receive(_ samples: [Float], at time: TimeInterval, channel: MeetingChannel, token: Int, mineToken: Int) {
        guard time.isFinite else { return }
        do {
            var start = 0
            let chunks: [MeetingChunk]? = try queue.sync {
                guard accepting, generation == token, channel != .mine || mineGeneration == mineToken else { return nil }
                let estimated = Int((max(0, time - startedAt) * 16_000).rounded())
                let expected = nextFrame[channel] ?? estimated
                let frame = abs(estimated - expected) <= 1_600 ? expected : estimated
                start = frame
                nextFrame[channel] = frame + samples.count
                let chunks = try buffer?.append(samples, channel: channel, startFrame: frame) ?? []
                for chunk in chunks { pending[chunk.id] = chunk }
                try discardAcknowledged()
                return chunks.filter { pending[$0.id] != nil }
            }
            guard let chunks else { return }
            chunks.forEach { onChunk?($0) }
            onSamples?(channel, start, samples)
            onLevel?(channel, min(1, LevelMeter.rms(samples)))
        } catch {
            queue.sync { accepting = false }
            onError?(MeetingFailure.storage.rawValue)
        }
    }
}
