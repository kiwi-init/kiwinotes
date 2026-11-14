import AppKit
import KiwiHelperCore
import SwiftUI

/// L26 (T6910): "Adicionar ao dicionário? Pax → PACS", with "Agora não" and "Adicionar", where the pill shows up. A
/// non-activating panel like the meeting one (ADR 0005): it never takes the focus or the keyboard from the field the
/// person is fixing. It sits above the meeting panel when that one is on screen. Call it on the main thread.
final class LearnPanel {
    var onAnswer: ((LearnAnswer) -> Void)?
    /// False in `--headless`: nothing reaches the screen.
    var enabled = true
    /// How far above the pill's place the card goes (the meeting panel's height while it is up).
    var lift: () -> CGFloat = { 0 }

    private let state = LearnViewState()
    private var panel: NSPanel?
    private var orderOutWork: DispatchWorkItem?
    private var mouseTimer: Timer?

    init() {
        state.onAnswer = { [weak self] in self?.onAnswer?($0) }
    }

    func show(_ offer: LearnOffer?) {
        guard enabled else { return }
        if let offer {
            state.offer = offer
            present()
        } else {
            dismiss()
        }
    }

    private func present() {
        orderOutWork?.cancel()
        let panel = self.panel ?? makePanel()
        self.panel = panel
        if let screen = Self.targetScreen() {
            var frame = OverlayLayout.frame(screen: screen.frame, visible: screen.visibleFrame, size: LearnView.panelSize, pillBottom: LearnView.bottom)
            frame.origin.y += lift()
            panel.setFrame(frame, display: false)
        }
        state.visible = true
        panel.orderFrontRegardless()
        trackMouse(true)
    }

    private func dismiss() {
        guard state.visible else { return }
        state.visible = false
        trackMouse(false)
        let work = DispatchWorkItem { [weak self] in self?.panel?.orderOut(nil) }
        orderOutWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: work)
    }

    /// The same cause as the meeting panel (spec #12845): the panel is 480×92 and the card is smaller, so it only takes
    /// clicks while the mouse is over the card (`OverlayLayout.takesClick`).
    private func trackMouse(_ on: Bool) {
        guard on else {
            mouseTimer?.invalidate()
            mouseTimer = nil
            panel?.ignoresMouseEvents = true
            return
        }
        guard mouseTimer == nil else { return }
        let timer = Timer(timeInterval: 1.0 / 30, repeats: true) { [weak self] _ in self?.updateMouse() }
        RunLoop.main.add(timer, forMode: .common)
        mouseTimer = timer
        updateMouse()
    }

    private func updateMouse() {
        guard let panel else { return }
        let take = OverlayLayout.takesClick(panel: panel.frame, pill: state.cardFrame, mouse: NSEvent.mouseLocation)
        if panel.ignoresMouseEvents == take { panel.ignoresMouseEvents = !take }
    }

    private static func targetScreen() -> NSScreen? {
        let mouse = NSEvent.mouseLocation
        return NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
    }

    private func makePanel() -> NSPanel {
        let panel = LearnNSPanel(
            contentRect: CGRect(origin: .zero, size: LearnView.panelSize),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: true
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true // until the mouse is over the card (trackMouse)
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .none
        let host = LearnHostingView(rootView: LearnView(state: state))
        host.frame = CGRect(origin: .zero, size: LearnView.panelSize)
        panel.contentView = host
        return panel
    }
}

private final class LearnNSPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

/// Never key, so the first click has to count.
private final class LearnHostingView<Content: View>: NSHostingView<Content> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

final class LearnViewState: ObservableObject {
    @Published var visible = false
    @Published var offer = LearnOffer(from: "", to: "")
    var onAnswer: (LearnAnswer) -> Void = { _ in }
    /// Where the card is inside the panel (top-left based), for `LearnPanel.updateMouse`.
    var cardFrame: CGRect?
}

private struct LearnCardFrameKey: PreferenceKey {
    static var defaultValue: CGRect?
    static func reduce(value: inout CGRect?, nextValue: () -> CGRect?) { value = nextValue() ?? value }
}

enum LearnText {
    static let title = "Adicionar ao dicionário?"
    static let notNow = "Agora não"
    static let add = "Adicionar"
    static func swap(_ offer: LearnOffer) -> String { "\(offer.from) → \(offer.to)" }
}

struct LearnView: View {
    static let panelSize = CGSize(width: 480, height: 92)
    /// Transparent room under the card for its shadow.
    static let bottom: CGFloat = 14

    @ObservedObject var state: LearnViewState
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack {
            Spacer(minLength: 0)
            card
                .background(GeometryReader { g in
                    Color.clear.preference(key: LearnCardFrameKey.self, value: g.frame(in: .named("learn")))
                })
                .opacity(state.visible ? 1 : 0)
                .scaleEffect(state.visible || reduceMotion ? 1 : 0.9, anchor: .bottom)
                .offset(y: state.visible || reduceMotion ? 0 : 6)
                .animation(state.visible ? (reduceMotion ? OverlayStyle.fade : OverlayStyle.pop) : OverlayStyle.fade, value: state.visible)
                .padding(.bottom, Self.bottom)
        }
        .frame(width: Self.panelSize.width, height: Self.panelSize.height)
        .coordinateSpace(name: "learn")
        .onPreferenceChange(LearnCardFrameKey.self) { state.cardFrame = $0 }
    }

    private var card: some View {
        HStack(spacing: 12) {
            Image(systemName: "character.book.closed")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(MeetingStyle.accent(scheme))
            VStack(alignment: .leading, spacing: 2) {
                Text(LearnText.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(MeetingStyle.text(scheme))
                Text(LearnText.swap(state.offer))
                    .font(.system(size: 12))
                    .foregroundStyle(MeetingStyle.text2(scheme))
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(maxWidth: 220, alignment: .leading)
            }
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 20)
            MeetingButton(label: LearnText.notNow, fill: MeetingStyle.quiet(scheme), text: MeetingStyle.text(scheme)) {
                state.onAnswer(.notNow)
            }
            MeetingButton(label: LearnText.add, fill: MeetingStyle.accent(scheme), text: MeetingStyle.onAccent(scheme)) {
                state.onAnswer(.add)
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, 10)
        .frame(height: 56)
        .fixedSize()
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(MeetingStyle.surface(scheme))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(MeetingStyle.border(scheme), lineWidth: 0.5))
                .shadow(color: .black.opacity(scheme == .dark ? 0.45 : 0.16), radius: 12, y: 4)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(LearnText.title) \(LearnText.swap(state.offer))")
    }
}

// MARK: - Snapshots (dev)

enum LearnSnapshots {
    /// Part of `kiwi-helper --overlay-snapshot <dir>`: the card, light and dark, off screen.
    @MainActor
    static func write(to dir: URL) throws {
        let samples: [(String, LearnOffer)] = [
            ("pax", LearnOffer(from: "Pax", to: "PACS")),
            ("long", LearnOffer(from: "cube control get", to: "kubectl get")),
        ]
        for (name, offer) in samples {
            for scheme in [ColorScheme.light, .dark] {
                let state = LearnViewState()
                state.visible = true
                state.offer = offer
                let background = scheme == .dark
                    ? [Color(white: 0.28), Color(white: 0.08)]
                    : [Color(white: 0.96), Color(white: 0.72)]
                let view = LearnView(state: state)
                    .environment(\.colorScheme, scheme)
                    .background(LinearGradient(colors: background, startPoint: .top, endPoint: .bottom))
                let renderer = ImageRenderer(content: view)
                renderer.scale = 2
                guard let image = renderer.nsImage, let tiff = image.tiffRepresentation,
                      let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { continue }
                try png.write(to: dir.appendingPathComponent("learn-\(name)-\(scheme == .dark ? "dark" : "light").png"))
            }
        }
    }
}
