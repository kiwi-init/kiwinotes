import XCTest
@testable import KiwiHelperCore

final class STTStatusTests: XCTestCase {
    func testStartThenReady() {
        var status = STTStatus()
        XCTAssertTrue(status.update(.loading))
        XCTAssertTrue(status.update(.ready))
        // Every dictation that works says ready again: only the first one is news.
        XCTAssertFalse(status.update(.ready))
    }

    /// #383: the model failed at start (offline on the first run), and a later dictation loaded it.
    func testReadyAfterUnavailable() {
        var status = STTStatus()
        XCTAssertTrue(status.update(.loading))
        XCTAssertTrue(status.update(.unavailable))
        XCTAssertFalse(status.update(.unavailable))
        XCTAssertTrue(status.update(.ready))
        XCTAssertEqual(status.state, .ready)
    }
}
