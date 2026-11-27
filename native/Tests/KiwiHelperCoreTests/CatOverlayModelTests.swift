import CoreGraphics
import XCTest
@testable import KiwiHelperCore

/// O gato no overlay (spec #9810): o lugar na tela e a vez da pílula do ditado.
final class CatOverlayModelTests: XCTestCase {
    func testCenteredOnTheVisibleArea() {
        let visible = CGRect(x: 0, y: 80, width: 1512, height: 870)
        let f = CatOverlayLayout.frame(visible: visible)
        // O gato (192 × 240) embaixo e o balão (spec #12938) em cima: o gato continua no centro.
        XCTAssertEqual(CatOverlayLayout.catSize, CGSize(width: 192, height: 240))
        XCTAssertEqual(f.size, CGSize(width: 300, height: 352))
        XCTAssertEqual(f.midX, visible.midX, accuracy: 1)
        XCTAssertEqual(f.minY + 120, visible.midY, accuracy: 1)
    }

    /// Spec #12949: as seis posições nos dois limites de tamanho, em três telas (a do notebook, uma pequena e uma à
    /// esquerda da principal): a janela, o gato e o balão dentro da área útil, e o gato encostado no canto pedido.
    func testSixPositionsAtBothSizeLimitsStayInsideTheVisibleArea() {
        let screens = [
            CGRect(x: 0, y: 80, width: 1512, height: 870),
            CGRect(x: 0, y: 70, width: 1280, height: 650),
            CGRect(x: -1920, y: 0, width: 1920, height: 1055),
        ]
        let m = CatPlacement.margin
        for visible in screens {
            for position in CatPosition.allCases {
                for scale in [0.6, 1.6] {
                    let p = CatPlacement(position: position, scale: scale)
                    let f = p.frame(visible: visible)
                    let cat = p.catRect(in: f)
                    let bubble = p.bubbleRect(in: f)
                    let what = "\(position.rawValue) \(scale) em \(visible)"
                    XCTAssertTrue(visible.contains(f), "janela fora: \(what)")
                    XCTAssertTrue(visible.contains(cat), "gato fora: \(what)")
                    XCTAssertTrue(visible.contains(bubble), "balão fora: \(what)")
                    XCTAssertFalse(cat.intersects(bubble), "balão em cima do gato: \(what)")
                    XCTAssertEqual(cat.size, CGSize(width: (192 * scale).rounded(), height: (240 * scale).rounded()), what)
                    switch position {
                    case .topLeft:
                        XCTAssertEqual(cat.minX, visible.minX + m, accuracy: 1, what)
                        XCTAssertEqual(cat.maxY, visible.maxY - m, accuracy: 1, what)
                    case .topRight:
                        XCTAssertEqual(cat.maxX, visible.maxX - m, accuracy: 1, what)
                        XCTAssertEqual(cat.maxY, visible.maxY - m, accuracy: 1, what)
                    case .bottomLeft:
                        XCTAssertEqual(cat.minX, visible.minX + m, accuracy: 1, what)
                        XCTAssertEqual(cat.minY, visible.minY + m, accuracy: 1, what)
                    case .bottomRight:
                        XCTAssertEqual(cat.maxX, visible.maxX - m, accuracy: 1, what)
                        XCTAssertEqual(cat.minY, visible.minY + m, accuracy: 1, what)
                    case .bottomCenter:
                        XCTAssertEqual(cat.midX, visible.midX, accuracy: 1, what)
                        XCTAssertEqual(cat.minY, visible.minY + m, accuracy: 1, what)
                    case .center:
                        XCTAssertEqual(cat.midX, visible.midX, accuracy: 1, what)
                        XCTAssertEqual(cat.midY, visible.midY, accuracy: 1, what)
                    }
                    XCTAssertEqual(bubble.minY < cat.minY, position == .topLeft || position == .topRight, "o balão vai embaixo só nos cantos de cima: \(what)")
                }
            }
        }
    }

    /// Spec #13378: a janela já tem o espaço do balão aberto. Nas seis posições, nos dois limites de tamanho e nas três
    /// telas, o gato fica onde estava, e o balão aberto (até 360 pt) fica dentro da área útil, sem cobrir o gato.
    func testOpenBubbleRoomStaysInsideTheVisibleAreaAndTheCatDoesNotMove() {
        let screens = [
            CGRect(x: 0, y: 80, width: 1512, height: 870),
            CGRect(x: 0, y: 70, width: 1280, height: 650),
            CGRect(x: -1920, y: 0, width: 1920, height: 1055),
        ]
        for visible in screens {
            for position in CatPosition.allCases {
                for scale in [0.6, 1.6] {
                    let p = CatPlacement(position: position, scale: scale)
                    let closed = p.frame(visible: visible)
                    let window = p.windowFrame(visible: visible)
                    let cat = p.catRect(in: window)
                    let bubble = p.bubbleRect(in: window)
                    let what = "\(position.rawValue) \(scale) em \(visible)"
                    XCTAssertEqual(cat, p.catRect(in: closed), "o gato saiu do lugar: \(what)")
                    XCTAssertTrue(visible.contains(window), "janela fora: \(what)")
                    XCTAssertTrue(visible.contains(bubble), "balão aberto fora: \(what)")
                    XCTAssertFalse(cat.intersects(bubble), "balão aberto em cima do gato: \(what)")
                    XCTAssertGreaterThanOrEqual(bubble.height, CatOverlayLayout.bubbleHeight, what)
                    XCTAssertLessThanOrEqual(bubble.height, CatPlacement.openBubbleMaxHeight, what)
                    XCTAssertEqual(bubble.minY < cat.minY, p.bubbleBelow, what)
                    if visible.height >= 870, scale == 0.6 {
                        XCTAssertEqual(bubble.height, CatPlacement.openBubbleMaxHeight, "com espaço, o tamanho máximo: \(what)")
                    }
                }
            }
        }
        // Sem espaço para o máximo (o centro, 1,6×, na tela pequena): o balão vai até a borda da área útil.
        let small = CGRect(x: 0, y: 70, width: 1280, height: 650)
        let big = CatPlacement(position: .center, scale: 1.6)
        XCTAssertEqual(big.windowFrame(visible: small).maxY, small.maxY, accuracy: 1)
    }

    /// Spec #17673 (harry): o balão aberto cresce para o lado, para longe do gato, até a casca de 480, sem passar da
    /// área útil; o gato não sai do lugar, e a página recebe a largura (`largura`) de 280 a 480.
    func testOpenBubbleGrowsSidewaysAwayFromTheCat() {
        let screens = [
            CGRect(x: 0, y: 80, width: 1512, height: 870),
            CGRect(x: 0, y: 70, width: 1280, height: 650),
            CGRect(x: -1920, y: 0, width: 1920, height: 1055),
            CGRect(x: 0, y: 0, width: 700, height: 870),
        ]
        for visible in screens {
            for position in CatPosition.allCases {
                for scale in [0.6, 1, 1.6] {
                    let p = CatPlacement(position: position, scale: scale)
                    let closed = p.frame(visible: visible)
                    let window = p.windowFrame(visible: visible)
                    let bubble = p.bubbleRect(in: window)
                    let cat = p.catRect(in: window)
                    let shell = p.openShellWidth(in: window)
                    let what = "\(position.rawValue) \(scale) em \(visible)"
                    XCTAssertTrue(visible.contains(window), "janela fora: \(what)")
                    XCTAssertEqual(cat, p.catRect(in: closed), "o gato saiu do lugar: \(what)")
                    XCTAssertFalse(cat.intersects(bubble), "balão em cima do gato: \(what)")
                    XCTAssertGreaterThanOrEqual(shell, 280, what)
                    XCTAssertLessThanOrEqual(shell, 480, what)
                    XCTAssertEqual(bubble.width, shell + CatPlacement.bubbleShellInset, accuracy: 0.5, what)
                    // Cresce para longe do gato: o lado do gato fica onde estava.
                    if p.bubbleLeft { XCTAssertEqual(window.maxX, closed.maxX, what) } else { XCTAssertEqual(window.minX, closed.minX, what) }
                    if visible.width >= 1280 { XCTAssertEqual(shell, 480, "com espaço, a casca larga: \(what)") }
                }
            }
        }
        // Sem espaço do lado do balão, ele fica entre 280 e 480, colado na borda da área útil.
        let narrow = CGRect(x: 0, y: 0, width: 700, height: 870)
        let center = CatPlacement(position: .center, scale: 1.6)
        let w = center.windowFrame(visible: narrow)
        XCTAssertEqual(w.minX, narrow.minX)
        XCTAssertLessThan(center.openShellWidth(in: w), 480)
    }

    /// T16754 (harry #16786): o balão fica do lado do gato, com a ponta do rabo (7,5 pt para dentro da quina) na borda do
    /// corpo dele, e a janela tem a largura do gato e do que o balão passa dele, a mesma da página (`placement.ts`).
    func testTheBubbleCornerTouchesTheCatBody() {
        let visible = CGRect(x: 0, y: 80, width: 1512, height: 870)
        let L = CatOverlayLayout.self
        for position in CatPosition.allCases {
            for scale in [0.6, 1, 1.6] {
                let p = CatPlacement(position: position, scale: scale)
                let f = p.windowFrame(visible: visible)
                let cat = p.catRect(in: f)
                let bubble = p.bubbleRect(in: f)
                let what = "\(position.rawValue) \(scale)"
                XCTAssertEqual(p.bubbleLeft, !(position == .topLeft || position == .bottomLeft), what)
                let tip = p.bubbleLeft ? bubble.maxX - L.tailTipX : bubble.minX + L.tailTipX
                let edge = cat.minX + cat.width * (p.bubbleLeft ? L.bodyX0 : L.bodyX1)
                XCTAssertEqual(tip, edge, accuracy: 0.5, "a ponta na borda do corpo: \(what)")
                XCTAssertGreaterThanOrEqual(bubble.minX, f.minX - 0.5, "o balão dentro da janela: \(what)")
                XCTAssertLessThanOrEqual(bubble.maxX, f.maxX + 0.5, "o balão dentro da janela: \(what)")
                XCTAssertEqual(p.frame(visible: visible).width, cat.width + p.overhang, what)
                XCTAssertEqual(f.width - p.size.width, p.openShellWidth(in: f) - 280, what)
            }
        }
        // As larguras que a página também calcula (placement.test.ts): 1× no centro, 1,6× à esquerda, 0,6× à direita.
        XCTAssertEqual(CatPlacement(position: .center, scale: 1).size.width, 192 + 239)
        XCTAssertEqual(CatPlacement(position: .topLeft, scale: 1.6).size.width, 307 + 213)
        XCTAssertEqual(CatPlacement(position: .bottomRight, scale: 0.6).size.width, 115 + 261)
    }

    /// Spec #17679: o link do balão só abre com http(s) (com host) e mailto; o resto não abre.
    func testBubbleLinkOnlyOpensWebAndMail() {
        XCTAssertEqual(CatOverlayBubble.link("https://exemplo.com/a?b=1")?.absoluteString, "https://exemplo.com/a?b=1")
        XCTAssertEqual(CatOverlayBubble.link("HTTP://exemplo.com")?.host, "exemplo.com")
        XCTAssertEqual(CatOverlayBubble.link("mailto:ana@exemplo.com")?.scheme, "mailto")
        for bad: Any? in ["javascript:alert(1)", "file:///etc/passwd", "kiwinotes://x", "https://", "mailto:", "", "exemplo.com",
                          String(repeating: "a", count: 3000), 42, nil] {
            XCTAssertNil(CatOverlayBubble.link(bad), "\(String(describing: bad))")
        }
    }

    /// Spec #17683: os links de caminho vão à página só com a forma certa, e o clique só abre um deles.
    func testBubblePathLinksAndOpenPath() {
        let good: [String: Any] = ["text": "Plano.md", "from": 5, "to": 13, "path": "Plano.md", "kind": "note"]
        let list: [Any] = [
            good,
            ["text": "x", "from": 0, "to": 1, "path": "/etc/hosts", "kind": "file"],
            ["text": "x", "from": 0, "to": 1, "path": "../fora.pdf", "kind": "file"],
            ["text": "x", "from": 0, "to": 1, "path": "a.pdf", "kind": "app"],
            ["text": "x", "from": 3, "to": 99, "path": "a.pdf", "kind": "file"],
            ["text": "x", "from": 2, "to": 2, "path": "a.pdf", "kind": "file"],
            "lixo",
        ]
        let links = CatOverlayBubble.links(list, textLength: 14)
        XCTAssertEqual(links.count, 1)
        XCTAssertEqual(links.first?["path"] as? String, "Plano.md")
        XCTAssertTrue(CatOverlayBubble.links(nil, textLength: 10).isEmpty)
        XCTAssertEqual(CatOverlayBubble.links(Array(repeating: good, count: 80), textLength: 14).count, 50)
        let script = CatOverlayBubble.script(text: "Veja Plano.md.", error: false, links: links)
        XCTAssertTrue(script.contains("\"links\":[{"), script)
        XCTAssertFalse(CatOverlayBubble.script(text: "Oi", error: false).contains("links"))
        XCTAssertEqual(CatOverlayBubble.openPath("Plano.md", shown: ["Plano.md"]), "Plano.md")
        for bad: Any? in ["Outra.md", "../Plano.md", "/Plano.md", "", 42, nil] {
            XCTAssertNil(CatOverlayBubble.openPath(bad, shown: ["Plano.md", "../Plano.md", "/Plano.md", ""]), "\(String(describing: bad))")
        }
    }

    /// Spec #13378 e #504: só o balão pega o clique; o gato e o espaço transparente deixam passar.
    func testOnlyTheBubbleTakesTheClick() {
        let panel = CGRect(x: 100, y: 100, width: 300, height: 600)
        // O balão na página: 20 pt da esquerda e 200 pt do topo, 240 × 80 (a origem da página é em cima).
        let rect = CatOverlayBubble.rect(["x": 20, "y": 200, "w": 240, "h": 80])
        XCTAssertEqual(rect, CGRect(x: 20, y: 200, width: 240, height: 80))
        // Na tela (a origem embaixo): x de 120 a 360, y de 700 − 280 = 420 a 500.
        XCTAssertTrue(CatOverlayBubble.takesClick(panel: panel, rect: rect, mouse: CGPoint(x: 200, y: 460)))
        XCTAssertFalse(CatOverlayBubble.takesClick(panel: panel, rect: rect, mouse: CGPoint(x: 380, y: 460)), "ao lado do balão")
        XCTAssertFalse(CatOverlayBubble.takesClick(panel: panel, rect: rect, mouse: CGPoint(x: 200, y: 200)), "o gato")
        XCTAssertFalse(CatOverlayBubble.takesClick(panel: panel, rect: rect, mouse: CGPoint(x: 200, y: 650)), "o espaço vazio")
        XCTAssertFalse(CatOverlayBubble.takesClick(panel: panel, rect: nil, mouse: CGPoint(x: 200, y: 460)), "sem balão")
        XCTAssertNil(CatOverlayBubble.rect(nil))
        XCTAssertNil(CatOverlayBubble.rect(["x": 0, "y": 0, "w": 0, "h": 10]))
        XCTAssertNil(CatOverlayBubble.rect(["x": 0, "y": 0, "w": "100", "h": 10]))
        XCTAssertNil(CatOverlayBubble.rect(["x": Double.nan, "y": 0, "w": 10, "h": 10]))
    }

    /// Spec #32534 (#32777): o Esc só é engolido com um balão à vista e o mouse no gato ou nele.
    func testTheEscapeIsTakenOnlyWithABubbleAndTheMouseOnIt() {
        XCTAssertTrue(CatOverlayBubble.escapeArmed(bubbleShown: true, catHover: true, overBubble: false))
        XCTAssertTrue(CatOverlayBubble.escapeArmed(bubbleShown: true, catHover: false, overBubble: true))
        XCTAssertFalse(CatOverlayBubble.escapeArmed(bubbleShown: true, catHover: false, overBubble: false), "o mouse longe")
        XCTAssertFalse(CatOverlayBubble.escapeArmed(bubbleShown: false, catHover: true, overBubble: false), "nada para fechar")
    }

    /// Spec #32534 (Cena 3): o mouse no Kiwi com o balão à vista segura o relógio, como o mouse no balão.
    func testTheMouseOnTheKiwiWithABubbleHoldsTheClock() {
        XCTAssertTrue(CatOverlayBubble.holds(open: false, overBubble: false, catHover: true, bubbleShown: true))
        XCTAssertTrue(CatOverlayBubble.holds(open: false, overBubble: true, catHover: false, bubbleShown: true))
        XCTAssertTrue(CatOverlayBubble.holds(open: true, overBubble: false, catHover: false, bubbleShown: true), "o Ver mais aberto")
        XCTAssertFalse(CatOverlayBubble.holds(open: false, overBubble: false, catHover: false, bubbleShown: true), "o mouse longe")
        XCTAssertFalse(CatOverlayBubble.holds(open: false, overBubble: false, catHover: true, bubbleShown: false), "sem balão, nada a segurar")
    }

    /// Spec #32534: com o "Ver mais" aberto, o clique fora é o botão que desce agora, longe do balão.
    func testAClickOutsideIsTheButtonGoingDownAwayFromTheBubble() {
        XCTAssertTrue(CatOverlayBubble.clickedOutside(open: true, pressed: true, wasPressed: false, overBubble: false))
        XCTAssertFalse(CatOverlayBubble.clickedOutside(open: true, pressed: true, wasPressed: false, overBubble: true), "no balão")
        XCTAssertFalse(CatOverlayBubble.clickedOutside(open: true, pressed: true, wasPressed: true, overBubble: false), "o mesmo clique, ainda descido")
        XCTAssertFalse(CatOverlayBubble.clickedOutside(open: false, pressed: true, wasPressed: false, overBubble: false), "fechado")
        XCTAssertFalse(CatOverlayBubble.clickedOutside(open: true, pressed: false, wasPressed: true, overBubble: false), "o botão subindo")
    }

    /// Spec #13380: o × da cabeça aparece com o mouse sobre o gato e continua enquanto ele vai até o ×.
    func testTheHeadCloseShowsOverTheCatAndStaysOnTheWayToIt() {
        let panel = CGRect(x: 100, y: 100, width: 300, height: 600)
        let cat = CGRect(x: 154, y: 100, width: 192, height: 240)
        // O × na página: 250 pt da esquerda, 370 do topo, 26 × 26; na tela, x 350–376, y 304–330 (700 − 396).
        let close = CGRect(x: 250, y: 370, width: 26, height: 26)
        XCTAssertTrue(CatOverlayBubble.catHover(panel: panel, cat: cat, close: nil, showing: false, mouse: CGPoint(x: 250, y: 200)))
        XCTAssertFalse(CatOverlayBubble.catHover(panel: panel, cat: cat, close: nil, showing: false, mouse: CGPoint(x: 250, y: 500)), "o espaço do balão")
        XCTAssertTrue(CatOverlayBubble.catHover(panel: panel, cat: cat, close: close, showing: true, mouse: CGPoint(x: 360, y: 315)), "em cima do ×, fora do gato")
        XCTAssertFalse(CatOverlayBubble.catHover(panel: panel, cat: cat, close: close, showing: false, mouse: CGPoint(x: 360, y: 315)), "o × escondido não segura")
    }

    func testTheBubbleCarriesTheQuestion() throws {
        let js = CatOverlayBubble.script(text: "Pronto.", error: false, ask: true)
        let back = try JSONSerialization.jsonObject(with: Data(js.utf8)) as? [String: Any]
        XCTAssertEqual(back?["ask"] as? Bool, true)
        XCTAssertFalse(CatOverlayBubble.script(text: "Pronto.", error: false).contains("ask"))
    }

    func testBubbleScriptCarriesTheSummary() throws {
        // O resumo do balão fechado (spec #27881): vai quando é diferente do texto aberto; igual ou vazio, não vai.
        let js = CatOverlayBubble.script(text: "Antes.\n\nAchei a nota.", error: false, summary: "Achei a nota.")
        let back = try JSONSerialization.jsonObject(with: Data(js.utf8)) as? [String: Any]
        XCTAssertEqual(back?["summary"] as? String, "Achei a nota.")
        XCTAssertFalse(CatOverlayBubble.script(text: "Pronto.", error: false, summary: "Pronto.").contains("summary"))
        XCTAssertFalse(CatOverlayBubble.script(text: "Pronto.", error: false, summary: "").contains("summary"))
    }

    func testBubbleScriptCarriesTheProgressAndWhatWasHeard() throws {
        // O andamento (spec #32534, T33177): o [Parar] e o que a pessoa falou vão só quando vêm; o texto, como dado.
        let js = CatOverlayBubble.script(text: "Lendo 2 notas", error: false, progress: true, heard: "“resume \"isso\"</script>”")
        let back = try JSONSerialization.jsonObject(with: Data(js.utf8)) as? [String: Any]
        XCTAssertEqual(back?["progress"] as? Bool, true)
        XCTAssertEqual(back?["heard"] as? String, "“resume \"isso\"</script>”")
        let plain = CatOverlayBubble.script(text: "Pronto.", error: false, heard: "")
        XCTAssertFalse(plain.contains("progress"))
        XCTAssertFalse(plain.contains("heard"))
    }

    func testDefaultIsTodayAndOutOfRangeIsClamped() {
        let visible = CGRect(x: 0, y: 80, width: 1512, height: 870)
        // O gato no mesmo lugar de antes; a janela agora é mais larga do lado do balão (T16754).
        let legacy = CatOverlayLayout.frame(visible: visible)
        XCTAssertEqual(CatPlacement().catRect(in: CatPlacement().frame(visible: visible)), CGRect(x: legacy.midX - 96, y: legacy.minY, width: 192, height: 240))
        XCTAssertEqual(CatPosition(setting: "nada"), .center)
        XCTAssertEqual(CatPosition(setting: nil), .center)
        XCTAssertEqual(CatPosition(setting: "top-right"), .topRight)
        XCTAssertEqual(CatPlacement(scale: 0.1).scale, 0.6)
        XCTAssertEqual(CatPlacement(scale: 9).scale, 1.6)
        XCTAssertEqual(CatPlacement(scale: .nan).scale, 1)
        XCTAssertEqual(CatPlacement(position: .topLeft, scale: 1.25).query, "escala=1.25&lado=left&balao=abaixo")
        XCTAssertEqual(CatPlacement().query, "escala=1.00&lado=center&balao=acima")
    }

    func testBubbleIsAJSONLiteralNeverScript() throws {
        XCTAssertEqual(CatOverlayBubble.script(text: nil, error: false), "null")
        XCTAssertEqual(CatOverlayBubble.script(text: "", error: false), "null")
        let hostile = "Tudo \"bem\"? '); alert(1); //\n</script>\u{2028}fim"
        let js = CatOverlayBubble.script(text: hostile, error: true)
        XCTAssertFalse(js.contains("\u{2028}"))
        let back = try JSONSerialization.jsonObject(with: Data(js.utf8)) as? [String: Any]
        XCTAssertEqual(back?["text"] as? String, hostile)
        XCTAssertEqual(back?["error"] as? Bool, true)
    }

    func testScreenOfTheFrontWindowThenMouseThenFirst() {
        let left = CGRect(x: 0, y: 0, width: 1512, height: 982)
        let right = CGRect(x: 1512, y: 0, width: 2560, height: 1440)
        // A janela da frente está quase toda na tela da direita.
        XCTAssertEqual(CatOverlayLayout.screen(screens: [left, right], frontWindow: CGRect(x: 1400, y: 100, width: 1200, height: 800), mouse: CGPoint(x: 10, y: 10)), 1)
        // Sem janela: a tela do mouse.
        XCTAssertEqual(CatOverlayLayout.screen(screens: [left, right], frontWindow: nil, mouse: CGPoint(x: 2000, y: 500)), 1)
        // Sem nada: a primeira.
        XCTAssertEqual(CatOverlayLayout.screen(screens: [left, right], frontWindow: nil, mouse: nil), 0)
        XCTAssertNil(CatOverlayLayout.screen(screens: [], frontWindow: nil, mouse: nil))
    }

    func testThePillGoesFirst() {
        var gate = CatOverlayGate()
        XCTAssertFalse(gate.shows)
        // A pílula na tela: o pedido do app espera.
        XCTAssertFalse(gate.pill(true))
        XCTAssertFalse(gate.want(true))
        XCTAssertFalse(gate.shows)
        // A pílula sai: o gato entra.
        XCTAssertTrue(gate.pill(false))
        XCTAssertTrue(gate.shows)
        // A pílula volta no meio: o gato sai e volta depois.
        XCTAssertTrue(gate.pill(true))
        XCTAssertFalse(gate.shows)
        XCTAssertTrue(gate.pill(false))
        // O app esconde: some.
        XCTAssertTrue(gate.want(false))
        XCTAssertFalse(gate.shows)
    }
}

final class CatOverlayColorTests: XCTestCase {
    func testOnlyPaletteIdsPass() {
        for id in ["prisma-original", "kiwi-neon", "ambar-solar", "soul-claro", "nevoa-violeta"] {
            XCTAssertEqual(CatOverlayColor.normalized(id), id)
        }
        for bad in ["", "#ff9b5e", "Kiwi-Neon", "kiwi_neon", "-kiwi", "kiwi-", "kiwi--neon", "kiwi neon", "kiwi');alert(1)//",
                    "ãmbar", "ｋｉｗｉ", String(repeating: "a", count: 33)] {
            XCTAssertNil(CatOverlayColor.normalized(bad), bad)
        }
    }
}

final class CatOverlayLangTests: XCTestCase {
    func testOnlyTheHelperLanguagesReachThePage() {
        XCTAssertEqual(CatOverlayLang.query("en"), "lang=en")
        XCTAssertEqual(CatOverlayLang.query("pt"), "lang=pt")
        XCTAssertEqual(CatOverlayLang.script("en"), "window.kiwiOverlay?.set({lang: 'en'})")
        for bad in ["", "fr", "EN", "en-US", "en');alert(1)//"] {
            XCTAssertEqual(CatOverlayLang.page(bad), "pt", bad)
            XCTAssertEqual(CatOverlayLang.script(bad), "window.kiwiOverlay?.set({lang: 'pt'})", bad)
        }
    }
}
