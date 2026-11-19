import XCTest
@testable import KiwiHelperCore

/// T23991: the helper died on the ⌘V of the paste, reading the keyboard layout off the main queue.
final class PasteKeystrokeTests: XCTestCase {
    func testReadsTheKeyOnMainAndPostsOffMain() {
        let keys = DispatchQueue(label: "test.paste.keys")
        let done = expectation(description: "posted")
        var keyOnMain: Bool?
        var postOnMain: Bool?
        var posted: Int?
        PasteKeystroke.post(on: keys, key: { () -> Int in
            keyOnMain = Thread.isMainThread
            return 9
        }, post: { key in
            postOnMain = Thread.isMainThread
            posted = key
        }, then: { done.fulfill() })
        wait(for: [done], timeout: 2)
        XCTAssertEqual(keyOnMain, true, "the layout (TIS) must be read on the main queue")
        XCTAssertEqual(postOnMain, false, "the key events sleep between them: never on the main queue")
        XCTAssertEqual(posted, 9)
    }
}
