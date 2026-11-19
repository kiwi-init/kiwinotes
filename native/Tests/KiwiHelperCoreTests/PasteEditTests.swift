import XCTest
@testable import KiwiHelperCore

final class PasteEditTests: XCTestCase {
    func testLocatesThePasteAndReadsTheCorrection() throws {
        let region = try XCTUnwrap(PastedRegion.locate(before: "Oi, ", after: "Oi, mandei para o Cilo.", pasted: "mandei para o Cilo."))
        XCTAssertEqual(region, PastedRegion(prefix: "Oi, ", pasted: "mandei para o Cilo.", suffix: ""))
        XCTAssertEqual(region.edited("Oi, mandei para o SILO."), "mandei para o SILO.")
        XCTAssertNil(region.edited("Oi, mandei para o Cilo."))
    }

    func testPasteInTheMiddleKeepsBothSides() throws {
        let region = try XCTUnwrap(PastedRegion.locate(before: "A  B", after: "A o Cilo B", pasted: "o Cilo"))
        XCTAssertEqual(region.prefix, "A ")
        XCTAssertEqual(region.suffix, " B")
        XCTAssertEqual(region.edited("A o SILO B"), "o SILO")
    }

    /// An edit outside the pasted stretch isn't about the dictation.
    func testEditAroundThePasteIsIgnored() throws {
        let region = try XCTUnwrap(PastedRegion.locate(before: "Oi, ", after: "Oi, o Cilo", pasted: "o Cilo"))
        XCTAssertNil(region.edited("Olá, o SILO"))
        XCTAssertNil(region.edited(""))
    }

    func testPasteThatDoesNotMatchIsNotLocated() {
        XCTAssertNil(PastedRegion.locate(before: "Oi", after: "Oi o Cilo", pasted: "outra coisa"))
        XCTAssertNil(PastedRegion.locate(before: "Oi", after: "Oi", pasted: "x"))
        XCTAssertNil(PastedRegion.locate(before: "", after: "", pasted: ""))
    }

    // Issue #1: why a paste isn't located, and how the watch ends, without text.

    func testWhyNotLocatedGivesTheReasonAndCounts() {
        // The field also gained a line break the paste didn't carry.
        XCTAssertEqual(PastedRegion.whyNotLocated(before: "Lista", after: "Lista o Cilo\n", pasted: " o Cilo"), "count(+8/7)")
        // The leading space Kiwi added was swallowed.
        XCTAssertEqual(PastedRegion.whyNotLocated(before: "Lista ", after: "Lista o Cilo", pasted: " o Cilo"), "count(+6/7)")
        XCTAssertEqual(PastedRegion.whyNotLocated(before: "Oi", after: "Oi o Cilo", pasted: "o Silo "), "moved")
        XCTAssertEqual(PastedRegion.whyNotLocated(before: "ab", after: "abxy", pasted: "cd"), "moved")
        // The paste is there, but the text after it changed too.
        XCTAssertEqual(PastedRegion.whyNotLocated(before: "abc", after: "abXbd", pasted: "Xb"), "around")
        XCTAssertEqual(PastedRegion.whyNotLocated(before: "", after: "", pasted: ""), "empty")
    }

    private let region = PastedRegion(prefix: "Lista: ", pasted: "o Cilo", suffix: "\nfim")
    private func field(_ value: String?, element: Int = 7) -> PasteEditWatcher.Read { .field(element: element, value: value) }

    func testWatcherReportsTheEditOnceItSettles() {
        var w = PasteEditWatcher(region: region, element: 7, start: 0)
        XCTAssertEqual(w.read(field("Lista: o Cilo\nfim"), at: 0.7), .wait)
        XCTAssertEqual(w.read(field("Lista: o S\nfim"), at: 1.4), .wait)
        XCTAssertEqual(w.read(field("Lista: o SILO\nfim"), at: 2.1), .wait)
        XCTAssertEqual(w.read(field("Lista: o SILO\nfim"), at: 2.8), .wait)
        // 1.5 s still: with a read every 0.7 s, the third read after the change.
        XCTAssertEqual(w.read(field("Lista: o SILO\nfim"), at: 3.5), .wait)
        XCTAssertEqual(w.read(field("Lista: o SILO\nfim"), at: 4.2), .report("o SILO"))
        XCTAssertEqual(w.reads, 6)
        XCTAssertEqual(w.changes, 2)
    }

    /// A field whose element changes after the edit (the app rebuilt the view) ends the watch, and says so.
    func testWatcherSaysTheElementChanged() {
        var w = PasteEditWatcher(region: region, element: 7, start: 0)
        XCTAssertEqual(w.read(field("Lista: o SILO\nfim"), at: 0.7), .wait)
        XCTAssertEqual(w.read(field("Lista: o SILO\nfim", element: 8), at: 1.4), .stop("element_changed"))
        XCTAssertEqual(w.changes, 1)
    }

    /// Seen twice before the field changed hands: the edit still goes out, as before.
    func testWatcherReportsAnEditSeenTwiceWhenTheFieldGoes() {
        var w = PasteEditWatcher(region: region, element: 7, start: 0)
        _ = w.read(field("Lista: o SILO\nfim"), at: 0.7)
        XCTAssertEqual(w.read(field("Lista: o SILO\nfim"), at: 1.4), .wait)
        XCTAssertEqual(w.read(.none, at: 2.1), .report("o SILO"))
    }

    /// The app changed the text around the paste on its own (here, the line after it).
    func testWatcherSaysTheTextAroundChanged() {
        var w = PasteEditWatcher(region: region, element: 7, start: 0)
        XCTAssertEqual(w.read(field("Lista: o SILO\nfim."), at: 0.7), .stop("around_changed"))
        XCTAssertEqual(w.changes, 0)
    }

    func testWatcherOtherEnds() {
        var w = PasteEditWatcher(region: region, element: 7, start: 0)
        XCTAssertEqual(w.read(field(nil), at: 0.7), .stop("unreadable"))
        w = PasteEditWatcher(region: region, element: 7, start: 0)
        XCTAssertEqual(w.read(field("Lista: \nfim"), at: 0.7), .stop("emptied"))
        w = PasteEditWatcher(region: region, element: 7, start: 0)
        XCTAssertEqual(w.read(field("Lista: o SILO\nfim"), at: 0.7, current: false), .stop("superseded"))
        w = PasteEditWatcher(region: region, element: 7, start: 0)
        _ = w.read(field("Lista: o Cilo\nfim"), at: 0.7)
        XCTAssertEqual(w.end("window"), .stop("window"))
        XCTAssertEqual(w.changes, 0)
    }
}
