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

    func testThrottleKeepsPeak() {
        var m = LevelMeter(rate: 30)
        XCTAssertNotNil(m.push([0.001, 0.001], at: 0))
        XCTAssertNil(m.push([Float](repeating: 1, count: 4), at: 0.01))
        XCTAssertNil(m.push([0.001], at: 0.02))
        XCTAssertEqual(m.push([0.001], at: 0.04), 1, "the loud chunk inside the window is not lost")
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
