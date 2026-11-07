import XCTest
@testable import KiwiHelperCore

final class PasteEditTests: XCTestCase {
    func testLocatesThePasteAndReadsTheCorrection() throws {
        let region = try XCTUnwrap(PastedRegion.locate(before: "Oi, ", after: "Oi, mandei para o Pax.", pasted: "mandei para o Pax."))
        XCTAssertEqual(region, PastedRegion(prefix: "Oi, ", pasted: "mandei para o Pax.", suffix: ""))
        XCTAssertEqual(region.edited("Oi, mandei para o PACS."), "mandei para o PACS.")
        XCTAssertNil(region.edited("Oi, mandei para o Pax."))
    }

    func testPasteInTheMiddleKeepsBothSides() throws {
        let region = try XCTUnwrap(PastedRegion.locate(before: "A  B", after: "A o Pax B", pasted: "o Pax"))
        XCTAssertEqual(region.prefix, "A ")
        XCTAssertEqual(region.suffix, " B")
        XCTAssertEqual(region.edited("A o PACS B"), "o PACS")
    }

    /// An edit outside the pasted stretch isn't about the dictation.
    func testEditAroundThePasteIsIgnored() throws {
        let region = try XCTUnwrap(PastedRegion.locate(before: "Oi, ", after: "Oi, o Pax", pasted: "o Pax"))
        XCTAssertNil(region.edited("Olá, o PACS"))
        XCTAssertNil(region.edited(""))
    }

    func testPasteThatDoesNotMatchIsNotLocated() {
        XCTAssertNil(PastedRegion.locate(before: "Oi", after: "Oi o Pax", pasted: "outra coisa"))
        XCTAssertNil(PastedRegion.locate(before: "Oi", after: "Oi", pasted: "x"))
        XCTAssertNil(PastedRegion.locate(before: "", after: "", pasted: ""))
    }
}
