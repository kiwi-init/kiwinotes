@testable import KiwiHelperCore
import XCTest

/// The CTC of the vocabulary boosting only with terms (T20949, spec #20887).
final class BoostingDemandTests: XCTestCase {
    private func action(enabled: Bool = true, terms: Bool, loaded: Bool = false, loading: Bool = false, failed: Bool = false) -> BoostingDemand.Action {
        BoostingDemand.action(enabled: enabled, hasTerms: terms, loaded: loaded, loading: loading, failedRecently: failed)
    }

    func testWithoutTermsTheCtcDoesNotLoad() {
        XCTAssertEqual(action(terms: false), .none)
        XCTAssertEqual(action(terms: false, failed: true), .none)
    }

    func testTheFirstTermLoadsIt() {
        XCTAssertEqual(action(terms: true), .load)
    }

    func testOneLoadAtATime() {
        XCTAssertEqual(action(terms: true, loading: true), .none)
        XCTAssertEqual(action(terms: true, loaded: true), .none)
    }

    func testAfterAFailureItWaits() {
        XCTAssertEqual(action(terms: true, failed: true), .none)
    }

    func testRemovingTheLastTermReleasesIt() {
        XCTAssertEqual(action(terms: false, loaded: true), .release)
    }

    func testALoadThatEndsWithoutTermsIsDropped() {
        XCTAssertFalse(BoostingDemand.keepAfterLoad(hasTerms: false))
        XCTAssertTrue(BoostingDemand.keepAfterLoad(hasTerms: true))
    }

    func testOffNeverLoads() {
        XCTAssertEqual(action(enabled: false, terms: true), .none)
        XCTAssertEqual(action(enabled: false, terms: false, loaded: true), .none)
    }
}
