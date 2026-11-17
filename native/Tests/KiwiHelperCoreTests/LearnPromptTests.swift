import XCTest
@testable import KiwiHelperCore

final class LearnPromptTests: XCTestCase {
    private var timers: [(TimeInterval, () -> Void)] = []
    private var shown: [LearnOffer?] = []
    private var answers: [(LearnOffer, LearnAnswer)] = []

    private func prompt() -> LearnPrompt {
        timers = []
        shown = []
        answers = []
        let p = LearnPrompt { [unowned self] delay, run in self.timers.append((delay, run)) }
        p.onChange = { [unowned self] in self.shown.append($0) }
        p.onAnswer = { [unowned self] in self.answers.append(($0, $1)) }
        return p
    }

    private let cilo = LearnOffer(from: "Cilo", to: "SILO")

    func testParseTakesATrimmedSwapAndRefusesTheRest() {
        XCTAssertEqual(LearnOffer.parse(["from": " Cilo ", "to": "SILO"]), cilo)
        XCTAssertNil(LearnOffer.parse(["from": "", "to": "SILO"]))
        XCTAssertNil(LearnOffer.parse(["from": "SILO", "to": "SILO"]))
        XCTAssertNil(LearnOffer.parse(["from": "Cilo"]))
        XCTAssertNil(LearnOffer.parse(["from": String(repeating: "a", count: 81), "to": "SILO"]))
    }

    func testAddAnswersTheOfferAndHidesTheCard() {
        let p = prompt()
        p.offer(cilo)
        XCTAssertEqual(p.current, cilo)
        XCTAssertTrue(p.answer(.add))
        XCTAssertNil(p.current)
        XCTAssertEqual(shown, [cilo, nil])
        XCTAssertEqual(answers.map(\.1), [.add])
        XCTAssertEqual(answers.first?.0, cilo)
        XCTAssertFalse(p.answer(.notNow), "nothing up, nothing to answer")
    }

    func testTheCardExpiresAfterTheTimeout() {
        let p = prompt()
        p.offer(cilo)
        XCTAssertEqual(timers.first?.0, LearnPrompt.timeout)
        timers[0].1()
        XCTAssertNil(p.current)
        XCTAssertEqual(answers.map(\.1), [.expired])
    }

    func testAnOldTimerDoesNotExpireANewerOffer() {
        let p = prompt()
        p.offer(cilo)
        p.answer(.notNow)
        let kube = LearnOffer(from: "cube control", to: "kubectl")
        p.offer(kube)
        timers[0].1()
        XCTAssertEqual(p.current, kube)
        timers[1].1()
        XCTAssertNil(p.current)
        XCTAssertEqual(answers.map(\.1), [.notNow, .expired])
    }

    func testANewOfferExpiresTheOneOnTheCard() {
        let p = prompt()
        p.offer(cilo)
        let kube = LearnOffer(from: "cube control", to: "kubectl")
        p.offer(kube)
        XCTAssertEqual(p.current, kube)
        XCTAssertEqual(answers.map(\.0), [cilo])
        XCTAssertEqual(answers.map(\.1), [.expired])
    }

    func testADictationTakesThePlaceOfTheCard() {
        let p = prompt()
        p.offer(cilo)
        p.dictationStarted()
        XCTAssertNil(p.current)
        XCTAssertEqual(answers.map(\.1), [.expired])
        p.dictationStarted()
        XCTAssertEqual(answers.count, 1)
    }
}
