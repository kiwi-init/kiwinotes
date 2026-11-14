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

    /// A janela: a largura do maior (gato ou balão) e a altura dos dois.
    public var size: CGSize {
        CGSize(width: max(catSize.width, CatOverlayLayout.bubbleWidth), height: catSize.height + CatOverlayLayout.bubbleHeight)
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
        var x = position.isLeft ? visible.minX + m : position.isRight ? visible.maxX - m - s.width : visible.midX - s.width / 2
        // No centro, o gato no meio da área útil, como antes (o balão acima dele).
        var y = position.isTop ? visible.maxY - m - s.height : position.isBottom ? visible.minY + m : visible.midY - catSize.height / 2
        x = min(max(x, visible.minX), visible.maxX - s.width)
        y = min(max(y, visible.minY), visible.maxY - s.height)
        return CGRect(x: x.rounded(), y: y.rounded(), width: s.width, height: s.height)
    }

    /// Onde o gato fica dentro da janela `frame` (na tela).
    public func catRect(in frame: CGRect) -> CGRect {
        let c = catSize
        let x = side == "left" ? frame.minX : side == "right" ? frame.maxX - c.width : frame.midX - c.width / 2
        let y = bubbleBelow ? frame.maxY - c.height : frame.minY
        return CGRect(x: x, y: y, width: c.width, height: c.height)
    }

    /// O balão aberto (spec #13378) cresce até esta altura, com o texto todo rolando dentro dele.
    public static let openBubbleMaxHeight: CGFloat = 360

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
        return CGRect(x: closed.minX, y: bubbleBelow ? cat.minY - h : cat.minY, width: closed.width, height: cat.height + h)
    }

    /// O espaço do balão numa janela `frame` (a do `frame` ou a do `windowFrame`): a altura que sobra além do gato.
    public func bubbleRoom(in frame: CGRect) -> CGFloat { frame.height - catSize.height }

    /// Onde o balão fica dentro da janela `frame` (na tela): o espaço todo dele.
    public func bubbleRect(in frame: CGRect) -> CGRect {
        let w = CatOverlayLayout.bubbleWidth, h = bubbleRoom(in: frame)
        let x = side == "left" ? frame.minX : side == "right" ? frame.maxX - w : frame.midX - w / 2
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

    /// O retângulo que a página manda (`{x, y, w, h}`, em pontos); qualquer outra coisa é nenhum balão.
    public static func rect(_ body: Any?) -> CGRect? {
        guard let d = body as? [String: Any] else { return nil }
        let v = ["x", "y", "w", "h"].compactMap { (d[$0] as? NSNumber)?.doubleValue }
        guard v.count == 4, v.allSatisfy({ $0.isFinite }), v[2] > 0, v[3] > 0, v[2] < 10_000, v[3] < 10_000 else { return nil }
        return CGRect(x: v[0], y: v[1], width: v[2], height: v[3])
    }

    public static func script(text: String?, error: Bool) -> String {
        guard let text, !text.isEmpty else { return "null" }
        let object: [String: Any] = ["text": text, "error": error]
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

/// A cor da névoa (spec #9349): só `#rrggbb` chega à página, e vai sem o `#` (`rrggbb`, em minúsculas), que serve tanto
/// na URL (`cor=rrggbb`) quanto no script. Qualquer outra coisa é recusada.
public enum CatOverlayColor {
    public static func normalized(_ input: String) -> String? {
        guard input.count == 7, input.first == "#" else { return nil }
        let hex = input.dropFirst().lowercased()
        guard hex.allSatisfy({ $0.isHexDigit && $0.isASCII }) else { return nil }
        return hex
    }
}
