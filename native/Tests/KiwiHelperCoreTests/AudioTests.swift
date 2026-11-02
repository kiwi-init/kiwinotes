import XCTest
@testable import KiwiHelperCore

final class AudioTests: XCTestCase {
    func testLevelScale() {
        let m = LevelMeter()
        XCTAssertEqual(m.normalized(rms: 0), 0)
        XCTAssertEqual(m.normalized(rms: 1), 1)
        XCTAssertEqual(m.normalized(rms: 0.001), 0, accuracy: 0.001) // -60 dBFS
        XCTAssertEqual(m.normalized(rms: 0.0316), 0.5, accuracy: 0.01) // -30 dBFS
    }

    func testRMS() {
        XCTAssertEqual(LevelMeter.rms([Float]()), 0)
        XCTAssertEqual(LevelMeter.rms([0.5, -0.5, 0.5, -0.5]), 0.5, accuracy: 1e-6)
    }

    func testOneLevelPerWindowWhateverTheBufferSize() {
        // 16 kHz at 30 Hz = 533 samples per window. A 100 ms buffer (1600 samples) gives 3 levels, not 1.
        var m = LevelMeter(sampleRate: 16_000, rate: 30)
        XCTAssertEqual(m.windowSamples, 533)
        XCTAssertEqual(m.push([Float](repeating: 0.5, count: 1600)).count, 3)
        // The 1 leftover sample carries over: 532 more complete the next window.
        XCTAssertEqual(m.push([Float](repeating: 0.5, count: 531)).count, 0)
        XCTAssertEqual(m.push([Float](repeating: 0.5, count: 1)).count, 1)
        // One second of audio in small buffers still gives ~30 levels.
        m.reset()
        var total = 0
        for _ in 0..<(16_000 / 160) { total += m.push([Float](repeating: 0.1, count: 160)).count }
        XCTAssertEqual(total, 30)
    }

    func testLevelsKeepTheirOrderAndLoudness() {
        var m = LevelMeter(sampleRate: 100, rate: 10) // windows of 10 samples
        let quiet = [Float](repeating: 0.001, count: 10), loud = [Float](repeating: 1, count: 10)
        let levels = m.push(quiet + loud + quiet)
        XCTAssertEqual(levels.count, 3)
        XCTAssertEqual(levels[0], 0, accuracy: 0.001)
        XCTAssertEqual(levels[1], 1, accuracy: 0.001)
        XCTAssertEqual(levels[2], 0, accuracy: 0.001)
    }

    func testPacerSpreadsBurstsAndCapsBacklog() {
        var p = LevelPacer(maxBacklog: 4)
        XCTAssertNil(p.next(), "nothing yet: skip the tick")
        p.push([0.1, 0.2, 0.3])
        XCTAssertEqual(p.next(), 0.1)
        XCTAssertEqual(p.next(), 0.2)
        p.push([0.4, 0.5, 0.6, 0.7])
        XCTAssertEqual(p.backlog, 4, "the oldest go first when ticks fall behind")
        XCTAssertEqual(p.next(), 0.4)
        p.reset()
        XCTAssertNil(p.next())
    }

    func testWAVHeader() {
        let data = WAV.encode(samples: [0, 1, -1, 0.5], sampleRate: 16_000)
        XCTAssertEqual(data.count, 44 + 8)
        XCTAssertEqual(String(decoding: data[0..<4], as: UTF8.self), "RIFF")
        XCTAssertEqual(String(decoding: data[8..<12], as: UTF8.self), "WAVE")
        let rate = data[24..<28].withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }
        XCTAssertEqual(UInt32(littleEndian: rate), 16_000)
        let second = data[46..<48].withUnsafeBytes { $0.loadUnaligned(as: Int16.self) }
        XCTAssertEqual(Int16(littleEndian: second), Int16.max)
    }
}
