import Foundation
import XCTest
@testable import KiwiHelperCore

/// Um aparelho falso com a escala em dB de um alto-falante: o scalar vai de −60 dB (0) a 0 dB (1) em linha reta, então
/// metade do scalar não é metade do som (0,8 → 0,4 desce 24 dB). Nada sai do processo.
private final class DecibelVolume: MediaVolumeControl {
    let target = MediaVolumeTarget(device: 1, uid: "fake-speaker", channel: 0)
    var value: Float
    var hasDecibels = true
    var quantize = false
    var writes: [Float] = []
    init(_ value: Float = 0.8) { self.value = value }
    func targets() -> [MediaVolumeTarget] { [target] }
    func read(_ target: MediaVolumeTarget) -> Float? { target == self.target ? value : nil }
    func write(_ new: Float, to target: MediaVolumeTarget) -> Bool {
        writes.append(new)
        value = quantize ? (new * 16).rounded() / 16 : new
        return true
    }
    func decibels(fromScalar value: Float, on target: MediaVolumeTarget) -> Float? { hasDecibels ? 60 * (value - 1) : nil }
    func scalar(fromDecibels value: Float, on target: MediaVolumeTarget) -> Float? {
        hasDecibels ? max(0, min(1, 1 + value / 60)) : nil
    }
}
private final class MemoryJournal: MediaVolumeJournal {
    var changes: [MediaVolumeChange]?
    func load() throws -> [MediaVolumeChange]? { changes }
    func save(_ changes: [MediaVolumeChange]) throws { self.changes = changes }
    func clear() throws { changes = nil }
}

final class SpeechMediaTests: XCTestCase {
    /// 0,8 na escala falsa (−12 dB), abaixado de `SpeechMedia.step` (−6,02 dB): ~0,6997.
    private let lowered80 = 1 + (-12 + SpeechMedia.step) / 60
    func testTheVoiceLowersTheOutputBySixDecibelsOnTheDeviceScaleAndGainsItBack() {
        let device = DecibelVolume(0.8), media = SpeechMedia(volume: device, journal: MemoryJournal())
        XCTAssertEqual(media.gain, 1)
        media.duck(recording: false, meeting: false)
        // 0,8 é −12 dB; −6 dB a mais é −18 dB, o scalar ~0,7. Metade do scalar (0,4) seria −36 dB.
        XCTAssertEqual(device.value, lowered80, accuracy: 0.0001)
        XCTAssertEqual(media.gain, 2, accuracy: 0.001)
        XCTAssertEqual(media.mouthVolume(device: device.value), 0.8, accuracy: 0.0001)
        media.unduck()
        XCTAssertEqual(device.value, 0.8, accuracy: 0.0001)
        XCTAssertEqual(media.gain, 1)
        XCTAssertEqual(media.mouthVolume(device: device.value), 0.8, accuracy: 0.0001)
    }

    func testADeviceWithoutTheDecibelScaleIsLeftAloneAndTheVoiceStaysAsIs() {
        let device = DecibelVolume(0.8)
        device.hasDecibels = false
        var codes: [String] = []
        let media = SpeechMedia(volume: device, journal: MemoryJournal(), notify: { codes.append($0) })
        media.duck(recording: false, meeting: false)
        XCTAssertEqual(device.writes, [])
        XCTAssertEqual(media.gain, 1)
        XCTAssertTrue(codes.contains("media: no_decibels"))
        media.unduck()
        XCTAssertEqual(device.writes, [])
    }

    func testTheGainFollowsWhatTheDriverAcceptedNotWhatWasAsked() {
        let device = DecibelVolume(0.75) // −15 dB, um degrau de 1/16
        device.quantize = true // pede 0,65 (−21 dB), o driver aceita 0,625: −22,5 dB, 7,5 dB abaixo
        let media = SpeechMedia(volume: device, journal: MemoryJournal())
        media.duck(recording: false, meeting: false)
        XCTAssertEqual(device.value, 0.625, accuracy: 0.0001)
        XCTAssertEqual(media.gain, 2, accuracy: 0.0001) // passaria de 2 (2,37): o teto segura
        media.unduck()
        XCTAssertEqual(device.value, 0.75, accuracy: 0.0001)
    }

    func testASmallerDropGivesASmallerGain() {
        let device = DecibelVolume(0.05) // −57 dB: só desce 3 dB até o fundo
        let media = SpeechMedia(volume: device, journal: MemoryJournal())
        media.duck(recording: false, meeting: false)
        XCTAssertEqual(device.value, 0, accuracy: 0.0001)
        XCTAssertEqual(media.gain, Float(pow(10, 3.0 / 20)), accuracy: 0.001)
        media.unduck()
        XCTAssertEqual(device.value, 0.05, accuracy: 0.0001)
    }

    func testNothingGoesDownWhileTheMicRecordsOrInAMeeting() {
        for (recording, meeting) in [(true, false), (false, true)] {
            let device = DecibelVolume(0.8), media = SpeechMedia(volume: device, journal: MemoryJournal())
            media.duck(recording: recording, meeting: meeting)
            XCTAssertEqual(device.value, 0.8)
            XCTAssertEqual(media.gain, 1)
            media.unduck()
            XCTAssertEqual(device.value, 0.8)
        }
    }

    func testADictationMidSpeechGivesTheSpeechVolumeBackFirstSoTheyNeverStack() {
        let device = DecibelVolume(0.8)
        let speech = SpeechMedia(volume: device, journal: MemoryJournal())
        let dictation = DictationMedia(volume: device, journal: MemoryJournal())
        speech.duck(recording: false, meeting: false)
        XCTAssertEqual(device.value, lowered80, accuracy: 0.0001)
        speech.release() // o Helper chama antes de abrir o mic
        dictation.startCapture { }
        XCTAssertEqual(device.value, 0.2, accuracy: 0.0001) // 25% do volume da pessoa, não do já abaixado
        XCTAssertEqual(speech.gain, 1)
        speech.unduck() // a fala acaba no meio do ditado: não mexe em nada
        XCTAssertEqual(device.value, 0.2, accuracy: 0.0001)
        dictation.end()
        XCTAssertEqual(device.value, 0.8, accuracy: 0.0001)
    }

    func testReleaseWithNothingDownWritesNothing() {
        let device = DecibelVolume(0.8)
        var codes: [String] = []
        let media = SpeechMedia(volume: device, journal: MemoryJournal(), notify: { codes.append($0) })
        media.release()
        XCTAssertEqual(device.writes, [])
        XCTAssertEqual(codes, [])
    }

    func testACrashMidSpeechIsRestoredByTheNextHelper() {
        let device = DecibelVolume(0.8), journal = MemoryJournal()
        SpeechMedia(volume: device, journal: journal).duck(recording: false, meeting: false)
        XCTAssertEqual(device.value, lowered80, accuracy: 0.0001)
        XCTAssertNotNil(journal.changes)
        SpeechMedia(volume: device, journal: journal).restorePending() // a abertura seguinte
        XCTAssertEqual(device.value, 0.8, accuracy: 0.0001)
        XCTAssertNil(journal.changes)
    }

    func testTheDictationKeepsAQuarterOfTheScalarAndNoGain() {
        let device = DecibelVolume(0.8), media = DictationMedia(volume: device, journal: MemoryJournal())
        media.begin()
        XCTAssertEqual(device.value, 0.2, accuracy: 0.0001)
        XCTAssertEqual(media.compensation(), 1)
        media.end()
    }
}

final class SpeechGainTests: XCTestCase {
    func testNoGainLeavesTheSamplesAlone() {
        let s: [Float] = [0, 0.3, -0.9, 1]
        XCTAssertEqual(SpeechGain.apply(s, gain: 1), s)
        XCTAssertEqual(SpeechGain.apply(s, gain: .nan), s)
    }

    func testBelowTheKneeTheVoiceJustDoubles() {
        XCTAssertEqual(SpeechGain.apply([0.1, -0.25, 0.4], gain: 2), [0.2, -0.5, 0.8])
    }

    func testTheReferencePeaksStayBelowOneAndKeepTheirOrderAndSign() {
        // Os picos medidos das 3 referências (en-a, en-b, pt-a), ×2.
        let out = SpeechGain.apply([0.825, 0.599, 0.583, -0.825], gain: 2)
        for v in out { XCTAssertLessThan(abs(v), 1) }
        XCTAssertGreaterThan(out[0], out[1])
        XCTAssertGreaterThan(out[1], out[2])
        XCTAssertGreaterThan(out[2], SpeechGain.knee)
        XCTAssertEqual(out[3], -out[0])
    }

    func testTheCurveIsSmoothAtTheKnee() {
        let k = SpeechGain.knee, e: Float = 0.0001
        XCTAssertEqual(SpeechGain.limit(k + e) - SpeechGain.limit(k), e, accuracy: e * 0.01)
        XCTAssertEqual(SpeechGain.limit(k), k)
    }

    func testEvenAFullScaleSampleNeverClips() {
        XCTAssertLessThanOrEqual(SpeechGain.apply([1, -1], gain: 2).map(abs).max()!, 1)
    }
}
