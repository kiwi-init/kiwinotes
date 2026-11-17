import Foundation
import UniformTypeIdentifiers
import WebKit

/// Serve a página do gato no overlay (spec #9810) pelo esquema `kiwi-cat://overlay/…`, só com os arquivos de uma pasta
/// do app. Pelo `file://`, o WebKit recusa os módulos ES da página (a origem nula e o CORS); por um esquema próprio, a
/// página tem uma origem, e continua sem rede: este handler só lê a pasta e recusa o que estiver fora dela.
final class CatPageScheme: NSObject, WKURLSchemeHandler {
    static let scheme = "kiwi-cat"
    static let host = "overlay"

    private let root: URL

    init(root: URL) {
        self.root = root.standardizedFileURL.resolvingSymlinksInPath()
    }

    /// O arquivo de uma URL do esquema, só se ficar dentro da pasta; nil para o resto.
    func file(for url: URL?) -> URL? {
        guard let url, url.scheme == Self.scheme, url.host == Self.host else { return nil }
        let path = url.path.isEmpty || url.path == "/" ? "/index.html" : url.path
        let candidate = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL.resolvingSymlinksInPath()
        guard candidate.path.hasPrefix(root.path + "/") else { return nil }
        return candidate
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, let file = file(for: url), let data = try? Data(contentsOf: file) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let headers = ["Content-Type": mime, "Content-Length": String(data.count), "Cache-Control": "no-store"]
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
