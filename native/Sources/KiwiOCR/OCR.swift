import CoreGraphics
import Foundation
import ImageIO
import PDFKit
import Vision

/// What came out of one file (T2709): the text, and how it was read.
public struct OCRResult: Codable, Equatable, Sendable {
    /// The text, one line per recognized line, pages separated by a blank line.
    public let text: String
    /// "vision" (an image), "pdf-text" (the PDF's own text), "pdf-text+vision" (some pages had no text) or "none".
    public let method: String
    /// Pages read (1 for an image).
    public let pages: Int
}

public enum OCRError: Error, CustomStringConvertible {
    case unreadable(String)
    case unsupported(String)

    public var description: String {
        switch self {
        case .unreadable(let path): return "can't read \(path)"
        case .unsupported(let ext): return "not an image or PDF: .\(ext)"
        }
    }
}

/// Local OCR with the macOS Vision framework and PDFKit: nothing leaves the Mac, no model to download, no permission
/// to ask (neither framework goes through TCC). Text in Portuguese and English, the languages the app dictates in.
public enum KiwiOCR {
    /// The languages Vision tries, in order.
    public static let languages = ["pt-BR", "en-US"]
    /// A PDF page with fewer characters than this of its own text is read as an image (a scanned page).
    public static let minPageText = 8

    /// Reads an image (png, jpg, gif, webp, heic) or a PDF. SVG has no pixels to read: it comes back empty.
    public static func recognize(url: URL, maxPages: Int = 50) throws -> OCRResult {
        let ext = url.pathExtension.lowercased()
        switch ext {
        case "pdf":
            return try recognizePDF(url: url, maxPages: maxPages)
        case "png", "jpg", "jpeg", "gif", "webp", "heic", "tif", "tiff", "bmp":
            guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
                  let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
            else { throw OCRError.unreadable(url.path) }
            let text = try recognize(image: image)
            return OCRResult(text: text, method: text.isEmpty ? "none" : "vision", pages: 1)
        case "svg":
            return OCRResult(text: "", method: "none", pages: 0)
        default:
            throw OCRError.unsupported(ext)
        }
    }

    /// The text Vision sees in an image, line by line in reading order.
    public static func recognize(image: CGImage) throws -> String {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = languages
        request.usesLanguageCorrection = true
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
        return lines.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: "\n")
    }

    static func recognizePDF(url: URL, maxPages: Int) throws -> OCRResult {
        guard let doc = PDFDocument(url: url) else { throw OCRError.unreadable(url.path) }
        let count = min(doc.pageCount, maxPages)
        var pages: [String] = []
        var usedText = false
        var usedVision = false
        for i in 0..<count {
            guard let page = doc.page(at: i) else { continue }
            let own = (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if own.count >= minPageText {
                pages.append(own)
                usedText = true
            } else if let image = render(page) {
                let seen = try recognize(image: image)
                if !seen.isEmpty {
                    pages.append(seen)
                    usedVision = true
                }
            }
        }
        let method = usedText && usedVision ? "pdf-text+vision" : usedText ? "pdf-text" : usedVision ? "vision" : "none"
        return OCRResult(text: pages.joined(separator: "\n\n"), method: method, pages: count)
    }

    /// A PDF page as pixels, at ~2x of its points (Vision reads small print better), capped at 3000 px on the long side.
    static func render(_ page: PDFPage) -> CGImage? {
        let box = page.bounds(for: .mediaBox)
        guard box.width > 0, box.height > 0 else { return nil }
        let scale = min(2.0, 3000 / max(box.width, box.height))
        let width = Int(box.width * scale), height = Int(box.height * scale)
        guard let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return nil }
        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
        ctx.scaleBy(x: scale, y: scale)
        ctx.translateBy(x: -box.minX, y: -box.minY)
        page.draw(with: .mediaBox, to: ctx)
        return ctx.makeImage()
    }
}
