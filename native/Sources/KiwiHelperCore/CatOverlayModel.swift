import CoreGraphics
import Foundation

/// O gato no overlay (spec #9810): onde a janela fica e quando ela pode aparecer. Puro, sem AppKit, testado no
/// `swift test`; a janela de verdade é `kiwi-helper/CatOverlay.swift`.
public enum CatOverlayLayout {
    /// A altura do gato na tela, em pontos.
    public static let height: CGFloat = 240
    /// A proporção da página do gato (a mesma do gato do hub, 96 × 120).
    public static let aspect: CGFloat = 96.0 / 120.0

    public static var size: CGSize { CGSize(width: (height * aspect).rounded(), height: height) }

    /// No centro da área útil da tela (sem a barra de menus e o Dock).
    public static func frame(visible: CGRect, size: CGSize = CatOverlayLayout.size) -> CGRect {
        CGRect(
            x: (visible.midX - size.width / 2).rounded(),
            y: (visible.midY - size.height / 2).rounded(),
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
