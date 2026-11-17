import Foundation

/// Turns audio into a 0...1 level for the waveform: one level per window of `sampleRate / rate` samples.
/// Counting samples instead of wall-clock time keeps the rate right however big the mic buffers are
/// (on macOS the input tap tends to deliver ~100 ms at once, which a time throttle turns into ~10 Hz).
public struct LevelMeter: Sendable {
    public let windowSamples: Int
    /// Silence floor in dBFS; maps to 0.
    public let floorDB: Float
    private var sumSquares: Float = 0
    private var count = 0

    public init(sampleRate: Double = 16_000, rate: Double = 30, floorDB: Float = -60) {
        windowSamples = max(1, Int((sampleRate / rate).rounded()))
        self.floorDB = floorDB
    }

    public static func rms<C: Collection>(_ samples: C) -> Float where C.Element == Float {
        guard !samples.isEmpty else { return 0 }
        var sum: Float = 0
        for s in samples { sum += s * s }
        return (sum / Float(samples.count)).squareRoot()
    }

    public func normalized(rms: Float) -> Float {
        let db = 20 * log10(max(rms, 1e-9))
        return min(max((db - floorDB) / -floorDB, 0), 1)
    }

    /// The level of every window this chunk completes, oldest first. A partial window carries over to the next call.
    public mutating func push<C: Collection>(_ samples: C) -> [Float] where C.Element == Float {
        var levels: [Float] = []
        for s in samples {
            sumSquares += s * s
            count += 1
            if count == windowSamples {
                levels.append(normalized(rms: (sumSquares / Float(count)).squareRoot()))
                sumSquares = 0
                count = 0
            }
        }
        return levels
    }

    public mutating func reset() {
        sumSquares = 0
        count = 0
    }
}

/// Spreads levels that arrive in bursts (one mic buffer = several windows) over a steady tick,
/// so the waveform moves at ~30 Hz instead of jumping three steps at a time.
/// The backlog is capped: when ticks fall behind, the oldest levels go, so the waveform never lags the voice.
public struct LevelPacer: Sendable {
    public let maxBacklog: Int
    private var queue: [Float] = []

    public init(maxBacklog: Int = 3) {
        self.maxBacklog = max(1, maxBacklog)
    }

    public var backlog: Int { queue.count }

    public mutating func push(_ levels: [Float]) {
        queue.append(contentsOf: levels)
        if queue.count > maxBacklog { queue.removeFirst(queue.count - maxBacklog) }
    }

    /// The level for this tick, or nil when nothing new arrived (skip the tick).
    public mutating func next() -> Float? {
        queue.isEmpty ? nil : queue.removeFirst()
    }

    public mutating func reset() {
        queue.removeAll()
    }
}

/// 16-bit PCM mono WAV, for `--dump-wav` (the STT benchmark in T51 reads these).
public enum WAV {
    public static func encode(samples: [Float], sampleRate: Int) -> Data {
        var pcm = Data(capacity: samples.count * 2)
        for s in samples {
            let v = Int16(max(-1, min(1, s)) * Float(Int16.max))
            withUnsafeBytes(of: v.littleEndian) { pcm.append(contentsOf: $0) }
        }
        var data = Data()
        func u32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { data.append(contentsOf: $0) } }
        func u16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { data.append(contentsOf: $0) } }
        data.append(contentsOf: Array("RIFF".utf8)); u32(UInt32(36 + pcm.count))
        data.append(contentsOf: Array("WAVE".utf8))
        data.append(contentsOf: Array("fmt ".utf8)); u32(16)
        u16(1) // PCM
        u16(1) // mono
        u32(UInt32(sampleRate))
        u32(UInt32(sampleRate * 2)) // byte rate
        u16(2) // block align
        u16(16) // bits per sample
        data.append(contentsOf: Array("data".utf8)); u32(UInt32(pcm.count))
        data.append(pcm)
        return data
    }
}
