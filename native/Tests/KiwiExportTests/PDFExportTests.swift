import Foundation
import PDFKit
import XCTest
@testable import KiwiExport

final class PDFExportTests: XCTestCase {
    @MainActor
    func testRendersTheNoteTextIntoAPDF() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("kn-pdf-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let html = dir.appendingPathComponent("nota.html")
        try "<!doctype html><meta charset=utf-8><title>Plano</title><article><h1>Plano do Kiwi</h1><p>Abas em cima, no estilo do Channels.</p></article>"
            .write(to: html, atomically: true, encoding: .utf8)

        let data = try await PDFExport.render(htmlFile: html)

        XCTAssertEqual(String(data: data.prefix(5), encoding: .ascii), "%PDF-")
        let doc = try XCTUnwrap(PDFDocument(data: data))
        XCTAssertGreaterThanOrEqual(doc.pageCount, 1)
        let text = doc.string ?? ""
        XCTAssertTrue(text.contains("Plano do Kiwi"), "texto do PDF: \(text)")
        XCTAssertTrue(text.contains("estilo do Channels"))
    }

    @MainActor
    func testAMissingFileFails() async {
        do {
            _ = try await PDFExport.render(htmlFile: URL(fileURLWithPath: "/nao/existe.html"), timeout: 5)
            XCTFail("esperava erro")
        } catch {}
    }
}
