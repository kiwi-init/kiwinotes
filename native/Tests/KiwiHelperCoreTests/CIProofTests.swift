// Prova do CI (T4928): quebrado de propósito. Este branch nunca é mergeado.
import XCTest

final class CIProofTests: XCTestCase {
    func testTheCIGoesRedOnAFailingTest() {
        XCTAssertEqual(1, 2)
    }
}
