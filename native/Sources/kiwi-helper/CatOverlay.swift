import AppKit
import KiwiHelperCore
import WebKit

/// O gato no overlay (spec #9810): uma janela do helper, igual à da pílula do ditado (`Overlay.swift`), com a página do
/// gato dentro. Por cima de tudo, em todos os Spaces e sobre apps em tela cheia, sem roubar o foco e deixando o clique
/// passar.
///
/// - `load` cria a janela fora da tela, já do tamanho certo (os símbolos medem o próprio tamanho ao nascer), e carrega a
///   página, que fica pronta e pausada. `unload` solta a página e o desenho.
/// - A página roda fechada: só os arquivos do app (`loadFileURL` limitado à pasta), sem guardar dados
///   (`nonPersistent`), toda a rede bloqueada (uma regra de conteúdo) e nenhuma navegação depois do carregamento.
/// - `show` entra a partir da opacidade de agora (um pedido novo durante a saída não pisca); `hide` pausa o desenho
///   antes de a janela sumir, sem depender do aviso de página escondida.
/// - Com a pílula do ditado na tela, o gato espera (`CatOverlayGate`).
@MainActor
final class CatOverlay: NSObject, WKNavigationDelegate {
    /// Desligado no `--headless`: nada aparece na tela.
    var enabled = true
    var log: ((String) -> Void)?
    /** A página terminou o carregamento inicial (para o `--cat-probe`). */
    var onLoaded: (() -> Void)?

    private var panel: CatOverlayPanel?
    private var web: WKWebView?
    private var gate = CatOverlayGate()
    private var estado = "acordou"
    private var fadeMs: Double = 180
    /// A página terminou o carregamento inicial: daí em diante, nenhuma navegação é aceita.
    private var pageLoaded = false
    private var pendingLoad: URL?

    /// Toda a rede bloqueada, inclusive o WebSocket: a página só usa os arquivos do app. Uma regra por esquema: o
    /// WebKit não aceita `|` no `url-filter` (a lista inteira falha, e a página não carrega).
    private static let blockAll = """
    [{"trigger":{"url-filter":"^https?://"},"action":{"type":"block"}},
     {"trigger":{"url-filter":"^wss?://"},"action":{"type":"block"}},
     {"trigger":{"url-filter":"^ftp://"},"action":{"type":"block"}}]
    """

    /// `query`: só o `--cat-probe` usa (`backend=webgl2|none`, para provar cada caminho do desenho).
    func load(dir: String, query: String? = nil) -> String? {
        guard enabled else { return nil }
        let folder = URL(fileURLWithPath: dir, isDirectory: true).standardizedFileURL
        let file = folder.appendingPathComponent("index.html")
        guard FileManager.default.fileExists(atPath: file.path) else { return "not_found" }
        var parts = URLComponents(url: file, resolvingAgainstBaseURL: false)
        parts?.query = query
        let index = parts?.url ?? file
        if web != nil { unload() }
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        let size = CatOverlayLayout.size
        let view = WKWebView(frame: CGRect(origin: .zero, size: size), configuration: config)
        view.navigationDelegate = self
        view.setValue(false, forKey: "drawsBackground")
        web = view
        let panel = makePanel(size: size)
        panel.contentView = view
        self.panel = panel
        pageLoaded = false
        pendingLoad = index
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "kiwi-cat-overlay-no-network", encodedContentRuleList: Self.blockAll) { [weak self] list, error in
            MainActor.assumeIsolated {
                guard let self, let view = self.web, self.pendingLoad == index else { return }
                guard let list else {
                    // Sem a regra, a página não carrega: nunca roda com rede.
                    self.log?("cat overlay: rule list failed: \(error?.localizedDescription ?? "?")")
                    return
                }
                view.configuration.userContentController.add(list)
                view.loadFileURL(index, allowingReadAccessTo: folder)
            }
        }
        return nil
    }

    func show(estado: String, fadeMs: Double) {
        self.estado = estado
        self.fadeMs = fadeMs
        if gate.want(true) || gate.shows { present() }
    }

    func state(estado: String) {
        self.estado = estado
        if gate.shows { script("window.kiwiOverlay?.set({estado: '\(Self.safe(estado))', visible: true})") }
    }

    func hide(fadeMs: Double) {
        self.fadeMs = fadeMs
        if gate.want(false) { dismiss() }
    }

    func unload() {
        _ = gate.want(false)
        script("window.kiwiOverlay?.dispose()")
        panel?.orderOut(nil)
        web?.navigationDelegate = nil
        web?.stopLoading()
        web = nil
        panel = nil
        pageLoaded = false
        pendingLoad = nil
    }

    /// A pílula do ditado entrou ou saiu: ela tem a vez.
    func setPillVisible(_ visible: Bool) {
        guard gate.pill(visible) else { return }
        if gate.shows { present() } else { dismiss() }
    }

    // MARK: - a janela

    private func present() {
        guard enabled, let panel else { return }
        panel.setFrame(CatOverlayLayout.frame(visible: targetVisibleFrame()), display: false)
        script("window.kiwiOverlay?.set({estado: '\(Self.safe(estado))', visible: true})")
        if !panel.isVisible {
            panel.alphaValue = 0
            panel.orderFrontRegardless()
        }
        animate(panel, to: 1, ms: fadeMs)
    }

    private func dismiss() {
        guard let panel, panel.isVisible else { return }
        // Pausa o desenho antes de a janela sumir.
        script("window.kiwiOverlay?.set({visible: false})")
        animate(panel, to: 0, ms: fadeMs) { [weak self, weak panel] in
            guard let self, let panel, !self.gate.shows else { return }
            panel.orderOut(nil)
        }
    }

    /// Anima a partir da opacidade de agora: uma volta no meio da saída não pisca. Com o Reduzir movimento, sem
    /// animação, nos mesmos tempos.
    private func animate(_ panel: NSPanel, to alpha: CGFloat, ms: Double, done: (() -> Void)? = nil) {
        let reduced = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        if reduced || ms <= 0 {
            let apply = { panel.alphaValue = alpha; done?() }
            if ms > 0 { DispatchQueue.main.asyncAfter(deadline: .now() + ms / 1000) { apply() } } else { apply() }
            return
        }
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = ms / 1000
            ctx.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            panel.animator().alphaValue = alpha
        }, completionHandler: { MainActor.assumeIsolated { done?() } })
    }

    /// A área útil da tela em que a pessoa trabalha: a da janela do app da frente (sem permissão nova: só os limites
    /// das janelas), senão a do mouse.
    private func targetVisibleFrame() -> CGRect {
        let screens = NSScreen.screens
        let frames = screens.map(\.frame)
        let index = CatOverlayLayout.screen(screens: frames, frontWindow: frontWindowFrame(), mouse: NSEvent.mouseLocation)
        return index.map { screens[$0].visibleFrame } ?? NSScreen.main?.visibleFrame ?? .zero
    }

    /// A maior janela do app da frente, em coordenadas do AppKit (origem embaixo à esquerda).
    private func frontWindowFrame() -> CGRect? {
        guard let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier,
              let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
        else { return nil }
        let top = NSScreen.screens.first?.frame.maxY ?? 0
        let rects = list.compactMap { info -> CGRect? in
            guard (info[kCGWindowOwnerPID as String] as? pid_t) == pid, (info[kCGWindowLayer as String] as? Int) == 0,
                  let b = info[kCGWindowBounds as String] as? [String: CGFloat],
                  let x = b["X"], let y = b["Y"], let w = b["Width"], let h = b["Height"] else { return nil }
            return CGRect(x: x, y: top - y - h, width: w, height: h)
        }
        return rects.max { $0.width * $0.height < $1.width * $1.height }
    }

    private func makePanel(size: CGSize) -> CatOverlayPanel {
        let panel = CatOverlayPanel(
            contentRect: CGRect(origin: CGPoint(x: -10_000, y: -10_000), size: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.animationBehavior = .none
        // O gato aparece na gravação de tela como o resto da tela (nada de esconder de quem grava a reunião).
        panel.sharingType = .readOnly
        return panel
    }

    private func script(_ js: String) {
        guard pageLoaded, let web else { return }
        web.evaluateJavaScript(js, completionHandler: nil)
    }

    /// Só os nomes de estado conhecidos chegam ao script.
    private static func safe(_ estado: String) -> String {
        ["repouso", "acordou", "thinking", "agindo", "pronto", "erro"].contains(estado) ? estado : "thinking"
    }

    // MARK: - o `--cat-probe` (a prova da página fechada e a medida, fora da tela)

    /// Roda um script na página e espera o resultado (uma Promise também).
    func evaluate(_ js: String) async throws -> Any? {
        guard let web else { return nil }
        return try await web.callAsyncJavaScript(js, arguments: [:], in: nil, contentWorld: .page)
    }

    /// Põe a janela na frente, mas fora de todas as telas: o WebKit desenha como se o gato estivesse à vista, e nada
    /// aparece na tela de ninguém.
    func showOffscreen() {
        guard let panel, let web else { return }
        // Fora da tela, a janela conta como coberta, e o WebKit pararia o desenho (a página escondida).
        let selector = NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")
        if web.responds(to: selector) {
            typealias Setter = @convention(c) (AnyObject, Selector, Bool) -> Void
            unsafeBitCast(web.method(for: selector), to: Setter.self)(web, selector, false)
        }
        panel.setFrameOrigin(CGPoint(x: -20_000, y: -20_000))
        panel.alphaValue = 1
        panel.orderFrontRegardless()
    }

    // MARK: - WKNavigationDelegate: só o carregamento inicial da própria página

    nonisolated func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        MainActor.assumeIsolated {
            let url = action.request.url
            let initial = !pageLoaded && url?.isFileURL == true && url?.standardizedFileURL.path == pendingLoad?.standardizedFileURL.path
            decisionHandler(initial ? .allow : .cancel)
            if !initial { log?("cat overlay: navigation refused: \(url?.scheme ?? "?")") }
        }
    }

    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        MainActor.assumeIsolated {
            pageLoaded = true
            // Pronta e pausada até o primeiro `show`.
            script("window.kiwiOverlay?.set({visible: false})")
            if gate.shows { present() }
            onLoaded?()
        }
    }
}

/// Nunca vira a janela principal nem a de teclado: o foco fica no app em que a pessoa digita.
final class CatOverlayPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}
