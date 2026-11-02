import Foundation

/// Turns audio buffers into a 0...1 level for the waveform, at most `rate` times per second.
public struct LevelMeter: Sendable {
    public let interval: TimeInterval
    /// Silence floor in dBFS; maps to 0.
    public let floorDB: Float
    private var lastEmit: TimeInterval = -.infinity
    private var peakSinceEmit: Float = 0

    public init(rate: Double = 30, floorDB: Float = -60) {
        interval = 1 / rate
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

    /// Returns the level to send now, or nil while inside the throttle window (the peak is kept for the next one).
    public mutating func push<C: Collection>(_ samples: C, at t: TimeInterval) -> Float? where C.Element == Float {
        peakSinceEmit = max(peakSinceEmit, normalized(rms: Self.rms(samples)))
        guard t - lastEmit >= interval else { return nil }
        let level = peakSinceEmit
        peakSinceEmit = 0
        lastEmit = t
        return level
    }

    public mutating func reset() {
        lastEmit = -.infinity
        peakSinceEmit = 0
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
