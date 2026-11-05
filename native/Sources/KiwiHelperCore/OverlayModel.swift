import CoreGraphics
import Foundation

/// What the dictation pill shows. Same names as `overlay.state` in ADR 0001.
public enum OverlayPhase: String, CaseIterable, Sendable {
    case hidden
    case listening
    case processing
    case done
    case error
}

/// The pill's state, without AppKit: phase, message, waveform bars and when to hide by itself.
/// Pure (times come in), so `swift test` covers it.
public struct OverlayModel: Sendable {
    /// How long `done` stays before it fades out.
    public static let doneLinger: TimeInterval = 0.7
    /// How long an error, or a `done` with a message, stays: long enough to read a short message.
    public static let errorLinger: TimeInterval = 2.5
    /// `processing` with no news from the app (no STT yet, or the app went quiet) hides after this.
    public static let processingTimeout: TimeInterval = 10
    /// Longer messages are cut with "…", so the pill never outgrows its panel.
    public static let maxMessageLength = 38

    public let barCount: Int
    public private(set) var phase: OverlayPhase = .hidden
    public private(set) var message: String?
    /// The recent levels, oldest first: one per bar from the middle out.
    private var levels: [Float]
    /// When `tick` hides the pill on its own (`done`, `error`, a stuck `processing`).
    public private(set) var hideAt: TimeInterval?

    public init(barCount: Int = 13) {
        self.barCount = max(1, barCount)
        levels = Array(repeating: 0, count: (self.barCount + 1) / 2)
    }

    /// Bar heights 0...1, left to right. Symmetric: the newest level is the middle bar and older ones
    /// move out to both edges, which are a little shorter (the pill's waveform, ADR 0005).
    public var bars: [Float] {
        let center = (barCount - 1) / 2
        let newest = levels.count - 1
        return (0..<barCount).map { i in
            let distance = abs(i - center) + (barCount.isMultiple(of: 2) && i > center ? -1 : 0)
            let taper = 1 - Self.edgeTaper * Float(distance) / Float(max(1, center))
            return levels[newest - distance] * taper
        }
    }

    /// How much shorter the outermost bars are than the middle one.
    public static let edgeTaper: Float = 0.45

    public var isVisible: Bool { phase != .hidden }

    public mutating func set(_ phase: OverlayPhase, message: String? = nil, at now: TimeInterval) {
        if phase == .listening, self.phase != .listening { levels = Array(repeating: 0, count: levels.count) }
        self.phase = phase
        // `error` and `done` show a message ("O texto também ficou no clipboard", #224); the others don't.
        let shown = phase == .error || phase == .done ? message.map(Self.clip).flatMap { $0.isEmpty ? nil : $0 } : nil
        self.message = shown
        switch phase {
        case .done: hideAt = now + (shown == nil ? Self.doneLinger : Self.errorLinger)
        case .error: hideAt = now + Self.errorLinger
        case .processing: hideAt = now + Self.processingTimeout
        case .hidden, .listening: hideAt = nil
        }
    }

    /// One `audio.level` (0...1). Ignored unless listening, so a late level can't revive a hidden pill.
    public mutating func push(level: Float) {
        guard phase == .listening else { return }
        levels.removeFirst()
        levels.append(Self.shape(level))
    }

    /// Hides the pill when its time is up. Returns true when the phase changed.
    public mutating func tick(now: TimeInterval) -> Bool {
        guard let hideAt, now >= hideAt else { return false }
        set(.hidden, at: now)
        return true
    }

    static func clip(_ message: String) -> String {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > maxMessageLength else { return trimmed }
        return String(trimmed.prefix(maxMessageLength - 1)).trimmingCharacters(in: .whitespaces) + "…"
    }

    /// Quiet speech still has to move the bars: lift the low end, and keep a small floor.
    public static func shape(_ level: Float) -> Float {
        let clamped = min(max(level, 0), 1)
        return 0.12 + 0.88 * clamped.squareRoot()
    }
}

/// Where the pill goes: centered at the bottom of the screen, just above the Dock.
public enum OverlayLayout {
    /// Space between the pill and the Dock (or the bottom edge, with the Dock hidden or on a side).
    public static let margin: CGFloat = 12

    /// - Parameters:
    ///   - screen: the whole screen frame (AppKit coordinates, origin bottom-left).
    ///   - visible: the screen's `visibleFrame` (without the menu bar and the Dock).
    ///   - size: the panel size.
    ///   - pillBottom: how far above the panel's bottom edge the pill sits (room for its shadow).
    public static func frame(screen: CGRect, visible: CGRect, size: CGSize, pillBottom: CGFloat) -> CGRect {
        CGRect(
            x: (screen.midX - size.width / 2).rounded(),
            y: (visible.minY + margin - pillBottom).rounded(),
            width: size.width,
            height: size.height
        )
    }
}

/// Short Portuguese text for the `record.error` codes, shown in the pill.
public enum OverlayText {
    public static func error(_ code: String) -> String {
        switch code {
        case "no_input_device": return "Nenhum microfone encontrado"
        case "microphone_denied", "not_authorized": return "Sem permissão do microfone"
        case "microphone_undetermined": return "Permita o microfone e tente de novo"
        case "device_changed": return "O microfone mudou"
        case "no_audio": return "Sem áudio do microfone"
        case "mic_busy": return "Mic ocupado por outro app"
        case "engine_start_failed", "audio_converter": return "Não deu para usar o microfone"
        default: return "Algo deu errado"
        }
    }
}
