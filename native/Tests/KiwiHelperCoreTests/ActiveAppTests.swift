import XCTest
@testable import KiwiHelperCore

final class ActiveAppTests: XCTestCase {
    let slack = ActiveApp(bundleId: "com.tinyspeck.slackmacgap", name: "Slack", pid: 300)
    let mail = ActiveApp(bundleId: "com.apple.mail", name: "Mail", pid: 400)
    let kiwi = ActiveApp(bundleId: "app.kiwinotes.desktop", name: "Kiwi Notes", pid: 100)

    func testAnnouncesEachChangeOnce() {
        var filter = ActiveAppFilter(ownPids: [100, 101])
        XCTAssertEqual(filter.next(slack), slack)
        XCTAssertNil(filter.next(slack))
        XCTAssertEqual(filter.next(mail), mail)
        XCTAssertEqual(filter.next(slack), slack)
    }

    /// Opening Kiwi's own window doesn't change where the person dictates, and coming back to the same app
    /// afterwards isn't news either.
    func testKiwiItselfIsSkipped() {
        var filter = ActiveAppFilter(ownPids: [100, 101])
        XCTAssertEqual(filter.next(slack), slack)
        XCTAssertNil(filter.next(kiwi))
        XCTAssertNil(filter.next(slack))
    }

    func testNoAppOrNoBundleIdStaysQuiet() {
        var filter = ActiveAppFilter(ownPids: [])
        XCTAssertNil(filter.next(nil))
        XCTAssertNil(filter.next(ActiveApp(bundleId: "", name: "?", pid: 5)))
    }

    func testFieldsForTheEvent() {
        XCTAssertEqual(slack.fields["bundleId"] as? String, "com.tinyspeck.slackmacgap")
        XCTAssertEqual(slack.fields["name"] as? String, "Slack")
        XCTAssertEqual(slack.fields["pid"] as? Int, 300)
    }
}
