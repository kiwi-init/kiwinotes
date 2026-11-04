import AppKit
import Foundation
import WebKit

/// O PDF de uma nota (T2684): o HTML que o app gera, aberto num WKWebView que nunca vai para a tela (sem janela) e
/// impresso com `createPDF`. Tudo local, sem rede: o HTML já vem com as imagens embutidas, e a navegação para fora é
/// bloqueada.
public enum PDFExport {
    public enum Failure: Error, CustomStringConvertible {
        case load(String)
        case timeout
        case empty

        public var description: String {
            switch self {
            case .load(let m): return "load failed: \(m)"
            case .timeout: return "timed out"
            case .empty: return "empty PDF"
            }
        }
    }

    /// A largura da página: A4 a 96 dpi, a mesma em que o CSS de leitura foi pensado.
    public static let pageWidth: CGFloat = 794

    /// O PDF do HTML em `htmlFile`. Roda no main actor (o WebKit pede), com um teto de `timeout` segundos.
    @MainActor
    public static func render(htmlFile: URL, timeout: TimeInterval = 30) async throws -> Data {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: pageWidth, height: 1123), configuration: config)
        let loader = Loader()
        view.navigationDelegate = loader
        view.loadFileURL(htmlFile, allowingReadAccessTo: htmlFile.deletingLastPathComponent())
        try await loader.wait(timeout: timeout)
        // A altura do conteúdo: o PDF sai numa página da altura da nota.
        let height = try await view.evaluateJavaScript("document.documentElement.scrollHeight") as? CGFloat ?? 1123
        view.frame = CGRect(x: 0, y: 0, width: pageWidth, height: max(height, 200))
        let pdf = WKPDFConfiguration()
        pdf.rect = CGRect(x: 0, y: 0, width: pageWidth, height: max(height, 200))
        let data = try await view.pdf(configuration: pdf)
        guard data.count > 0 else { throw Failure.empty }
        return data
    }

    /// Espera a página carregar, e corta qualquer navegação que não seja o próprio arquivo.
    @MainActor
    final class Loader: NSObject, WKNavigationDelegate {
        private var continuation: CheckedContinuation<Void, Error>?
        private var result: Result<Void, Error>?

        func wait(timeout: TimeInterval) async throws {
            if let result { return try result.get() }
            try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
                continuation = c
                DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [weak self] in self?.finish(.failure(Failure.timeout)) }
            }
        }

        private func finish(_ r: Result<Void, Error>) {
            if result != nil { return }
            result = r
            continuation?.resume(with: r)
            continuation = nil
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { finish(.success(())) }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            finish(.failure(Failure.load(error.localizedDescription)))
        }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            finish(.failure(Failure.load(error.localizedDescription)))
        }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            // Só o arquivo da nota (e os data: dele). Um link clicado ou um redirecionamento não sai do Mac.
            let url = action.request.url
            decisionHandler(url?.isFileURL == true || url?.scheme == "about" || url?.scheme == "data" ? .allow : .cancel)
        }
    }
}
