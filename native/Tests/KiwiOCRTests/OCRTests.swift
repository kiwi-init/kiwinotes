import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers
import XCTest

@testable import KiwiOCR

/// The OCR on synthetic files made here (T2709): an image with text, a PDF with its own text and a "scanned" PDF
/// (text only as pixels). Nothing from disk, nothing from the network.
final class OCRTests: XCTestCase {
    private var dir: URL!

    override func setUpWithError() throws {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("kiwi-ocr-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: dir)
    }

    /// Black text on white, big enough for Vision to read without guessing.
    private func drawText(_ lines: [String], in ctx: CGContext, width: CGFloat, height: CGFloat) {
        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let font = CTFontCreateWithName("Helvetica" as CFString, 44, nil)
        var y = height - 90
        for line in lines {
            let attrs: [NSAttributedString.Key: Any] = [
                NSAttributedString.Key(kCTFontAttributeName as String): font,
                NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(red: 0, green: 0, blue: 0, alpha: 1),
            ]
            let ct = CTLineCreateWithAttributedString(NSAttributedString(string: line, attributes: attrs))
            ctx.textPosition = CGPoint(x: 40, y: y)
            CTLineDraw(ct, ctx)
            y -= 70
        }
    }

    private func image(_ lines: [String], width: Int = 1200, height: Int = 400) -> CGImage {
        let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        drawText(lines, in: ctx, width: CGFloat(width), height: CGFloat(height))
        return ctx.makeImage()!
    }

    private func writePNG(_ image: CGImage, name: String) throws -> URL {
        let url = dir.appendingPathComponent(name)
        let dest = try XCTUnwrap(CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(dest, image, nil)
        XCTAssertTrue(CGImageDestinationFinalize(dest))
        return url
    }

    /// A PDF page: with `asText`, the PDF carries the text itself; without it, only a picture of the text.
    private func writePDF(_ lines: [String], name: String, asText: Bool) throws -> URL {
        let url = dir.appendingPathComponent(name)
        var box = CGRect(x: 0, y: 0, width: 1200, height: 400)
        let ctx = try XCTUnwrap(CGContext(url as CFURL, mediaBox: &box, nil))
        ctx.beginPDFPage(nil)
        if asText {
            drawText(lines, in: ctx, width: box.width, height: box.height)
        } else {
            ctx.draw(image(lines), in: box)
        }
        ctx.endPDFPage()
        ctx.closePDF()
        return url
    }

    private func words(_ s: String) -> String { s.lowercased() }

    func testReadsTextInAnImage() throws {
        let url = try writePNG(image(["Planta da sala", "Kiwi Notes 2026"]), name: "planta.png")
        let r = try KiwiOCR.recognize(url: url)
        XCTAssertEqual(r.method, "vision")
        XCTAssertEqual(r.pages, 1)
        XCTAssertTrue(words(r.text).contains("planta da sala"), r.text)
        XCTAssertTrue(r.text.contains("2026"), r.text)
    }

    func testUsesThePDFsOwnText() throws {
        let url = try writePDF(["Contrato de aluguel", "Clausula quinta"], name: "contrato.pdf", asText: true)
        let r = try KiwiOCR.recognize(url: url)
        XCTAssertEqual(r.method, "pdf-text")
        XCTAssertTrue(words(r.text).contains("contrato de aluguel"), r.text)
    }

    func testReadsAScannedPDFWithVision() throws {
        let url = try writePDF(["Recibo de pagamento"], name: "recibo.pdf", asText: false)
        let r = try KiwiOCR.recognize(url: url)
        XCTAssertEqual(r.method, "vision")
        XCTAssertTrue(words(r.text).contains("recibo de pagamento"), r.text)
    }

    func testAnImageWithoutTextIsEmpty() throws {
        let blank = image([])
        let r = try KiwiOCR.recognize(url: try writePNG(blank, name: "branco.png"))
        XCTAssertEqual(r.text, "")
        XCTAssertEqual(r.method, "none")
    }

    func testRefusesWhatIsNotAnImageNorAPDF() throws {
        let url = dir.appendingPathComponent("notas.txt")
        try Data("texto".utf8).write(to: url)
        XCTAssertThrowsError(try KiwiOCR.recognize(url: url))
        XCTAssertThrowsError(try KiwiOCR.recognize(url: dir.appendingPathComponent("sumiu.png")))
    }
}
