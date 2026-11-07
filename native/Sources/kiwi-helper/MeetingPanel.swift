import AppKit
import KiwiHelperCore
import SwiftUI

/// The meeting panel (R2, #195): "Gravar esta reunião?", "A reunião acabou?" and, while it records, the meeting
/// pill with the time, "pausar meu mic" and ✓ to stop. A non-activating panel at the bottom of the screen, like the
/// dictation pill (ADR 0005): it never takes the focus or the keyboard from the meeting. It steps aside while the
/// dictation pill is on screen (dictating with Fn during a meeting goes on working). Call it on the main thread.
final class MeetingPanel {
    var onAnswer: ((MeetingDetector.Answer) -> Void)?
    /// ✓ on the pill: stop recording.
    var onStop: (() -> Void)?
    /// The mic button on the pill: pause or resume the "you" channel.
    var onTogglePause: (() -> Void)?

    /// False in `--headless`: nothing reaches the screen.
    var enabled = true

    private let state = MeetingViewState()
    private var panel: NSPanel?
    private var shown: MeetingDetector.Panel = .hidden
    /// The dictation pill is on screen: the meeting panel waits.
    private var dictating = false
    private var clock: Timer?
    private var orderOutWork: DispatchWorkItem?

    init() {
        state.onAnswer = { [weak self] in self?.onAnswer?($0) }
        state.onStop = { [weak self] in self?.onStop?() }
        state.onTogglePause = { [weak self] in self?.onTogglePause?() }
    }

    /// The panel is on screen (the learn card goes above it).
    var isShowing: Bool { state.visible }

    /// What the detector says to show. `now` is the detector's clock (`systemUptime`).
    func show(_ panel: MeetingDetector.Panel) {
        guard enabled else { return }
        shown = panel
        update()
    }

    /// The dictation pill appeared or left.
    func setDictating(_ on: Bool) {
        guard on != dictating else { return }
        dictating = on
        update()
    }

    private func update() {
        let visible = shown != .hidden && !dictating
        if shown != .hidden { state.panel = shown }
        tickClock()
        if case .recording = shown {
            if clock == nil {
                let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in self?.tickClock() }
                RunLoop.main.add(timer, forMode: .common)
                clock = timer
            }
        } else {
            clock?.invalidate()
            clock = nil
        }
        if visible { present() } else { dismiss() }
    }

    private func tickClock() {
        guard case let .recording(_, since, _) = shown else { return }
        state.elapsed = MeetingText.elapsed(ProcessInfo.processInfo.systemUptime - since)
    }

    // MARK: Panel

    private func present() {
        orderOutWork?.cancel()
        let panel = self.panel ?? makePanel()
        self.panel = panel
        // Placed when it shows up; while it's on screen it stays put (no jumping to the mouse's screen mid-meeting).
        if !state.visible, let screen = Self.targetScreen() {
            let size = MeetingView.panelSize
            let frame = OverlayLayout.frame(screen: screen.frame, visible: screen.visibleFrame, size: size, pillBottom: MeetingView.bottom)
            panel.setFrame(frame, display: false)
        }
        state.visible = true
        panel.ignoresMouseEvents = false
        panel.orderFrontRegardless()
    }

    private func dismiss() {
        guard state.visible else { return }
        state.visible = false
        panel?.ignoresMouseEvents = true
        let work = DispatchWorkItem { [weak self] in self?.panel?.orderOut(nil) }
        orderOutWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: work)
    }

    private static func targetScreen() -> NSScreen? {
        let mouse = NSEvent.mouseLocation
        return NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
    }

    private func makePanel() -> NSPanel {
        let panel = MeetingNSPanel(
            contentRect: CGRect(origin: .zero, size: MeetingView.panelSize),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: true
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .none
        let host = MeetingHostingView(rootView: MeetingView(state: state))
        host.frame = CGRect(origin: .zero, size: MeetingView.panelSize)
        panel.contentView = host
        return panel
    }
}

private final class MeetingNSPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

/// Never key, so the first click has to count.
private final class MeetingHostingView<Content: View>: NSHostingView<Content> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

// MARK: - SwiftUI

final class MeetingViewState: ObservableObject {
    @Published var visible = false
    @Published var panel: MeetingDetector.Panel = .hidden
    @Published var elapsed = "0:00"
    /// Snapshots: the dot doesn't breathe, so the PNG shows it at full color.
    var still = false
    var onAnswer: (MeetingDetector.Answer) -> Void = { _ in }
    var onStop: () -> Void = {}
    var onTogglePause: () -> Void = {}
}

/// The app's colors (`app/ui/src/styles/tokens.css`), light and dark: the meeting panel follows the system theme.
enum MeetingStyle {
    static func surface(_ s: ColorScheme) -> Color { s == .dark ? Color(hex: 0x18181A) : .white }
    static func text(_ s: ColorScheme) -> Color { s == .dark ? Color(hex: 0xECECEF) : Color(hex: 0x18181B) }
    static func text2(_ s: ColorScheme) -> Color { s == .dark ? Color(hex: 0xA3A3AB) : Color(hex: 0x56565E) }
    static func border(_ s: ColorScheme) -> Color { s == .dark ? .white.opacity(0.15) : .black.opacity(0.13) }
    static func accent(_ s: ColorScheme) -> Color { s == .dark ? Color(hex: 0x8AB4FF) : Color(hex: 0x1A56DB) }
    static func onAccent(_ s: ColorScheme) -> Color { s == .dark ? Color(hex: 0x0B1A33) : .white }
    static func danger(_ s: ColorScheme) -> Color { s == .dark ? Color(hex: 0xFF6259) : Color(hex: 0xD1342A) }
    static func quiet(_ s: ColorScheme) -> Color { s == .dark ? .white.opacity(0.1) : .black.opacity(0.06) }
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double(hex >> 16 & 0xFF) / 255, green: Double(hex >> 8 & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
}

struct MeetingView: View {
    static let panelSize = CGSize(width: 480, height: 92)
    /// Transparent room under the card for its shadow.
    static let bottom: CGFloat = 14

    @ObservedObject var state: MeetingViewState
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack {
            Spacer(minLength: 0)
            content
                .opacity(state.visible ? 1 : 0)
                .scaleEffect(state.visible || reduceMotion ? 1 : 0.9, anchor: .bottom)
                .offset(y: state.visible || reduceMotion ? 0 : 6)
                .animation(state.visible ? (reduceMotion ? OverlayStyle.fade : OverlayStyle.pop) : OverlayStyle.fade, value: state.visible)
                .padding(.bottom, Self.bottom)
        }
        .frame(width: Self.panelSize.width, height: Self.panelSize.height)
    }

    @ViewBuilder
    private var content: some View {
        switch state.panel {
        case .hidden:
            EmptyView()
        case let .suggest(app):
            question(
                title: MeetingText.suggestTitle, detail: MeetingText.from(app),
                secondary: (MeetingText.notNow, .notNow), primary: (MeetingText.record, .record)
            )
        case let .askEnded(app):
            question(
                title: MeetingText.askEndedTitle, detail: MeetingText.released(app, minutes: 2),
                secondary: (MeetingText.keepGoing, .keepGoing), primary: (MeetingText.stop, .stop)
            )
        case let .recording(_, _, minePaused):
            recordingPill(minePaused: minePaused)
        }
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content()
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(MeetingStyle.surface(scheme))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(MeetingStyle.border(scheme), lineWidth: 0.5))
                    .shadow(color: .black.opacity(scheme == .dark ? 0.45 : 0.16), radius: 12, y: 4)
            )
    }

    private func question(
        title: String, detail: String,
        secondary: (String, MeetingDetector.Answer), primary: (String, MeetingDetector.Answer)
    ) -> some View {
        card {
            HStack(spacing: 12) {
                RecordDot(color: MeetingStyle.danger(scheme), pulse: false)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(MeetingStyle.text(scheme))
                    Text(detail)
                        .font(.system(size: 12))
                        .foregroundStyle(MeetingStyle.text2(scheme))
                        .lineLimit(1)
                }
                .fixedSize()
                Spacer(minLength: 20)
                MeetingButton(label: secondary.0, fill: MeetingStyle.quiet(scheme), text: MeetingStyle.text(scheme)) {
                    state.onAnswer(secondary.1)
                }
                MeetingButton(label: primary.0, fill: MeetingStyle.accent(scheme), text: MeetingStyle.onAccent(scheme)) {
                    state.onAnswer(primary.1)
                }
            }
            .padding(.leading, 14)
            .padding(.trailing, 10)
            .frame(height: 56)
            .fixedSize()
        }
    }

    private func recordingPill(minePaused: Bool) -> some View {
        HStack(spacing: 10) {
            RecordDot(color: MeetingStyle.danger(scheme), pulse: !reduceMotion && !state.still)
                .padding(.leading, 6)
            Text(state.elapsed)
                .font(.system(size: 13, weight: .semibold).monospacedDigit())
                .foregroundStyle(MeetingStyle.text(scheme))
                .frame(minWidth: 40, alignment: .leading)
            CircleButton(
                symbol: minePaused ? "mic.slash.fill" : "mic.fill",
                fill: minePaused ? MeetingStyle.danger(scheme).opacity(0.16) : MeetingStyle.quiet(scheme),
                mark: minePaused ? MeetingStyle.danger(scheme) : MeetingStyle.text(scheme),
                label: minePaused ? "Voltar meu mic" : "Pausar meu mic",
                action: state.onTogglePause
            )
            CircleButton(
                symbol: "checkmark", fill: MeetingStyle.accent(scheme), mark: MeetingStyle.onAccent(scheme),
                label: "Parar a gravação", action: state.onStop
            )
        }
        .padding(.horizontal, 6)
        .frame(height: OverlayStyle.height)
        .background(
            Capsule(style: .continuous)
                .fill(MeetingStyle.surface(scheme))
                .overlay(Capsule(style: .continuous).strokeBorder(MeetingStyle.border(scheme), lineWidth: 0.5))
                .shadow(color: .black.opacity(scheme == .dark ? 0.45 : 0.16), radius: 10, y: 4)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Gravando a reunião, \(state.elapsed)")
    }
}

/// The red dot of a recording; it breathes while recording.
struct RecordDot: View {
    let color: Color
    let pulse: Bool
    @State private var on = false

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 10, height: 10)
            .opacity(pulse && on ? 0.45 : 1)
            .animation(pulse ? .easeInOut(duration: 0.9).repeatForever() : nil, value: on)
            .onAppear { on = pulse }
    }
}

struct MeetingButton: View {
    let label: String
    let fill: Color
    let text: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(text)
                .lineLimit(1)
                .fixedSize()
                .padding(.horizontal, 12)
                .frame(height: 28)
                .background(Capsule(style: .continuous).fill(fill))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

struct CircleButton: View {
    let symbol: String
    let fill: Color
    let mark: Color
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(mark)
                .frame(width: OverlayStyle.button, height: OverlayStyle.button)
                .background(Circle().fill(fill))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

// MARK: - Snapshots (dev)

enum MeetingSnapshots {
    /// Part of `kiwi-helper --overlay-snapshot <dir>`: the meeting panel in each state, light and dark, off screen.
    @MainActor
    static func write(to dir: URL) throws {
        let teams = MeetingApp(bundleId: "com.microsoft.teams2", name: "Teams")
        let samples: [(String, MeetingDetector.Panel)] = [
            ("suggest", .suggest(teams)),
            ("ask-ended", .askEnded(teams)),
            ("recording", .recording(app: teams, since: 0, minePaused: false)),
            ("recording-mine-paused", .recording(app: teams, since: 0, minePaused: true)),
        ]
        for (name, panel) in samples {
            for scheme in [ColorScheme.light, .dark] {
                let state = MeetingViewState()
                state.visible = true
                state.panel = panel
                state.elapsed = "12:05"
                state.still = true
                let background = scheme == .dark
                    ? [Color(white: 0.28), Color(white: 0.08)]
                    : [Color(white: 0.96), Color(white: 0.72)]
                let view = MeetingView(state: state)
                    .environment(\.colorScheme, scheme)
                    .background(LinearGradient(colors: background, startPoint: .top, endPoint: .bottom))
                let renderer = ImageRenderer(content: view)
                renderer.scale = 2
                guard let image = renderer.nsImage, let tiff = image.tiffRepresentation,
                      let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { continue }
                try png.write(to: dir.appendingPathComponent("meeting-\(name)-\(scheme == .dark ? "dark" : "light").png"))
            }
        }
    }
}
