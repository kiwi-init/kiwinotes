import CoreGraphics
import Foundation

/// O gato no overlay (spec #9810): onde a janela fica e quando ela pode aparecer. Puro, sem AppKit, testado no
/// `swift test`; a janela de verdade é `kiwi-helper/CatOverlay.swift`.
public enum CatOverlayLayout {
    /// A altura do gato na tela, em pontos.
    public static let height: CGFloat = 240
    /// A proporção da página do gato (a mesma do gato do hub, 96 × 120).
    public static let aspect: CGFloat = 96.0 / 120.0

    /// O balão da resposta (spec #12938), em cima do gato: o espaço que a página reserva para ele.
    public static let bubbleWidth: CGFloat = 300
    public static let bubbleHeight: CGFloat = 112

    /// O corpo do gato no quadro, em frações (T16754): o `CAT_BODY` de `app/ui/kiwicat-v2/bubbleTail.ts`.
    public static let bodyX0: CGFloat = 0.28
    public static let bodyX1: CGFloat = 0.74
    public static let bodyY0: CGFloat = 0.44
    public static let bodyY1: CGFloat = 0.77
    /// A ponta do rabo, 7,5 pt para dentro da quina do balão (o `TAIL_TIP` do mesmo arquivo).
    public static let tailTipX: CGFloat = 7.5

    /// O gato, na parte de baixo da janela.
    public static var catSize: CGSize { CGSize(width: (height * aspect).rounded(), height: height) }

    /// A janela: o gato embaixo e o balão em cima.
    public static var size: CGSize { CGSize(width: max(catSize.width, bubbleWidth), height: height + bubbleHeight) }

    /// O gato no centro da área útil da tela (sem a barra de menus e o Dock), como antes do balão; o balão fica acima.
    public static func frame(visible: CGRect, size: CGSize = CatOverlayLayout.size) -> CGRect {
        CGRect(
            x: (visible.midX - size.width / 2).rounded(),
            y: (visible.midY - height / 2).rounded(),
            width: size.width,
            height: size.height
        )
    }

    /// A tela em que a pessoa trabalha: a da maior janela do app da frente; sem ela, a do mouse; sem ela, a primeira.
    public static func screen(screens: [CGRect], frontWindow: CGRect?, mouse: CGPoint?) -> Int? {
        if screens.isEmpty { return nil }
        if let w = frontWindow {
            let areas = screens.map { s -> CGFloat in
                let i = s.intersection(w)
                return i.isNull ? 0 : i.width * i.height
            }
            if let best = areas.indices.max(by: { areas[$0] < areas[$1] }), areas[best] > 0 { return best }
        }
        if let m = mouse, let i = screens.firstIndex(where: { $0.contains(m) }) { return i }
        return 0
    }
}

/// Onde o gato fica na tela (spec #12949): as seis posições que a pessoa escolhe. O texto é o das settings.
public enum CatPosition: String, CaseIterable, Sendable {
    case center
    case bottomCenter = "bottom-center"
    case topLeft = "top-left"
    case topRight = "top-right"
    case bottomLeft = "bottom-left"
    case bottomRight = "bottom-right"

    /// Uma posição que o helper não conhece vira o centro, o padrão de antes.
    public init(setting: String?) { self = setting.flatMap(CatPosition.init(rawValue:)) ?? .center }

    var isTop: Bool { self == .topLeft || self == .topRight }
    var isBottom: Bool { self == .bottomCenter || self == .bottomLeft || self == .bottomRight }
    var isLeft: Bool { self == .topLeft || self == .bottomLeft }
    var isRight: Bool { self == .topRight || self == .bottomRight }
}

/**
 A posição e o tamanho do gato no overlay (spec #12949). A janela tem o gato (192 × 240 vezes a escala) e o balão, que
 fica sempre com o mesmo tamanho (300 × 112) para o texto ser lido em qualquer escala. Nos cantos de cima o balão vai
 embaixo do gato, para não sair da tela; nos cantos, o gato encosta no lado da janela que dá para o canto. A janela fica
 dentro da área útil (sem a barra de menus e o Dock), a `margin` da borda nos cantos e embaixo.
 */
public struct CatPlacement: Equatable, Sendable {
    public static let minScale: CGFloat = 0.6
    public static let maxScale: CGFloat = 1.6
    /// A distância da borda da área útil, nos cantos e no centro de baixo.
    public static let margin: CGFloat = 24

    public let position: CatPosition
    public let scale: CGFloat

    /// A escala fora dos limites (ou que não é número) fica no limite mais perto, ou em 1.
    public init(position: CatPosition = .center, scale: Double = 1) {
        self.position = position
        self.scale = scale.isFinite ? min(max(CGFloat(scale), Self.minScale), Self.maxScale) : 1
    }

    public var catSize: CGSize {
        CGSize(width: (CatOverlayLayout.height * CatOverlayLayout.aspect * scale).rounded(), height: (CatOverlayLayout.height * scale).rounded())
    }

    /// O balão à esquerda do gato (o canto da direita e o centro) ou à direita dele (os cantos da esquerda), com o rabo
    /// na quina do lado do gato e a ponta encostada no corpo (T16754, harry #16786).
    public var bubbleLeft: Bool { !position.isLeft }

    /// Quanto o balão passa do quadro do gato, para o lado dele: a mesma conta do `overhang` de
    /// `app/ui/catoverlay/placement.ts`, para a janela e a página terem a mesma largura.
    public var overhang: CGFloat {
        let L = CatOverlayLayout.self
        let inside = catSize.width * (bubbleLeft ? L.bodyX0 : 1 - L.bodyX1) + L.tailTipX
        return max(0, (L.bubbleWidth - inside).rounded(.up))
    }

    /// Onde o quadro do gato começa na janela, da esquerda.
    public var catOffsetX: CGFloat { bubbleLeft ? overhang : 0 }

    /// A janela: o gato e o que o balão passa dele na largura, e os dois na altura.
    public var size: CGSize {
        CGSize(width: catSize.width + overhang, height: catSize.height + CatOverlayLayout.bubbleHeight)
    }

    /// O balão embaixo do gato (os cantos de cima); nos outros, em cima.
    public var bubbleBelow: Bool { position.isTop }

    /// De que lado da janela o gato e o balão encostam: `left`, `right` ou `center`.
    public var side: String { position.isLeft ? "left" : position.isRight ? "right" : "center" }

    /// O que a página lê da URL: a escala, o lado e onde vai o balão.
    public var query: String {
        "escala=\(String(format: "%.2f", Double(scale)))&lado=\(side)&balao=\(bubbleBelow ? "abaixo" : "acima")"
    }

    /// A janela na área útil `visible` (coordenadas do AppKit: a origem embaixo, à esquerda).
    public func frame(visible: CGRect) -> CGRect {
        let s = size
        let m = Self.margin
        // O gato no lugar pedido; a janela começa `catOffsetX` antes dele.
        let catX = position.isLeft ? visible.minX + m : position.isRight ? visible.maxX - m - catSize.width : visible.midX - catSize.width / 2
        var x = catX - catOffsetX
        // No centro, o gato no meio da área útil, como antes (o balão acima dele).
        var y = position.isTop ? visible.maxY - m - s.height : position.isBottom ? visible.minY + m : visible.midY - catSize.height / 2
        x = min(max(x, visible.minX), visible.maxX - s.width)
        y = min(max(y, visible.minY), visible.maxY - s.height)
        return CGRect(x: x.rounded(), y: y.rounded(), width: s.width, height: s.height)
    }

    /// Onde o gato fica dentro da janela `frame` (na tela). Ele encosta no lado da janela oposto ao do balão, que pode
    /// ter a largura do balão aberto reservada (spec #17673).
    public func catRect(in frame: CGRect) -> CGRect {
        let c = catSize
        let x = bubbleLeft ? frame.maxX - c.width : frame.minX
        let y = bubbleBelow ? frame.maxY - c.height : frame.minY
        return CGRect(x: x, y: y, width: c.width, height: c.height)
    }

    /// O balão aberto (spec #13378) cresce até esta altura, com o texto todo rolando dentro dele.
    public static let openBubbleMaxHeight: CGFloat = 360

    /// O espaço do balão aberto na largura (spec #17673, harry #17673): 500, com a casca de 480; o fechado tem 300 e 280.
    public static let openBubbleWidth: CGFloat = 500
    /// A casca do balão é 20 pt mais estreita que o espaço dele (a de 280 nos 300).
    public static let bubbleShellInset: CGFloat = 20

    /**
     A janela na tela (spec #13378): a do `frame`, com o espaço do balão aberto já reservado, para o "ver mais" não
     mexer na janela. O gato fica onde o `frame` o põe; o espaço do balão cresce para o lado dele (para cima, ou para
     baixo nos cantos de cima) até `openBubbleMaxHeight`, sem passar da área útil, e nunca fica menor que o do balão
     fechado. A parte transparente deixa o clique passar: só o balão pega o clique (`CatOverlayBubble.takesClick`).
     */
    public func windowFrame(visible: CGRect) -> CGRect {
        let closed = frame(visible: visible)
        let cat = catRect(in: closed)
        let room = bubbleBelow ? cat.minY - visible.minY : visible.maxY - cat.maxY
        let h = max(CatOverlayLayout.bubbleHeight, min(Self.openBubbleMaxHeight, room.rounded(.down)))
        // Na largura (spec #17673): o balão aberto cresce primeiro para o lado, para longe do gato, até
        // `openBubbleWidth`, sem passar da área útil e nunca menos que o fechado. O gato não sai do lugar.
        let side = bubbleLeft ? closed.minX - visible.minX : visible.maxX - closed.maxX
        let extra = max(0, min(Self.openBubbleWidth - CatOverlayLayout.bubbleWidth, side.rounded(.down)))
        return CGRect(x: bubbleLeft ? closed.minX - extra : closed.minX, y: bubbleBelow ? cat.minY - h : cat.minY,
                      width: closed.width + extra, height: cat.height + h)
    }

    /// A largura da casca do balão aberto numa janela `frame` (spec #17673): de 280 (sem espaço a mais) a 480. É o
    /// `largura` que a página recebe.
    public func openShellWidth(in frame: CGRect) -> CGFloat {
        CatOverlayLayout.bubbleWidth + max(0, frame.width - size.width) - Self.bubbleShellInset
    }

    /// O espaço do balão numa janela `frame` (a do `frame` ou a do `windowFrame`): a altura que sobra além do gato.
    public func bubbleRoom(in frame: CGRect) -> CGFloat { frame.height - catSize.height }

    /// Onde o balão fica dentro da janela `frame` (na tela): o espaço todo dele.
    public func bubbleRect(in frame: CGRect) -> CGRect {
        let L = CatOverlayLayout.self
        let w = L.bubbleWidth + max(0, frame.width - size.width), h = bubbleRoom(in: frame)
        let cat = catRect(in: frame)
        // A ponta do rabo na borda do corpo do lado do balão; a casca 7,5 pt além dela (T16754).
        let x = bubbleLeft ? cat.minX + cat.width * L.bodyX0 + L.tailTipX - w : cat.minX + cat.width * L.bodyX1 - L.tailTipX
        let y = bubbleBelow ? frame.minY : frame.maxY - h
        return CGRect(x: x, y: y, width: w, height: h)
    }
}

/// O balão do gato no overlay (spec #12938): o argumento do `kiwiOverlay.set({bubble: …})`, em JSON. O texto vem do
/// agente: só como dado de um literal JSON, nunca colado no script.
public enum CatOverlayBubble {
    /**
     Se a janela pega o clique em `mouse` (spec #13378): só em cima do balão, que a página mede (`rect`, na página: a
     origem em cima, à esquerda). O resto da janela (o gato e o espaço transparente) deixa o clique passar para o app de
     trás (#504). Sem balão na tela, nada pega.
     */
    public static func takesClick(panel: CGRect, rect: CGRect?, mouse: CGPoint) -> Bool {
        OverlayLayout.takesClick(panel: panel, pill: rect, mouse: mouse)
    }

    /**
     O mouse sobre o gato (spec #13380): o × da cabeça aparece. Ele continua enquanto o mouse está no gato ou no próprio
     × (`close`, que a página mede, com a origem em cima), para dar tempo de chegar nele.
     */
    public static func catHover(panel: CGRect, cat: CGRect, close: CGRect?, showing: Bool, mouse: CGPoint) -> Bool {
        cat.contains(mouse) || (showing && takesClick(panel: panel, rect: close, mouse: mouse))
    }

    /**
     O Esc fora do Hub (spec #32534, #32777): o painel nunca tem o teclado, então o Esc vem do tap de atalhos, que engole
     a tecla. Só com um balão à vista (`bubbleShown`: a página só mede o balão quando ele aparece) e o mouse em cima do
     gato ou do balão; fora disso, a tecla passa ao app da frente.
     */
    public static func escapeArmed(bubbleShown: Bool, catHover: Bool, overBubble: Bool) -> Bool {
        bubbleShown && (catHover || overBubble)
    }

    /**
     O clique fora com o "Ver mais" aberto (spec #32534): o botão do mouse desceu agora (`pressed` e não `wasPressed`),
     longe do balão. A janela deixa esse clique passar ao app de trás; o helper só o vê pelo estado dos botões.
     */
    public static func clickedOutside(open: Bool, pressed: Bool, wasPressed: Bool, overBubble: Bool) -> Bool {
        open && pressed && !wasPressed && !overBubble
    }

    /// O retângulo que a página manda (`{x, y, w, h}`, em pontos); qualquer outra coisa é nenhum balão.
    public static func rect(_ body: Any?) -> CGRect? {
        guard let d = body as? [String: Any] else { return nil }
        let v = ["x", "y", "w", "h"].compactMap { (d[$0] as? NSNumber)?.doubleValue }
        guard v.count == 4, v.allSatisfy({ $0.isFinite }), v[2] > 0, v[3] > 0, v[2] < 10_000, v[3] < 10_000 else { return nil }
        return CGRect(x: v[0], y: v[1], width: v[2], height: v[3])
    }

    /**
     O link que a pessoa clicou no balão (spec #17679): a página manda o endereço do `.kn-md-link`, que não tem `href` e
     não abre sozinho. Só `http`, `https` e `mailto` abrem, com host (o `mailto`, com o destinatário); qualquer outro
     esquema, um texto vazio ou longo demais é nenhum link.
     */
    public static func link(_ body: Any?) -> URL? {
        guard let s = body as? String, !s.isEmpty, s.count <= 2048, let url = URL(string: s),
              let scheme = url.scheme?.lowercased() else { return nil }
        switch scheme {
        case "http", "https": return (url.host ?? "").isEmpty ? nil : url
        case "mailto": return url.absoluteString.count > "mailto:".count ? url : nil
        default: return nil
        }
    }

    /**
     Os links de caminho do balão (spec #17683), como o app mandou: `{text, from, to, path, kind}`, com `kind` `note` ou
     `file` e as posições dentro do texto. Os que não têm essa forma saem; no máximo 50.
     */
    public static func links(_ body: Any?, textLength: Int) -> [[String: Any]] {
        guard let list = body as? [Any] else { return [] }
        var out: [[String: Any]] = []
        for item in list.prefix(50) {
            guard let d = item as? [String: Any], let text = d["text"] as? String, let path = pathString(d["path"]),
                  let kind = d["kind"] as? String, kind == "note" || kind == "file",
                  let from = (d["from"] as? NSNumber)?.intValue, let to = (d["to"] as? NSNumber)?.intValue,
                  from >= 0, from < to, to <= textLength else { continue }
            out.append(["text": text, "from": from, "to": to, "path": path, "kind": kind])
        }
        return out
    }

    /**
     O caminho que a pessoa clicou no balão (spec #17683): só um dos `shown` (os links do balão de agora), relativo e sem
     `..`. Um `kiwi-file:` que a resposta escreveu sozinha não abre; o app ainda confere de novo na pasta.
     */
    public static func openPath(_ body: Any?, shown: [String]) -> String? {
        guard let path = pathString(body), shown.contains(path) else { return nil }
        return path
    }

    private static func pathString(_ body: Any?) -> String? {
        guard let s = body as? String, !s.isEmpty, s.count <= 1024, !s.contains("\0"), !s.hasPrefix("/"), !s.hasPrefix("~"),
              !s.split(separator: "/", omittingEmptySubsequences: false).contains("..") else { return nil }
        return s
    }

    /// `ask`: com a pergunta "Precisa de mais alguma coisa?" embaixo da resposta (spec #13380). `summary`: de onde sai
    /// o resumo do balão fechado (a fala do `cat_speak` ou a resposta final, spec #27881); `text` é o que o aberto mostra.
    /// `progress` (spec #32534, T33177): o andamento do pedido, com o [Parar]; `heard`, o que a pessoa falou, em cima.
    public static func script(text: String?, error: Bool, ask: Bool = false, links: [[String: Any]] = [], summary: String? = nil,
                              progress: Bool = false, heard: String? = nil) -> String {
        guard let text, !text.isEmpty else { return "null" }
        var object: [String: Any] = ["text": text, "error": error]
        if ask { object["ask"] = true }
        if progress { object["progress"] = true }
        if let heard, !heard.isEmpty { object["heard"] = heard }
        if let summary, !summary.isEmpty, summary != text { object["summary"] = summary }
        if !links.isEmpty { object["links"] = links }
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
              let json = String(data: data, encoding: .utf8) else { return "null" }
        // U+2028 e U+2029 são fim de linha em JavaScript antigo: escapados, o literal vale em qualquer WebKit.
        return json.replacingOccurrences(of: "\u{2028}", with: "\\u2028").replacingOccurrences(of: "\u{2029}", with: "\\u2029")
    }
}

/// A vez entre o gato e a pílula do ditado: com a pílula na tela, o gato espera, e entra quando ela sai.
public struct CatOverlayGate: Equatable {
    /// O app pediu o gato na tela (entre o `show` e o `hide`).
    public private(set) var wanted = false
    /// A pílula do ditado está na tela.
    public private(set) var pillVisible = false

    public init() {}

    /// O gato deve estar na tela agora.
    public var shows: Bool { wanted && !pillVisible }

    /// Muda o pedido do app; devolve se a visibilidade mudou.
    public mutating func want(_ on: Bool) -> Bool {
        let before = shows
        wanted = on
        return before != shows
    }

    /// A pílula entrou ou saiu; devolve se a visibilidade do gato mudou.
    public mutating func pill(_ visible: Bool) -> Bool {
        let before = shows
        pillVisible = visible
        return before != shows
    }
}

/// A língua da página do gato (T29351, spec #28171): a do helper (`HelperLocale`, que o app manda no `app.locale`), na
/// URL do `load` (`lang=en`) e no script quando ela muda. Só `pt` ou `en` saem daqui: qualquer outra coisa é português,
/// e o valor nunca vem de fora do helper sem passar por esta lista.
public enum CatOverlayLang {
    public static func page(_ code: String) -> String {
        HelperLocale.supported.contains(code) ? code : HelperLocale.fallback
    }

    public static func query(_ code: String) -> String { "lang=\(page(code))" }

    public static func script(_ code: String) -> String { "window.kiwiOverlay?.set({lang: '\(page(code))'})" }
}

/// A paleta do gato (spec #14963): só um id, letras minúsculas em pedaços separados por `-` (`kiwi-neon`), até 32
/// caracteres, que serve tanto na URL (`cor=kiwi-neon`) quanto no script. A página confere que é uma das 5. Qualquer
/// outra coisa é recusada.
public enum CatOverlayColor {
    public static func normalized(_ input: String) -> String? {
        guard (1...32).contains(input.count) else { return nil }
        let parts = input.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy { $0.isASCII && $0.isLowercase && $0.isLetter } }) else { return nil }
        return input
    }
}
