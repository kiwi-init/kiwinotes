import XCTest
@testable import KiwiHelperCore

/// T5833 (#213): os sons de início e de fim, sem tocar som nenhum (AGENTS.md): a síntese, a ordem e o tap.
final class CueSynthTests: XCTestCase {
    /// A frequência que domina um trecho, pelos cruzamentos de zero: basta para saber se sobe ou desce.
    private func pitch(_ s: ArraySlice<Float>, rate: Double = 44_100) -> Double {
        var crossings = 0
        var previous = s.first ?? 0
        for x in s.dropFirst() {
            if (previous < 0) != (x < 0) { crossings += 1 }
            previous = x
        }
        return Double(crossings) / 2 / (Double(s.count) / rate)
    }

    func testEveryProposalIsShortQuietAndHasNoClick() {
        for recipe in CueRecipe.proposals {
            for cue in Cue.allCases {
                let s = CueSynth.render(recipe, cue)
                XCTAssertLessThan(Double(s.count) / 44_100, 0.25, "\(recipe.name) \(cue): under 250 ms")
                XCTAssertLessThanOrEqual(s.map(abs).max()!, CueSynth.peak + 1e-6, "low: the peak")
                XCTAssertEqual(s.first!, 0, accuracy: 1e-3, "no click at the start")
                XCTAssertEqual(s.last!, 0, accuracy: 1e-3, "no click at the end")
                XCTAssertFalse(s.contains { !$0.isFinite })
            }
        }
    }

    func testTheStartGoesUpAndTheEndGoesDown() {
        for recipe in CueRecipe.proposals {
            // Each note's own stretch: the first one alone, and the second one after its attack.
            let gap = Int(recipe.gapMs / 1000 * 44_100)
            let start = CueSynth.render(recipe, .start), end = CueSynth.render(recipe, .end)
            let window = Int(0.02 * 44_100)
            XCTAssertGreaterThan(pitch(start[(gap + 200)..<(gap + 200 + window)]), pitch(start[200..<(200 + window)]), "\(recipe.name): start rises")
            XCTAssertLessThan(pitch(end[(gap + 200)..<(gap + 200 + window)]), pitch(end[200..<(200 + window)]), "\(recipe.name): end falls")
        }
    }

    func testTheDefaultIsOneOfTheProposals() {
        XCTAssertNotNil(CueRecipe.named(CueRecipe.defaultName))
        XCTAssertEqual(Set(CueRecipe.proposals.map(\.name)).count, CueRecipe.proposals.count)
    }
}

final class RecordingCuesTests: XCTestCase {
    final class FakePlayer: CuePlaying {
        var log: [String]
        init(_ log: [String] = []) { self.log = log }
        func play(_ cue: Cue) { log.append("cue:\(cue.rawValue)") }
    }

    func testTheStartCueBeforeTheDuckAndTheMicAndTheEndCueAfterTheRestore() {
        let player = FakePlayer()
        let cues = RecordingCues(player: player)
        cues.begin(duck: { player.log.append("duck") }, open: { player.log.append("mic:open") })
        cues.end(close: { player.log.append("mic:close") }, restore: { player.log.append("restore") })
        XCTAssertEqual(player.log, ["cue:start", "duck", "mic:open", "mic:close", "restore", "cue:end"])
    }

    func testOffPlaysNothingAndStillRecords() {
        let player = FakePlayer()
        let cues = RecordingCues(player: player, enabled: false)
        cues.begin(open: { player.log.append("mic:open") })
        cues.end(close: { player.log.append("mic:close") })
        XCTAssertEqual(player.log, ["mic:open", "mic:close"])
    }

    func testAMicThatFailsToOpenPassesTheErrorOn() {
        struct Boom: Error {}
        let player = FakePlayer()
        let cues = RecordingCues(player: player)
        XCTAssertThrowsError(try cues.begin(open: { throw Boom() }))
        XCTAssertEqual(player.log, ["cue:start"])
    }
}

final class MeetingTapExclusionTests: XCTestCase {
    func testKiwisOwnProcessesLeaveTheTap() {
        // The helper (100) and the app (200); 300 never touched audio, so it has no process object.
        let objects = MeetingTapExclusion.processObjects(pids: [100, 200, 300, 100], translate: { pid in
            [100: 41, 200: 42][pid] ?? 0
        })
        XCTAssertEqual(objects, [41, 42])
    }
}
