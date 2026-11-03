import AppKit
import KiwiHelperCore
import SwiftUI

/// The dictation pill (T56, ADR 0004): a non-activating NSPanel at the top of the screen, under the
/// notch. It never becomes key or main and ignores the mouse, so the app being dictated into keeps
/// the focus and the keyboard. Call everything on the main thread.
final class Overlay {
    static let panelSize = CGSize(width: 360, height: 64)

    private let state = OverlayViewState()
    private var panel: NSPanel?
    private var model = OverlayModel()
    private var hideTimer: Timer?
    private var orderOutWork: DispatchWorkItem?

    /// `overlay.state` from the app, or the sidecar's own recording events.
    func set(_ phase: OverlayPhase, message: String? = nil) {
        let wasVisible = model.isVisible
        model.set(phase, message: message, at: ProcessInfo.processInfo.systemUptime)
        publish()
        if model.isVisible, !wasVisible { show() }
        if !model.isVisible, wasVisible { hide() }
        scheduleHide()
    }

    /// `audio.level`; any thread.
    func push(level: Float) {
        DispatchQueue.main.async { [self] in
            guard model.phase == .listening else { return }
            model.push(level: level)
            state.bars = model.bars
        }
    }

    private func publish() {
        state.phase = model.phase
        state.message = model.message
        state.bars = model.bars
    }

    private func scheduleHide() {
        hideTimer?.invalidate()
        hideTimer = nil
        guard let hideAt = model.hideAt else { return }
        let delay = max(0, hideAt - ProcessInfo.processInfo.systemUptime)
        hideTimer = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
            guard let self, self.model.tick(now: ProcessInfo.processInfo.systemUptime + 0.001) else { return }
            self.publish()
            self.hide()
        }
    }

    // MARK: Panel

    private func show() {
        orderOutWork?.cancel()
        let panel = self.panel ?? makePanel()
        self.panel = panel
        if let screen = Self.targetScreen() {
            let frame = OverlayLayout.frame(
                screen: screen.frame, visible: screen.visibleFrame,
                safeTop: screen.safeAreaInsets.top, size: Self.panelSize
            )
            panel.setFrame(frame, display: false)
        }
        state.visible = true
        panel.orderFrontRegardless() // shows without activating us or taking the key window
    }

    private func hide() {
        state.visible = false
        // Let the fade-out play, then take the panel off screen so it costs nothing while idle.
        let work = DispatchWorkItem { [weak self] in self?.panel?.orderOut(nil) }
        orderOutWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: work)
    }

    /// The screen the person is looking at: the one with the mouse.
    private static func targetScreen() -> NSScreen? {
        let mouse = NSEvent.mouseLocation
        return NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
    }

    private func makePanel() -> NSPanel {
        let panel = OverlayPanel(
            contentRect: CGRect(origin: .zero, size: Self.panelSize),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: true
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false // the pill draws its own, so the transparent area has none
        panel.ignoresMouseEvents = true
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        // Above normal windows and the menu bar, on every Space and over full-screen apps.
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .none
        let host = NSHostingView(rootView: OverlayView(state: state))
        host.frame = CGRect(origin: .zero, size: Self.panelSize)
        panel.contentView = host
        return panel
    }
}

private final class OverlayPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
    /// AppKit pushes windows below where a menu bar could be (~30 pt down on a screen whose menu
    /// bar is hidden). `OverlayLayout` already placed the pill; keep that.
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

// MARK: - SwiftUI

final class OverlayViewState: ObservableObject {
    @Published var visible = false
    @Published var phase: OverlayPhase = .hidden
    @Published var message: String?
    @Published var bars: [Float] = Array(repeating: 0, count: 13)
}

/// Colors and motion from `app/ui/src/styles/tokens.css` (the dark set: the pill floats over anything).
enum OverlayStyle {
    static let accent = Color(red: 0x8C / 255, green: 0xC4 / 255, blue: 0x6A / 255) // --accent (dark)
    static let danger = Color(red: 1, green: 0x69 / 255, blue: 0x61 / 255) // --danger (dark)
    static let text = Color(red: 0xF5 / 255, green: 0xF5 / 255, blue: 0xF7 / 255)
    static let fill = Color(red: 0x1C / 255, green: 0x1C / 255, blue: 0x1E / 255).opacity(0.92) // --bg (dark)
    static let border = Color.white.opacity(0.1)
    /// --pop: a lively spring with a little overshoot, for showing up and for marks.
    static let pop = Animation.spring(response: 0.35, dampingFraction: 0.68)
    /// --glide: the pill changing width between states.
    static let glide = Animation.spring(response: 0.48, dampingFraction: 0.82)
    /// --fast with --ease, for fading out.
    static let fade = Animation.timingCurve(0.32, 0.72, 0, 1, duration: 0.16)
    static let height: CGFloat = 36
}

struct OverlayView: View {
    @ObservedObject var state: OverlayViewState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack {
            pill
                .opacity(state.visible ? 1 : 0)
                .scaleEffect(state.visible || reduceMotion ? 1 : 0.86, anchor: .top)
                .offset(y: state.visible || reduceMotion ? 0 : -6)
                .animation(state.visible ? (reduceMotion ? OverlayStyle.fade : OverlayStyle.pop) : OverlayStyle.fade, value: state.visible)
            Spacer(minLength: 0)
        }
        .frame(width: Overlay.panelSize.width, height: Overlay.panelSize.height)
    }

    private var pill: some View {
        content
            .padding(.horizontal, 14)
            .frame(height: OverlayStyle.height)
            .background(
                Capsule(style: .continuous)
                    .fill(OverlayStyle.fill)
                    .overlay(Capsule(style: .continuous).strokeBorder(OverlayStyle.border, lineWidth: 0.5))
                    .shadow(color: .black.opacity(0.35), radius: 14, y: 6)
            )
            .animation(reduceMotion ? nil : OverlayStyle.glide, value: state.phase)
            .padding(.top, 2)
    }

    @ViewBuilder
    private var content: some View {
        switch state.phase {
        case .listening, .hidden:
            Waveform(bars: state.bars, reduceMotion: reduceMotion)
                .transition(.opacity)
        case .processing:
            ThinkingDots(reduceMotion: reduceMotion)
                .transition(.opacity)
        case .done:
            Image(systemName: "checkmark")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(OverlayStyle.accent)
                .transition(reduceMotion ? .opacity : .scale(scale: 0.4).combined(with: .opacity))
        case .error:
            HStack(spacing: 8) {
                Image(systemName: "exclamationmark.circle.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(OverlayStyle.danger)
                Text(state.message ?? "Algo deu errado")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(OverlayStyle.text)
                    .lineLimit(1)
            }
            .fixedSize() // as wide as the message; the model already caps its length
            .transition(.opacity)
        }
    }
}

/// Bars that scroll left as the voice comes in, mirrored around the middle line.
struct Waveform: View {
    let bars: [Float]
    let reduceMotion: Bool

    var body: some View {
        HStack(alignment: .center, spacing: 3) {
            ForEach(bars.indices, id: \.self) { i in
                Capsule(style: .continuous)
                    .fill(OverlayStyle.accent.opacity(0.55 + 0.45 * Double(i + 1) / Double(bars.count)))
                    .frame(width: 3, height: max(3, CGFloat(bars[i]) * 20))
            }
        }
        .frame(height: 20)
        .animation(reduceMotion ? nil : .spring(response: 0.18, dampingFraction: 0.8), value: bars)
    }
}

/// Three dots breathing in turn while the text is transcribed and cleaned.
struct ThinkingDots: View {
    let reduceMotion: Bool
    @State private var phase = false

    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<3) { i in
                Circle()
                    .fill(OverlayStyle.accent)
                    .frame(width: 6, height: 6)
                    .opacity(reduceMotion ? 0.8 : (phase ? 1 : 0.3))
                    .scaleEffect(reduceMotion ? 1 : (phase ? 1 : 0.7))
                    .animation(
                        reduceMotion ? nil : .easeInOut(duration: 0.5).repeatForever().delay(Double(i) * 0.15),
                        value: phase
                    )
            }
        }
        .onAppear { phase = true }
    }
}

// MARK: - Snapshots (dev)

enum OverlaySnapshots {
    /// `kiwi-helper --overlay-snapshot <dir>`: one PNG per state, rendered off screen. To look at the
    /// pill without a microphone or Screen Recording permission.
    @MainActor
    static func write(to dir: URL) throws {
        let samples: [(String, OverlayPhase, String?, [Float])] = [
            ("listening-quiet", .listening, nil, (0..<13).map { _ in OverlayModel.shape(0.02) }),
            ("listening-speech", .listening, nil, [0.05, 0.2, 0.5, 0.3, 0.8, 0.6, 1, 0.4, 0.7, 0.3, 0.55, 0.2, 0.1].map(OverlayModel.shape)),
            ("processing", .processing, nil, []),
            ("done", .done, nil, []),
            ("error", .error, OverlayText.error("no_input_device"), []),
        ]
        for (name, phase, message, bars) in samples {
            let state = OverlayViewState()
            state.visible = true
            state.phase = phase
            state.message = message
            if !bars.isEmpty { state.bars = bars }
            let view = OverlayView(state: state)
                .background(LinearGradient(colors: [Color(white: 0.92), Color(white: 0.55)], startPoint: .top, endPoint: .bottom))
            let renderer = ImageRenderer(content: view)
            renderer.scale = 2
            guard let image = renderer.nsImage, let tiff = image.tiffRepresentation,
                  let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { continue }
            try png.write(to: dir.appendingPathComponent("overlay-\(name).png"))
        }
    }
}
