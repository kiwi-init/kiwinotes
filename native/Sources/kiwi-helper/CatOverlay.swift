import AppKit
import KiwiHelperCore
import WebKit

/// O gato no overlay (spec #9810): uma janela do helper, igual à da pílula do ditado (`Overlay.swift`), com a página do
/// gato dentro. Por cima de tudo, em todos os Spaces e sobre apps em tela cheia, sem roubar o foco e deixando o clique
/// passar.
///
/// - `load` cria a janela fora da tela, já do tamanho certo (os símbolos medem o próprio tamanho ao nascer), e carrega a
///   página, que fica pronta e pausada. `unload` solta a página e o desenho.
/// - A página roda fechada: só os arquivos do app (o esquema `kiwi-cat://`, limitado à pasta, `CatPageScheme`), sem guardar dados
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
    /**
     A pessoa está com o balão (spec #13378): aberto no "ver mais" ou com o mouse em cima. O app segura a saída do gato
     enquanto ela lê.
     */
    var onHold: ((Bool) -> Void)?

    private var panel: CatOverlayPanel?
    private var web: WKWebView?
    private var gate = CatOverlayGate()
    private var estado = "acordou"
    private var fadeMs: Double = 180
    /// A cor da névoa (spec #9349), `rrggbb`: vai na URL do próximo `load` e à página aberta.
    private var cor: String?
    /// A posição e o tamanho (spec #12949): o tamanho da janela e a URL valem do próximo `load`; a posição, do próximo
    /// `present`.
    private var placement = CatPlacement()
    /// O balão (spec #12938), já como o argumento do script (`CatOverlayBubble`): vai junto quando o gato aparece e sai
    /// com ele.
    private var bubble = "null"
    /// A página terminou o carregamento inicial: daí em diante, nenhuma navegação é aceita.
    private var pageLoaded = false
    private var pendingLoad: URL?
    /// O balão na página (spec #13378), como ela o mede (a origem em cima, à esquerda), e se está aberto no "ver mais".
    private var bubbleRect: CGRect?
    private var bubbleOpen = false
    private var held = false
    private var mouseTimer: Timer?

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
        var parts = URLComponents()
        parts.scheme = CatPageScheme.scheme
        parts.host = CatPageScheme.host
        parts.path = "/index.html"
        parts.query = [query, cor.map { "cor=\($0)" }, placement.query].compactMap { $0 }.joined(separator: "&").nilIfEmpty
        guard let index = parts.url else { return "not_found" }
        if web != nil { unload() }
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        // Os arquivos do app por um esquema próprio: pelo `file://`, o WebKit recusa os módulos ES (a origem nula).
        config.setURLSchemeHandler(CatPageScheme(root: folder), forURLScheme: CatPageScheme.scheme)
        let size = placement.size
        // O balão diz à janela onde está e se abriu (spec #13378): só esses números, nada mais vem da página.
        config.userContentController.add(CatPageMessages(self), name: CatPageMessages.name)
        let view = CatWebView(frame: CGRect(origin: .zero, size: size), configuration: config)
        view.navigationDelegate = self
        view.setValue(false, forKey: "drawsBackground")
        web = view
        let panel = makePanel(size: size)
        panel.contentView = view
        self.panel = panel
        // A página só roda numa janela na frente: fora dela, o WebKit suspende o processo da página, e ela nem fica
        // pronta. A janela fica estacionada fora de todas as telas, transparente, e a página não se acha coberta.
        Self.keepRunningWhenCovered(view)
        park(panel)
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
                view.load(URLRequest(url: index))
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

    /// A fala pelo Control (spec #9876): o nível do mic, para as ondas do `ouvindo`; nil tira as ondas.
    func voice(_ level: Double?) {
        guard gate.shows else { return }
        let value = level.map { String(format: "%.3f", min(max($0, 0), 1)) } ?? "null"
        script("window.kiwiOverlay?.set({voz: \(value)})")
    }

    /// A posição e o tamanho do gato (spec #12949). Valem do próximo `load` (o app carrega de novo quando mudam); a
    /// janela continua sem pegar clique (`ignoresMouseEvents`, #504).
    func place(position: String?, scale: Double?) {
        placement = CatPlacement(position: CatPosition(setting: position), scale: scale ?? 1)
    }

    /// A cor da névoa (spec #9349): fica para o próximo `load` e, com a página aberta, troca na hora (a passagem de
    /// 400 ms do módulo). `false`: não é uma cor `#rrggbb`.
    func color(_ input: String) -> Bool {
        guard let hex = CatOverlayColor.normalized(input) else { return false }
        cor = hex
        script("window.kiwiOverlay?.set({cor: '#\(hex)'})")
        return true
    }

    /// O balão da resposta (spec #12938): `nil` tira. Com o gato esperando a pílula, ele aparece junto com o gato.
    func bubble(text: String?, error: Bool) {
        bubble = CatOverlayBubble.script(text: text, error: error)
        if gate.shows { script("window.kiwiOverlay?.set({bubble: \(bubble)})") }
    }

    func hide(fadeMs: Double) {
        self.fadeMs = fadeMs
        if gate.want(false) { dismiss() }
    }

    func unload() {
        _ = gate.want(false)
        bubble = "null"
        resetBubble()
        script("window.kiwiOverlay?.dispose()")
        panel?.orderOut(nil)
        parked = false
        web?.navigationDelegate = nil
        web?.configuration.userContentController.removeScriptMessageHandler(forName: CatPageMessages.name)
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
        if parked {
            // Sai do estacionamento já transparente: nada pisca no lugar.
            panel.alphaValue = 0
            parked = false
        }
        // A janela já tem o espaço do balão aberto (spec #13378): o "ver mais" não mexe nela.
        let frame = placement.windowFrame(visible: targetVisibleFrame())
        panel.setFrame(frame, display: false)
        let sala = Int(placement.bubbleRoom(in: frame))
        script("window.kiwiOverlay?.set({estado: '\(Self.safe(estado))', visible: true, sala: \(sala), bubble: \(bubble)})")
        if !panel.isVisible { panel.orderFrontRegardless() }
        animate(panel, to: 1, ms: fadeMs)
    }

    private func dismiss() {
        guard let panel, panel.isVisible, !parked else { return }
        // Pausa o desenho antes de a janela sumir; o balão sai com o gato.
        bubble = "null"
        resetBubble()
        script("window.kiwiOverlay?.set({visible: false, bubble: null})")
        animate(panel, to: 0, ms: fadeMs) { [weak self, weak panel] in
            guard let self, let panel, !self.gate.shows else { return }
            self.park(panel)
        }
    }

    // MARK: - o balão pega o clique (spec #13378)

    /// A página mediu o balão: `rect` nil é sem balão. Com ele na tela, a janela acompanha o mouse para pegar o clique
    /// só em cima dele (como o `LearnPanel`, #504).
    fileprivate func pageBubble(rect: CGRect?, open: Bool) {
        bubbleRect = rect
        bubbleOpen = rect != nil && open
        trackMouse(rect != nil && gate.shows)
        updateMouse()
    }

    private func resetBubble() {
        bubbleRect = nil
        bubbleOpen = false
        held = false
        trackMouse(false)
    }

    private func trackMouse(_ on: Bool) {
        guard on else {
            mouseTimer?.invalidate()
            mouseTimer = nil
            panel?.ignoresMouseEvents = true
            return
        }
        guard mouseTimer == nil else { return }
        let timer = Timer(timeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.updateMouse() }
        }
        RunLoop.main.add(timer, forMode: .common)
        mouseTimer = timer
    }

    private func updateMouse() {
        guard let panel, mouseTimer != nil else {
            setHeld(false)
            return
        }
        let take = CatOverlayBubble.takesClick(panel: panel.frame, rect: bubbleRect, mouse: NSEvent.mouseLocation)
        if panel.ignoresMouseEvents == take { panel.ignoresMouseEvents = !take }
        setHeld(bubbleOpen || take)
    }

    private func setHeld(_ on: Bool) {
        guard on != held else { return }
        held = on
        onHold?(on)
    }

    /// Entre os pedidos: fora de todas as telas e transparente, mas na frente, para a página seguir pronta (pausada).
    private var parked = false
    private func park(_ panel: NSPanel) {
        panel.alphaValue = 0
        panel.setFrameOrigin(CGPoint(x: -20_000, y: -20_000))
        panel.orderFrontRegardless()
        parked = true
    }

    /// Fora da tela, a janela conta como coberta, e o WebKit pararia a página (como uma aba escondida).
    private static func keepRunningWhenCovered(_ web: WKWebView) {
        let selector = NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")
        guard web.responds(to: selector) else { return }
        typealias Setter = @convention(c) (AnyObject, Selector, Bool) -> Void
        unsafeBitCast(web.method(for: selector), to: Setter.self)(web, selector, false)
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
        ["repouso", "acordou", "ouvindo", "thinking", "agindo", "pronto", "erro"].contains(estado) ? estado : "thinking"
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
        guard let panel else { return }
        panel.alphaValue = 1
    }

    // MARK: - WKNavigationDelegate: só o carregamento inicial da própria página

    nonisolated func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        MainActor.assumeIsolated {
            let url = action.request.url
            let initial = !pageLoaded && url?.scheme == CatPageScheme.scheme && url?.host == CatPageScheme.host
                && url?.path == pendingLoad?.path
            decisionHandler(initial ? .allow : .cancel)
            if !initial { log?("cat overlay: navigation refused: \(url?.scheme ?? "?")") }
        }
    }

    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        MainActor.assumeIsolated {
            pageLoaded = true
            // Pronta e pausada até o primeiro `show`.
            script("window.kiwiOverlay?.set({visible: false})")
            // Uma cor que chegou enquanto a página carregava (a URL leva a de antes).
            if let cor { script("window.kiwiOverlay?.set({cor: '#\(cor)'})") }
            if gate.shows { present() }
            onLoaded?()
        }
    }
}

/// A janela nunca vira a de teclado: o primeiro clique no balão ("ver mais") tem de valer (spec #13378).
final class CatWebView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

/// As mensagens da página (spec #13378): só o retângulo do balão e se ele está aberto. Fraco, para a página não segurar
/// o `CatOverlay` (o `WKUserContentController` segura quem recebe).
final class CatPageMessages: NSObject, WKScriptMessageHandler {
    static let name = "kiwiCat"
    private weak var overlay: CatOverlay?

    init(_ overlay: CatOverlay) { self.overlay = overlay }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        let body = message.body as? [String: Any]
        let rect = CatOverlayBubble.rect(body?["bubble"])
        let open = body?["open"] as? Bool ?? false
        MainActor.assumeIsolated { overlay?.pageBubble(rect: rect, open: open) }
    }
}

/// Nunca vira a janela principal nem a de teclado: o foco fica no app em que a pessoa digita.
final class CatOverlayPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
