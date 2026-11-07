import XCTest
@testable import KiwiHelperCore

final class BrowserSiteTests: XCTestCase {
    func testBrowserCarriesTitleAndHost() {
        let fields = BrowserSite.appFields(bundleId: "com.google.Chrome", name: "Google Chrome",
                                           title: "Inbox (3) - ana@gmail.com - Gmail", host: "mail.google.com")
        XCTAssertEqual(fields, ["bundleId": "com.google.Chrome", "name": "Google Chrome",
                                "title": "Inbox (3) - ana@gmail.com - Gmail", "urlHost": "mail.google.com"])
    }

    /// No other app's window title leaves the helper.
    func testOtherAppsCarryNoTitle() {
        let fields = BrowserSite.appFields(bundleId: "com.apple.mail", name: "Mail", title: "Contrato", host: "x.com")
        XCTAssertEqual(fields, ["bundleId": "com.apple.mail", "name": "Mail"])
    }

    func testEmptyTitleAndHostAreLeftOut() {
        let fields = BrowserSite.appFields(bundleId: "com.apple.Safari", name: "Safari", title: "  ", host: nil)
        XCTAssertEqual(fields, ["bundleId": "com.apple.Safari", "name": "Safari"])
    }

    func testLongTitleIsCut() {
        let fields = BrowserSite.appFields(bundleId: "com.apple.Safari", name: "Safari", title: String(repeating: "a", count: 900), host: nil)
        XCTAssertEqual(fields["title"]?.count, 300)
    }

    /// Only the host: the page's path, query and fragment never go.
    func testHostOnly() {
        XCTAssertEqual(BrowserSite.host(of: "https://Mail.Google.com/mail/u/0/#inbox?compose=new"), "mail.google.com")
        XCTAssertEqual(BrowserSite.host(of: "http://app.slack.com/client/T1/C2"), "app.slack.com")
        XCTAssertNil(BrowserSite.host(of: "file:///Users/ana/doc.html"))
        XCTAssertNil(BrowserSite.host(of: "about:blank"))
        XCTAssertNil(BrowserSite.host(of: nil))
    }

    /// `record.site`: only the bundle id and what was read; nothing when nothing was read or it isn't a browser.
    func testSiteFields() {
        XCTAssertEqual(BrowserSite.siteFields(bundleId: "com.apple.Safari", title: "Gmail", host: "mail.google.com"),
                       ["bundleId": "com.apple.Safari", "title": "Gmail", "urlHost": "mail.google.com"])
        XCTAssertNil(BrowserSite.siteFields(bundleId: "com.apple.Safari", title: nil, host: nil))
        XCTAssertNil(BrowserSite.siteFields(bundleId: "com.apple.mail", title: "Contrato", host: "x.com"))
    }
}
