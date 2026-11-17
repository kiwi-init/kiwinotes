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
}
