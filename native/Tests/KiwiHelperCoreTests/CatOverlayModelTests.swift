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

    func testDefaultIsTodayAndOutOfRangeIsClamped() {
        let visible = CGRect(x: 0, y: 80, width: 1512, height: 870)
        XCTAssertEqual(CatPlacement().frame(visible: visible), CatOverlayLayout.frame(visible: visible))
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
    func testOnlySixDigitHexPasses() {
        XCTAssertEqual(CatOverlayColor.normalized("#FF9B5E"), "ff9b5e")
        XCTAssertEqual(CatOverlayColor.normalized("#6ea8ff"), "6ea8ff")
        for bad in ["", "#fff", "ff9b5e", "#ff9b5e0", "#gg9b5e", "#ff9b5'", "#ff9b5e');alert(1)//", "#１２３４５６"] {
            XCTAssertNil(CatOverlayColor.normalized(bad), bad)
        }
    }
}
