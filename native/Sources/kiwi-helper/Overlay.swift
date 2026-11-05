import AppKit
import KiwiHelperCore
import SwiftUI

/// The dictation pill (T56, ADR 0005): a non-activating NSPanel at the bottom of the screen, above the
/// Dock. While listening it has ✕ (cancel) and ✓ (finish) buttons. It never becomes key or main, so the
/// app being dictated into keeps the focus and the keyboard, even after a click on a button.
/// Call everything on the main thread.
final class Overlay {
    static let panelSize = CGSize(width: 360, height: 64)
    /// Transparent room under the pill for its shadow.
    static let pillBottom: CGFloat = 14

    /// ✕: throw the recording away.
    var onCancel: (() -> Void)?
    /// ✓: stop and transcribe, like letting go of the key.
    var onFinish: (() -> Void)?
    /// The pill came up (true) or left (false): the meeting panel steps aside meanwhile (R2).
    var onVisibleChange: ((Bool) -> Void)?

    private let state = OverlayViewState()
    private var panel: NSPanel?
    private var model = OverlayModel()
    private var hideTimer: Timer?
    private var orderOutWork: DispatchWorkItem?
    private var mouseTimer: Timer?

    init() {
        state.onCancel = { [weak self] in self?.onCancel?() }
        state.onFinish = { [weak self] in self?.onFinish?() }
    }

    /// False in `--headless` (T1739): the pill never shows, nothing reaches the screen.
    var enabled = true

    /// `overlay.state` from the app, or the sidecar's own recording events.
    func set(_ phase: OverlayPhase, message: String? = nil) {
        guard enabled else { return }
        let wasVisible = model.isVisible
        model.set(phase, message: message, at: ProcessInfo.processInfo.systemUptime)
        publish()
        if model.isVisible, !wasVisible { show() }
        if !model.isVisible, wasVisible { hide() }
        scheduleHide()
        trackMouse(model.phase == .listening)
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
        // Hiding keeps the last visible phase on screen while it fades: switching to `.hidden` here would
        // swap the ✓ (or the error) for the waveform for the length of the fade.
        guard model.phase != .hidden else { return }
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
            self.trackMouse(false)
        }
    }

    // MARK: Clicks

    /// The panel is wider and taller than the pill (room for an error message and the shadow). Taking
    /// clicks on all of it would block a strip of whatever is underneath, the Dock included, so it only
    /// takes them while the mouse is over the pill itself, and only while the buttons are there.
    private func trackMouse(_ on: Bool) {
        guard on else {
            mouseTimer?.invalidate()
            mouseTimer = nil
            panel?.ignoresMouseEvents = true
            return
        }
        guard mouseTimer == nil else { return }
        let timer = Timer(timeInterval: 1.0 / 30, repeats: true) { [weak self] _ in self?.updateMouse() }
        RunLoop.main.add(timer, forMode: .common) // keeps running while a button is being pressed
        mouseTimer = timer
        updateMouse()
    }

    private func updateMouse() {
        guard let panel, let pill = state.pillFrame else { return }
        // SwiftUI's frame is top-left based inside the panel; the screen is bottom-left based.
        let onScreen = CGRect(
            x: panel.frame.minX + pill.minX,
            y: panel.frame.maxY - pill.maxY,
            width: pill.width,
            height: pill.height
        )
        let over = onScreen.contains(NSEvent.mouseLocation)
        if panel.ignoresMouseEvents == over { panel.ignoresMouseEvents = !over }
    }

    // MARK: Panel

    private func show() {
        orderOutWork?.cancel()
        let panel = self.panel ?? makePanel()
        self.panel = panel
        if let screen = Self.targetScreen() {
            let frame = OverlayLayout.frame(
                screen: screen.frame, visible: screen.visibleFrame,
                size: Self.panelSize, pillBottom: Self.pillBottom
            )
            panel.setFrame(frame, display: false)
        }
        state.visible = true
        panel.orderFrontRegardless() // shows without activating us or taking the key window
        onVisibleChange?(true)
    }

    private func hide() {
        state.visible = false
        onVisibleChange?(false)
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
        panel.ignoresMouseEvents = true // until the mouse is over the pill (trackMouse)
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        // Above normal windows and the Dock, on every Space and over full-screen apps.
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .none
        let host = FirstClickHostingView(rootView: OverlayView(state: state))
        host.frame = CGRect(origin: .zero, size: Self.panelSize)
        panel.contentView = host
        return panel
    }
}

private final class OverlayPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
    /// AppKit keeps windows clear of where the Dock and the menu bar could be. `OverlayLayout` already
    /// placed the pill; keep that.
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

/// The panel is never key, so without this the first click would only "focus" it and the button
/// would need a second one.
private final class FirstClickHostingView<Content: View>: NSHostingView<Content> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

// MARK: - SwiftUI

final class OverlayViewState: ObservableObject {
    @Published var visible = false
    @Published var phase: OverlayPhase = .hidden
    @Published var message: String?
    @Published var bars: [Float] = Array(repeating: 0, count: 13)
    /// Where the pill is inside the panel (top-left based), for `Overlay.updateMouse`. Not published:
    /// nothing on screen depends on it.
    var pillFrame: CGRect?
    var onCancel: () -> Void = {}
    var onFinish: () -> Void = {}
}

/// Colors and motion. The pill is dark over anything, like the reference harry picked (#262); the
/// accent and danger colors and the springs come from `app/ui/src/styles/tokens.css`.
enum OverlayStyle {
    static let accent = Color(red: 0x8C / 255, green: 0xC4 / 255, blue: 0x6A / 255) // --accent (dark)
    static let danger = Color(red: 1, green: 0x69 / 255, blue: 0x61 / 255) // --danger (dark)
    static let text = Color(red: 0xF5 / 255, green: 0xF5 / 255, blue: 0xF7 / 255)
    static let fill = Color(red: 0x12 / 255, green: 0x12 / 255, blue: 0x14 / 255).opacity(0.94)
    static let border = Color.white.opacity(0.14)
    static let wave = Color.white
    static let cancelFill = Color.white.opacity(0.22)
    static let finishFill = Color.white
    static let finishMark = Color(red: 0x12 / 255, green: 0x12 / 255, blue: 0x14 / 255)
    /// --pop: a lively spring with a little overshoot, for showing up and for marks.
    static let pop = Animation.spring(response: 0.35, dampingFraction: 0.68)
    /// --glide: the pill changing width between states.
    static let glide = Animation.spring(response: 0.48, dampingFraction: 0.82)
    /// --fast with --ease, for fading out.
    static let fade = Animation.timingCurve(0.32, 0.72, 0, 1, duration: 0.16)
    static let height: CGFloat = 40
    static let button: CGFloat = 28
}

private struct PillFrameKey: PreferenceKey {
    static var defaultValue: CGRect?
    static func reduce(value: inout CGRect?, nextValue: () -> CGRect?) { value = nextValue() ?? value }
}

struct OverlayView: View {
    @ObservedObject var state: OverlayViewState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack {
            Spacer(minLength: 0)
            pill
                .opacity(state.visible ? 1 : 0)
                .scaleEffect(state.visible || reduceMotion ? 1 : 0.86, anchor: .bottom)
                .offset(y: state.visible || reduceMotion ? 0 : 6)
                .animation(state.visible ? (reduceMotion ? OverlayStyle.fade : OverlayStyle.pop) : OverlayStyle.fade, value: state.visible)
                .padding(.bottom, Overlay.pillBottom)
        }
        .frame(width: Overlay.panelSize.width, height: Overlay.panelSize.height)
        .coordinateSpace(name: "panel")
        .onPreferenceChange(PillFrameKey.self) { state.pillFrame = $0 }
    }

    private var pill: some View {
        content
            .padding(.horizontal, state.phase == .listening ? 6 : 14)
            .frame(height: OverlayStyle.height)
            .background(
                Capsule(style: .continuous)
                    .fill(OverlayStyle.fill)
                    .overlay(Capsule(style: .continuous).strokeBorder(OverlayStyle.border, lineWidth: 0.5))
                    .shadow(color: .black.opacity(0.35), radius: 10, y: 4)
            )
            .background(GeometryReader { g in
                Color.clear.preference(key: PillFrameKey.self, value: g.frame(in: .named("panel")))
            })
            .animation(reduceMotion ? nil : OverlayStyle.glide, value: state.phase)
    }

    @ViewBuilder
    private var content: some View {
        switch state.phase {
        case .listening, .hidden:
            HStack(spacing: 10) {
                RoundButton(
                    symbol: "xmark", fill: OverlayStyle.cancelFill, mark: .white,
                    label: "Cancelar ditado", action: state.onCancel
                )
                Waveform(bars: state.bars, reduceMotion: reduceMotion)
                RoundButton(
                    symbol: "checkmark", fill: OverlayStyle.finishFill, mark: OverlayStyle.finishMark,
                    label: "Terminar ditado", action: state.onFinish
                )
            }
            .transition(.opacity)
        case .processing:
            ThinkingDots(reduceMotion: reduceMotion)
                .transition(.opacity)
        case .done:
            if let message = state.message {
                // Done, with something to know (secure input left the text on the clipboard, #224).
                HStack(spacing: 8) {
                    Image(systemName: "checkmark")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(OverlayStyle.accent)
                    Text(message)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(OverlayStyle.text)
                        .lineLimit(1)
                }
                .fixedSize()
                .transition(.opacity)
            } else {
                Image(systemName: "checkmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(OverlayStyle.accent)
                    .transition(reduceMotion ? .opacity : .scale(scale: 0.4).combined(with: .opacity))
            }
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

/// ✕ and ✓: round, one tap.
struct RoundButton: View {
    let symbol: String
    let fill: Color
    let mark: Color
    let label: String
    let action: () -> Void
    @State private var pressed = false

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(mark)
                .frame(width: OverlayStyle.button, height: OverlayStyle.button)
                .background(Circle().fill(fill))
                .contentShape(Circle())
        }
        .buttonStyle(PressScale())
        .accessibilityLabel(label)
    }
}

private struct PressScale: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.9 : 1)
            .animation(.spring(response: 0.2, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

/// White bars, mirrored around the middle one (`OverlayModel.bars`).
struct Waveform: View {
    let bars: [Float]
    let reduceMotion: Bool

    var body: some View {
        HStack(alignment: .center, spacing: 3) {
            ForEach(bars.indices, id: \.self) { i in
                Capsule(style: .continuous)
                    .fill(OverlayStyle.wave)
                    .frame(width: 3, height: max(4, CGFloat(bars[i]) * 22))
            }
        }
        .frame(height: 22)
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
                    .fill(OverlayStyle.wave)
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
        func listening(_ levels: [Float]) -> [Float] {
            var m = OverlayModel()
            m.set(.listening, at: 0)
            levels.forEach { m.push(level: $0) }
            return m.bars
        }
        let samples: [(String, OverlayPhase, String?, [Float])] = [
            ("listening-quiet", .listening, nil, listening(Array(repeating: 0.02, count: 7))),
            ("listening-speech", .listening, nil, listening([0.1, 0.5, 0.3, 0.8, 0.6, 1, 0.4])),
            ("processing", .processing, nil, []),
            ("done", .done, nil, []),
            ("done-message", .done, "O texto também ficou no clipboard", []),
            ("error", .error, OverlayText.error("no_input_device"), []),
            ("error-mic-busy", .error, MicBusy.message(app: "Chrome"), []),
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
