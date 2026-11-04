import Foundation
import KiwiOCR

/// `kiwi-helper --ocr <file>…` (T2709): the text in each image or PDF, one JSON line per file, then exit.
/// `{"file", "text", "method", "pages", "ms"}`, or `{"file", "error"}` for one that can't be read. Exit 0 even when a
/// file fails (the others still count); 2 only for usage errors.
enum OCRFiles {
    static func run(_ paths: [String]) -> Int32 {
        for path in paths {
            let started = ProcessInfo.processInfo.systemUptime
            var line: [String: Any] = ["file": path]
            do {
                let r = try KiwiOCR.recognize(url: URL(fileURLWithPath: path))
                line["text"] = r.text
                line["method"] = r.method
                line["pages"] = r.pages
            } catch {
                line["error"] = String(describing: error)
            }
            line["ms"] = Int((ProcessInfo.processInfo.systemUptime - started) * 1000)
            if let data = try? JSONSerialization.data(withJSONObject: line), let s = String(data: data, encoding: .utf8) {
                print(s)
            }
        }
        return 0
    }
}
