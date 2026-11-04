// WIP (T1727), PROTÓTIPO QUE AINDA NÃO FUNCIONA: o snapshot de um WKWebView numa janela que nunca vai para a frente
// sai PRETO (a janela não é composta). A escala 1x/2x pelo SPI _setOverrideDeviceScaleFactor: funciona (o PNG sai
// 1180x600 ou 2360x1200). Falta fazer o WebKit pintar sem mostrar janela na tela: por exemplo, a janela fora da área
// visível (frame em coordenadas negativas) com alphaValue 0 e orderFront, ou o NSView.cacheDisplay do webview.
//   swiftc -O app/scripts/webkit-shot.swift -o /tmp/webkit-shot
//   /tmp/webkit-shot <url> <saida.png> <1|2> <largura> <altura> [script-de-inicio.js]

// Print de uma página com o WebKit do macOS (o mesmo motor do app), sem janela na tela e sem ícone no Dock.
// shot <url> <saida.png> <escala 1|2> <largura> <altura> [script-de-inicio.js]
import AppKit
import WebKit

let a = CommandLine.arguments
let (url, out, scale, w, h) = (URL(string: a[1])!, a[2], CGFloat(Double(a[3])!), CGFloat(Double(a[4])!), CGFloat(Double(a[5])!))
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

let config = WKWebViewConfiguration()
if a.count > 6, let js = try? String(contentsOfFile: a[6], encoding: .utf8) {
  config.userContentController.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
}
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: w, height: h), configuration: config)
// O WebKit não tem API pública para forçar a escala: o SPI `_setOverrideDeviceScaleFactor:` (o mesmo que o Safari usa
// no modo de design responsivo). A chave KVC não existe (NSUnknownKeyException); o seletor sim.
let override = Selector(("_setOverrideDeviceScaleFactor:"))
guard web.responds(to: override) else { FileHandle.standardError.write(Data("sem _setOverrideDeviceScaleFactor:\n".utf8)); exit(3) }
typealias SetScale = @convention(c) (AnyObject, Selector, CGFloat) -> Void
unsafeBitCast(web.method(for: override), to: SetScale.self)(web, override, scale)
// Uma janela que nunca vai para a frente: o WebKit precisa dela para desenhar, mas nada aparece na tela.
let window = NSWindow(contentRect: web.frame, styleMask: [.borderless], backing: .buffered, defer: false)
window.contentView = web

final class Done: NSObject, WKNavigationDelegate {
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
      let c = WKSnapshotConfiguration()
      c.rect = webView.bounds
      webView.takeSnapshot(with: c) { image, error in
        guard let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else {
          FileHandle.standardError.write(Data("snapshot falhou: \(String(describing: error))\n".utf8)); exit(1)
        }
        try! png.write(to: URL(fileURLWithPath: out))
        print("\(out) \(rep.pixelsWide)x\(rep.pixelsHigh)")
        exit(0)
      }
    }
  }
}
let done = Done()
web.navigationDelegate = done
web.load(URLRequest(url: url))
DispatchQueue.main.asyncAfter(deadline: .now() + 20) { FileHandle.standardError.write(Data("tempo esgotado\n".utf8)); exit(2) }
app.run()
