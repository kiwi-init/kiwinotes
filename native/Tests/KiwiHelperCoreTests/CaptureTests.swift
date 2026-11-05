import AVFoundation
import XCTest
@testable import KiwiHelperCore

/// A sine at `rate` Hz, the way a device would hand it over (built-in mic at 48 kHz, Bluetooth HFP at 16 or 24 kHz).
private func sine(rate: Double, seconds: Double, hz: Double = 440, channels: AVAudioChannelCount = 1) -> AVAudioPCMBuffer {
    let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: channels, interleaved: false)!
    let n = AVAudioFrameCount(rate * seconds)
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: n)!
    buffer.frameLength = n
    for c in 0..<Int(channels) {
        for i in 0..<Int(n) { buffer.floatChannelData![c][i] = 0.5 * Float(sin(2 * .pi * hz * Double(i) / rate)) }
    }
    return buffer
}

private func zeroCrossings(_ s: [Float]) -> Int {
    zip(s, s.dropFirst()).filter { ($0 < 0) != ($1 < 0) }.count
}

/// No mic, no device (AGENTS.md): the engine is played by the test.
private final class FakeEngine: MicEngine {
    var onConfigurationChange: (() -> Void)?
    private var onBuffer: ((AVAudioPCMBuffer) -> Void)?
    var started = false
    var discarded = false
    var failPrepare = false
    var failStart = false

    func prepare(onBuffer: @escaping (AVAudioPCMBuffer) -> Void) throws {
        if failPrepare { throw AudioCaptureError.noInputDevice }
        self.onBuffer = onBuffer
    }

    func start() throws {
        if failStart { throw NSError(domain: "fake", code: 1) }
        started = true
    }

    func stop() { started = false }

    func discard() {
        started = false
        discarded = true
    }

    var isPrepared: Bool { onBuffer != nil }

    /// Hands over `seconds` of audio in 20 ms buffers, like a tap. A discarded engine can still deliver a late one.
    func feed(rate: Double, seconds: Double, clock: Clock? = nil) {
        let whole = sine(rate: rate, seconds: seconds)
        let step = AVAudioFrameCount(rate * 0.02)
        var at: AVAudioFrameCount = 0
        while at < whole.frameLength {
            let n = min(step, whole.frameLength - at)
            let b = AVAudioPCMBuffer(pcmFormat: whole.format, frameCapacity: n)!
            b.frameLength = n
            for i in 0..<Int(n) { b.floatChannelData![0][i] = whole.floatChannelData![0][Int(at) + i] }
            clock?.t += 0.02
            onBuffer?(b)
            at += n
        }
    }
}

private final class Clock: @unchecked Sendable {
    var t: TimeInterval = 100
}

private final class Rig {
    let clock = Clock()
    var engines: [FakeEngine] = []
    var lost: [String] = []
    /// What `onLost` handed over with each loss.
    var kept: [[Float]] = []
    var nextFailsStart = false
    var nextFailsPrepare = false
    var log: [String] = []
    /// What `AudioCapture` scheduled with `after`, run by `advance` on the test's clock.
    private var timers: [(at: TimeInterval, work: () -> Void)] = []
    lazy var capture: AudioCapture = {
        let c = AudioCapture(
            makeEngine: { [unowned self] in
                let e = FakeEngine()
                e.failStart = self.nextFailsStart
                e.failPrepare = self.nextFailsPrepare
                self.engines.append(e)
                return e
            },
            now: { [clock] in clock.t },
            after: { [unowned self] delay, work in self.timers.append((self.clock.t + delay, work)) },
            watchdogInterval: nil
        )
        c.onLog = { [unowned self] in self.log.append($0) }
        c.onLost = { [unowned self] code, samples in
            self.lost.append(code)
            self.kept.append(samples)
        }
        return c
    }()
    var engine: FakeEngine { engines.last! }

    /// Moves the clock on, running what came due on the way, in order.
    func advance(_ seconds: TimeInterval) {
        let end = clock.t + seconds
        while let next = timers.indices.filter({ timers[$0].at <= end }).min(by: { timers[$0].at < timers[$1].at }) {
            let timer = timers.remove(at: next)
            clock.t = max(clock.t, timer.at)
            timer.work()
        }
        clock.t = end
    }

    /// Lets an input change settle into a new engine.
    func settle() { advance(AudioCapture.inputSettle) }
}

final class CaptureTests: XCTestCase {
    /// T3229 (#3202): the mic is open only while recording. The warm-up prepares and never starts the device, and
    /// every way a recording ends leaves no engine running: stop, a lost mic, an input change while idle.
    func testNoInputIsOpenOutsideARecording() throws {
        let rig = Rig()
        let running = { rig.engines.filter(\.started).count }
        rig.capture.warmUp()
        XCTAssertTrue(rig.engine.isPrepared)
        XCTAssertEqual(running(), 0, "the warm-up must not start the device")

        try rig.capture.start()
        XCTAssertEqual(running(), 1)
        rig.engine.feed(rate: 48_000, seconds: 0.2, clock: rig.clock)
        _ = rig.capture.stop()
        XCTAssertEqual(running(), 0, "stop closes the input")

        // The mic picked changes while idle (a new choice, AirPods connected): the new engine is prepared, not started.
        rig.capture.inputChanged("microphone: builtin")
        rig.settle()
        XCTAssertTrue(rig.engine.isPrepared)
        XCTAssertEqual(running(), 0)

        // A recording that loses the mic ends with nothing running either.
        try rig.capture.start()
        rig.nextFailsStart = true
        rig.capture.inputChanged("default input device")
        rig.settle()
        XCTAssertEqual(rig.lost, ["device_changed"])
        XCTAssertFalse(rig.capture.isRecording)
        XCTAssertEqual(running(), 0)
    }

    func testResamplerFollowsTheFormatWhenTheDeviceChanges() {
        // #589: the built-in mic at 48 kHz, then a Bluetooth headset in HFP at 16 kHz. A converter built for 48 kHz
        // fails every 16 kHz buffer (OSStatus -1), and the old code dropped them in silence.
        let r = Resampler()
        let a = r.convert(sine(rate: 48_000, seconds: 1))!
        let b = r.convert(sine(rate: 16_000, seconds: 1))
        let c = r.convert(sine(rate: 24_000, seconds: 1, channels: 2))
        XCTAssertNotNil(b)
        XCTAssertNotNil(c)
        for out in [a, b!, c!] {
            XCTAssertEqual(Double(out.count), 16_000, accuracy: 20)
            // Still 440 Hz (~880 crossings a second), not sped up or slowed down.
            XCTAssertEqual(Double(zeroCrossings(out)), 880, accuracy: 20)
        }
    }

    func testBigBuffersArentCutShort() {
        // A 1 s stereo 48 kHz buffer came out 15% short when the converter got it whole: it takes what it asks for.
        let r = Resampler()
        for rate in [48_000.0, 24_000] {
            let out = r.convert(sine(rate: rate, seconds: 1, channels: 2))!
            XCTAssertEqual(Double(out.count), 16_000, accuracy: 20, "\(rate)")
            XCTAssertEqual(Double(zeroCrossings(out)), 880, accuracy: 5, "\(rate)")
        }
        // Interleaved too (some USB mics).
        let f = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48_000, channels: 2, interleaved: true)!
        let b = AVAudioPCMBuffer(pcmFormat: f, frameCapacity: 48_000)!
        b.frameLength = 48_000
        for i in 0..<48_000 {
            let v = 0.5 * Float(sin(2 * .pi * 440 * Double(i) / 48_000))
            b.floatChannelData![0][2 * i] = v
            b.floatChannelData![0][2 * i + 1] = v
        }
        let out = r.convert(b)!
        XCTAssertEqual(Double(out.count), 16_000, accuracy: 20)
        XCTAssertEqual(Double(zeroCrossings(out)), 880, accuracy: 5)
    }

    func testAFixedConverterFailsAfterTheSwitch() {
        // What the old AudioCapture did: one converter, made for the format the tap had when it was installed.
        let target = Resampler().target
        let old = AVAudioConverter(from: sine(rate: 48_000, seconds: 0.1).format, to: target)!
        let buffer = sine(rate: 16_000, seconds: 0.1)
        let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: 4096)!
        var fed = false
        var error: NSError?
        old.convert(to: out, error: &error) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true
            status.pointee = .haveData
            return buffer
        }
        XCTAssertNotNil(error)
    }

    func testSwitchMidRecordingKeepsGoingWithANewEngine() throws {
        let rig = Rig()
        let capture = rig.capture
        try capture.start()
        let first = rig.engine
        first.feed(rate: 48_000, seconds: 0.5, clock: rig.clock)
        // The headset connects: AVAudioEngine says its configuration changed.
        first.onConfigurationChange?()
        rig.settle()
        XCTAssertTrue(first.discarded)
        XCTAssertEqual(rig.engines.count, 2)
        XCTAssertTrue(rig.engine.started)
        rig.engine.feed(rate: 16_000, seconds: 0.5, clock: rig.clock)
        // A late buffer from the old engine (old format) is dropped, not mixed in.
        first.feed(rate: 48_000, seconds: 0.1)
        capture.checkStall()
        let samples = capture.stop()
        XCTAssertEqual(Double(samples.count), 16_000, accuracy: 300)
        XCTAssertEqual(rig.lost, [])
    }

    func testTheDefaultInputChangingAlsoMakesANewEngine() throws {
        let rig = Rig()
        try rig.capture.start()
        rig.engine.feed(rate: 48_000, seconds: 0.2, clock: rig.clock)
        rig.capture.inputChanged("default input device")
        rig.settle()
        XCTAssertEqual(rig.engines.count, 2)
        // The old engine no longer reports changes: its late notification doesn't make a third one.
        rig.engines[0].onConfigurationChange?()
        rig.settle()
        XCTAssertEqual(rig.engines.count, 2)
        rig.engine.feed(rate: 24_000, seconds: 0.3, clock: rig.clock)
        XCTAssertEqual(Double(rig.capture.stop().count), 8_000, accuracy: 300)
    }

    func testEngineThatDiesInSilenceIsReplacedOnceThenTheRecordingFails() throws {
        // #589, 217–242 s: levels stop with no error and no notification; the next start gets 0 samples.
        let rig = Rig()
        try rig.capture.start()
        rig.engine.feed(rate: 48_000, seconds: 0.5, clock: rig.clock)
        rig.clock.t += 0.9
        rig.capture.checkStall()
        XCTAssertEqual(rig.engines.count, 1, "under a second without buffers is fine")
        rig.clock.t += 0.2
        rig.capture.checkStall()
        XCTAssertEqual(rig.engines.count, 2, "a stall replaces the engine")
        XCTAssertTrue(rig.capture.isRecording)
        // The new one gets nothing either.
        rig.clock.t += 1.6
        rig.capture.checkStall()
        XCTAssertEqual(rig.lost, ["no_audio"])
        // The 0.5 s before the mic died goes on to be transcribed (T883); from 48 kHz the resampler keeps < 1 ms back.
        XCTAssertEqual(rig.kept.count, 1)
        XCTAssertEqual(Double(rig.kept.first?.count ?? 0), 8_000, accuracy: 16)
        XCTAssertFalse(rig.capture.isRecording)
        XCTAssertEqual(rig.capture.stop(), [])
        // A fresh engine is ready for the next recording, and it works.
        XCTAssertEqual(rig.engines.count, 3)
        XCTAssertTrue(rig.engine.isPrepared)
        try rig.capture.start()
        rig.engine.feed(rate: 16_000, seconds: 0.25, clock: rig.clock)
        XCTAssertEqual(rig.capture.stop().count, 4_000)
    }

    /// T883: a stall the new engine recovered from doesn't count against a later, unrelated one (the Bluetooth
    /// flapping again 50 s on). Only stalls in a row without audio end the recording.
    func testASecondStallLaterInTheRecordingGetsANewEngineToo() throws {
        let rig = Rig()
        try rig.capture.start()
        rig.engine.feed(rate: 16_000, seconds: 10, clock: rig.clock)
        rig.clock.t += 1.1
        rig.capture.checkStall()
        XCTAssertEqual(rig.engines.count, 2, "first stall: new engine")
        rig.engine.feed(rate: 16_000, seconds: 50, clock: rig.clock)
        rig.clock.t += 1.1
        rig.capture.checkStall()
        XCTAssertEqual(rig.lost, [])
        XCTAssertEqual(rig.engines.count, 3, "second stall, after audio came back: another new engine")
        XCTAssertTrue(rig.capture.isRecording)
        rig.engine.feed(rate: 16_000, seconds: 1, clock: rig.clock)
        XCTAssertEqual(rig.capture.stop().count, 61 * 16_000)
    }

    /// Under 0.3 s there is no dictation to save: `no_audio` as before, with nothing handed over (T883).
    func testATinyRecordingThatLosesTheMicHandsOverNothing() throws {
        let rig = Rig()
        try rig.capture.start()
        rig.engine.feed(rate: 16_000, seconds: 0.28, clock: rig.clock)
        rig.clock.t += 1.1
        rig.capture.checkStall()
        rig.clock.t += 1.6
        rig.capture.checkStall()
        XCTAssertEqual(rig.lost, ["no_audio"])
        XCTAssertEqual(rig.kept, [[]])
        XCTAssertEqual(AudioCapture.keptOnLoss, 4_800)
    }

    /// The stall counter goes back to 0 only with audio: an engine that keeps dying silent still ends the recording.
    func testStallsInARowWithoutAudioStillEndTheRecording() throws {
        let rig = Rig()
        try rig.capture.start()
        rig.engine.feed(rate: 16_000, seconds: 2, clock: rig.clock)
        rig.clock.t += 1.1
        rig.capture.checkStall()
        rig.engine.feed(rate: 16_000, seconds: 3, clock: rig.clock)
        rig.clock.t += 1.1
        rig.capture.checkStall()   // a second stall after audio: new engine
        XCTAssertEqual(rig.engines.count, 3)
        rig.clock.t += 1.6
        rig.capture.checkStall()   // the new one gives nothing
        XCTAssertEqual(rig.lost, ["no_audio"])
        XCTAssertEqual(rig.kept.map(\.count), [5 * 16_000])
    }

    func testAStallThatRecoversKeepsTheWholeRecording() throws {
        let rig = Rig()
        try rig.capture.start()
        rig.engine.feed(rate: 48_000, seconds: 0.5, clock: rig.clock)
        rig.clock.t += 1.1
        rig.capture.checkStall()
        rig.engine.feed(rate: 16_000, seconds: 0.5, clock: rig.clock)
        rig.capture.checkStall()
        XCTAssertEqual(Double(rig.capture.stop().count), 16_000, accuracy: 300)
        XCTAssertEqual(rig.lost, [])
    }

    func testNoFirstBufferAtAll() throws {
        // #589, 242.8 s: "mic engine started", then 0 samples.
        let rig = Rig()
        try rig.capture.start()
        rig.clock.t += 1.4
        rig.capture.checkStall()
        XCTAssertEqual(rig.engines.count, 1, "the first buffer gets 1.5 s (Bluetooth is slow to come up)")
        rig.clock.t += 0.2
        rig.capture.checkStall()
        XCTAssertEqual(rig.engines.count, 2)
        rig.clock.t += 1.6
        rig.capture.checkStall()
        XCTAssertEqual(rig.lost, ["no_audio"])
        XCTAssertEqual(rig.kept, [[]])
    }

    func testNewDeviceThatWontStartEndsTheRecording() throws {
        let rig = Rig()
        try rig.capture.start()
        rig.engine.feed(rate: 48_000, seconds: 0.5, clock: rig.clock)
        rig.nextFailsStart = true
        rig.capture.inputChanged("default input device")
        rig.settle()
        XCTAssertEqual(rig.lost, ["device_changed"])
        XCTAssertEqual(rig.kept.count, 1)
        XCTAssertEqual(Double(rig.kept.first?.count ?? 0), 8_000, accuracy: 16)
        XCTAssertFalse(rig.capture.isRecording)
        XCTAssertEqual(rig.capture.stop(), [])
    }

    func testChangeWhileIdlePreparesTheNewEngineOnlyWhenAllowed() {
        let rig = Rig()
        rig.capture.warmUp()
        XCTAssertTrue(rig.engine.isPrepared)
        rig.capture.inputChanged("default input device")
        rig.settle()
        XCTAssertEqual(rig.engines.count, 2)
        XCTAssertTrue(rig.engine.isPrepared)
        // Before the mic is granted, touching the input can bring up the system prompt.
        rig.capture.mayWarmUp = { false }
        rig.capture.inputChanged("default input device")
        rig.settle()
        XCTAssertEqual(rig.engines.count, 3)
        XCTAssertFalse(rig.engine.isPrepared)
    }

    func testStartThatFailsGetsAFreshEngineForTheNextTry() throws {
        let rig = Rig()
        rig.nextFailsPrepare = true
        XCTAssertThrowsError(try rig.capture.start()) { XCTAssertEqual("\($0)", "no_input_device") }
        XCTAssertFalse(rig.capture.isRecording)
        rig.nextFailsPrepare = false
        // The replacement made after the failure was built while it still failed; the one after works.
        XCTAssertThrowsError(try rig.capture.start())
        try rig.capture.start()
        rig.engine.feed(rate: 16_000, seconds: 0.1, clock: rig.clock)
        XCTAssertEqual(rig.capture.stop().count, 1_600)
    }

    func testWatchdog() {
        var w = CaptureWatchdog(firstBuffer: 1.5, gap: 1.0)
        XCTAssertFalse(w.stalled(at: 50), "not started")
        w.start(at: 0)
        XCTAssertFalse(w.stalled(at: 1.4))
        XCTAssertTrue(w.stalled(at: 1.6))
        w.buffer(at: 1)
        XCTAssertFalse(w.stalled(at: 1.9))
        XCTAssertTrue(w.stalled(at: 2.1))
        w.stop()
        XCTAssertFalse(w.stalled(at: 10))
        // The first start of an engine for a new input gets longer; the next start is back to 1.5 s (T1248).
        w.start(at: 20, afterInputChange: true)
        XCTAssertFalse(w.stalled(at: 23.4))
        XCTAssertTrue(w.stalled(at: 23.6))
        w.start(at: 30)
        XCTAssertTrue(w.stalled(at: 31.6))
    }

    /// T985: how much of the start of a dictation the engine misses is measured on every recording.
    func testFirstBufferDelayIsReportedOncePerRecording() throws {
        let rig = Rig()
        var delays: [TimeInterval] = []
        rig.capture.onFirstBuffer = { delays.append($0) }
        rig.capture.warmUp()
        try rig.capture.start()
        // The device takes 120 ms to come up; the first 20 ms buffer arrives at 140 ms and holds 120–140 ms.
        rig.clock.t += 0.12
        rig.engine.feed(rate: 48_000, seconds: 0.2, clock: rig.clock)
        _ = rig.capture.stop()
        XCTAssertEqual(delays.count, 1)
        XCTAssertEqual(delays[0], 0.12, accuracy: 0.001)
        try rig.capture.start()
        rig.engine.feed(rate: 48_000, seconds: 0.1, clock: rig.clock)
        _ = rig.capture.stop()
        XCTAssertEqual(delays.count, 2)
        XCTAssertEqual(delays[1], 0, accuracy: 0.001)
    }

    // MARK: T1248: Bluetooth headset connecting (A2DP → HFP)

    /// The headset switches profile while connecting: the default input and the engine's configuration change two or
    /// more times in a row. One new engine at the end, not one per change.
    func testABurstOfInputChangesMidRecordingMakesOneEngine() throws {
        let rig = Rig()
        try rig.capture.start()
        rig.engine.feed(rate: 48_000, seconds: 0.5, clock: rig.clock)
        let first = rig.engine
        rig.capture.inputChanged("default input device")
        rig.advance(0.1)
        first.onConfigurationChange?()
        rig.advance(0.25)
        rig.capture.inputChanged("default input device")
        rig.advance(0.3)
        first.onConfigurationChange?()
        rig.advance(AudioCapture.inputSettle - 0.01)
        XCTAssertEqual(rig.engines.count, 1, "still settling")
        rig.advance(0.02)
        XCTAssertEqual(rig.engines.count, 2, "one engine for the burst")
        XCTAssertTrue(first.discarded)
        XCTAssertTrue(rig.engine.started)
        XCTAssertEqual(rig.log.filter { $0.contains("new engine") }.count, 1)
        XCTAssertTrue(rig.log.last?.contains("4 changes") ?? false, rig.log.last ?? "")
        rig.advance(5)
        XCTAssertEqual(rig.engines.count, 2, "nothing else was left scheduled")
        rig.engine.feed(rate: 16_000, seconds: 0.5, clock: rig.clock)
        XCTAssertEqual(Double(rig.capture.stop().count), 16_000, accuracy: 300)
        XCTAssertEqual(rig.lost, [])
    }

    func testABurstWhileIdleMakesOneEngineReadyForTheNextRecording() throws {
        let rig = Rig()
        rig.capture.warmUp()
        for _ in 0..<3 {
            rig.capture.inputChanged("default input device")
            rig.advance(0.2)
        }
        rig.settle()
        XCTAssertEqual(rig.engines.count, 2)
        XCTAssertTrue(rig.engine.isPrepared)
        XCTAssertFalse(rig.engine.started, "no mic indicator while idle")
    }

    /// The person starts dictating before the input settled: the engine for the new input is made right away instead
    /// of recording from the old one, and the change waiting to settle doesn't replace it again.
    func testStartingWhileTheInputSettlesUsesTheNewInput() throws {
        let rig = Rig()
        rig.capture.warmUp()
        rig.capture.inputChanged("default input device")
        rig.advance(0.1)
        try rig.capture.start()
        XCTAssertEqual(rig.engines.count, 2)
        XCTAssertTrue(rig.engines[0].discarded)
        rig.settle()
        XCTAssertEqual(rig.engines.count, 2)
        rig.engine.feed(rate: 16_000, seconds: 0.5, clock: rig.clock)
        XCTAssertEqual(rig.capture.stop().count, 8_000)
    }

    /// The old engine going quiet while the input settles isn't a stall: the new engine is already on its way.
    func testNoStallWhileTheInputSettles() throws {
        let rig = Rig()
        try rig.capture.start()
        rig.engine.feed(rate: 48_000, seconds: 0.5, clock: rig.clock)
        rig.clock.t += 0.9
        rig.capture.inputChanged("default input device")
        rig.advance(0.3)
        rig.capture.checkStall()
        XCTAssertEqual(rig.engines.count, 1)
        rig.settle()
        XCTAssertEqual(rig.engines.count, 2)
        XCTAssertEqual(rig.lost, [])
    }

    /// HFP can take ~2.5 s for the first buffer after the switch: no "Sem áudio do microfone" for that.
    func testASlowFirstBufferAfterTheSwitchIsntAStall() throws {
        let rig = Rig()
        try rig.capture.start()
        rig.engine.feed(rate: 48_000, seconds: 0.5, clock: rig.clock)
        rig.engines[0].onConfigurationChange?()
        rig.settle()
        XCTAssertEqual(rig.engines.count, 2)
        rig.clock.t += 2.6
        rig.capture.checkStall()
        XCTAssertEqual(rig.engines.count, 2, "2.6 s for the first HFP buffer is fine")
        rig.engine.feed(rate: 16_000, seconds: 0.5, clock: rig.clock)
        // Once audio comes, the gap is back to 1 s.
        rig.clock.t += 1.1
        rig.capture.checkStall()
        XCTAssertEqual(rig.engines.count, 3)
        XCTAssertEqual(rig.lost, [])
    }

    /// Connecting while idle: the first recording on the new headset gets the longer first buffer too, the next one
    /// doesn't.
    func testTheFirstRecordingOnTheNewInputGetsTheLongerFirstBuffer() throws {
        let rig = Rig()
        rig.capture.warmUp()
        rig.capture.inputChanged("default input device")
        rig.settle()
        try rig.capture.start()
        rig.clock.t += 2.6
        rig.capture.checkStall()
        XCTAssertEqual(rig.engines.count, 2)
        rig.engine.feed(rate: 16_000, seconds: 0.5, clock: rig.clock)
        _ = rig.capture.stop()
        try rig.capture.start()
        rig.clock.t += 1.6
        rig.capture.checkStall()
        XCTAssertEqual(rig.engines.count, 3, "a later recording is back to 1.5 s")
    }

    /// The longer wait is for the first buffer only, and a headset that never gives audio still ends the recording.
    func testANewInputThatNeverGivesAudioStillEndsTheRecording() throws {
        let rig = Rig()
        try rig.capture.start()
        rig.engine.feed(rate: 48_000, seconds: 0.5, clock: rig.clock)
        rig.capture.inputChanged("default input device")
        rig.settle()
        rig.clock.t += 3.6
        rig.capture.checkStall()
        XCTAssertEqual(rig.engines.count, 3, "no first buffer in 3.5 s: another new engine")
        rig.clock.t += 1.6
        rig.capture.checkStall()
        XCTAssertEqual(rig.lost, ["no_audio"])
        XCTAssertEqual(Double(rig.kept.first?.count ?? 0), 8_000, accuracy: 16)
    }
}

extension CaptureTests {
    func testMeetingStreamingUsesResamplerWithoutRetainingWholeRecording() throws {
        let engine = FakeEngine()
        let capture = AudioCapture(makeEngine: { engine }, watchdogInterval: nil, retainSamples: false)
        var frames = 0
        var packets = 0
        capture.onSamples = { samples, time in
            frames += samples.count
            packets += 1
            XCTAssertTrue(time.isFinite)
        }
        try capture.start()
        engine.feed(rate: 48_000, seconds: 1)
        XCTAssertGreaterThan(frames, 15_500)
        XCTAssertGreaterThan(packets, 1)
        XCTAssertTrue(capture.stop().isEmpty)
    }
}
