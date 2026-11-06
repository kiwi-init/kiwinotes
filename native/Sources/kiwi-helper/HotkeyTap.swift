import ApplicationServices
import CoreGraphics
import Foundation
import KiwiHelperCore

/// The keyboard tap behind every shortcut (T5349, #175). It sees the keys in any app, hands them to `ShortcutEngine`,
/// and drops the ones that are Kiwi's, so a shortcut another app also uses is Kiwi's and doesn't reach that app.
///
/// Dropping events takes an active tap, and macOS only gives one to an app with Accessibility (which Kiwi already has
/// to paste). Without it the tap is listen-only, as before T5349: it needs Input Monitoring only, every shortcut still
/// works, but the keystroke also reaches the app in front (`hasPriority` false, and the menu says so).
final class HotkeyTap {
    enum Event {
        case shortcut(ShortcutOutput)
        /// The recorder of Settings ended (`shortcut.record`).
        case recorded(ShortcutRecorder.Outcome)
    }

    private let onEvent: (Event) -> Void
    private var tap: CFMachPort?
    private var source: CFRunLoopSource?
    private var engine: ShortcutEngine<CGEvent>
    private var recorder: ShortcutRecorder?
    private var timer: DispatchWorkItem?
    /// The tap drops Kiwi's keystrokes (an active tap). False: listen-only, or not running.
    private(set) var hasPriority = false

    /// What the replayed events of a broken sequence carry in `eventSourceUserData`, so the tap lets them through.
    private static let replayMark: Int64 = 0x4B49_5749 // "KIWI"
    private static let ownPID = Int64(getpid())

    init(onEvent: @escaping (Event) -> Void) {
        self.onEvent = onEvent
        engine = ShortcutEngine(typed: { code, command in KeyboardLayout.character(forKeyCode: code, withCommand: command) })
    }

    var isRunning: Bool { tap != nil }

    /// The shortcuts, by id. What was half done (a sequence under way) is forgotten.
    var bindings: [(id: String, shortcut: Shortcut)] {
        get { engine.bindings }
        set {
            engine.setBindings(newValue)
            schedule()
        }
    }

    var timings: (doubleTap: TimeInterval, tap: TimeInterval) {
        get { (engine.doubleTapWindow, engine.tapThreshold) }
        set { engine.doubleTapWindow = newValue.doubleTap; engine.tapThreshold = newValue.tap }
    }

    /// Returns false when Input Monitoring hasn't been granted yet. With Accessibility, the tap is active.
    @discardableResult
    func start() -> Bool {
        guard tap == nil else { return true }
        let mask = (1 << CGEventType.flagsChanged.rawValue) | (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue)
        let callback: CGEventTapCallBack = { _, type, event, refcon in
            let me = Unmanaged<HotkeyTap>.fromOpaque(refcon!).takeUnretainedValue()
            return me.handle(type: type, event: event) ? nil : Unmanaged.passUnretained(event)
        }
        let active = AXIsProcessTrusted()
        let make = { (options: CGEventTapOptions) in
            CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: options,
                              eventsOfInterest: CGEventMask(mask), callback: callback,
                              userInfo: Unmanaged.passUnretained(self).toOpaque())
        }
        // An active tap can still be refused (a stale Accessibility grant): then listen-only, as before T5349.
        var created = active ? make(.defaultTap) : nil
        hasPriority = created != nil
        if created == nil { created = make(.listenOnly) }
        guard let tap = created else { return false }
        let source = CFMachPortCreateRunLoopSource(nil, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        self.tap = tap
        self.source = source
        return true
    }

    func stop() {
        if recorder != nil { finishRecording(.cancelled) }
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        if let tap { CFMachPortInvalidate(tap) }
        tap = nil
        source = nil
        hasPriority = false
        engine.setBindings(engine.bindings)
        timer?.cancel()
    }

    // MARK: Recording a shortcut (Settings)

    /// Starts "aperte o atalho": until it ends, the keys go to the recorder, no shortcut fires, and (with priority) no
    /// keystroke reaches the app in front. Ends in `.recorded`.
    func record() {
        recorder = ShortcutRecorder(typed: { code, command in KeyboardLayout.character(forKeyCode: code, withCommand: command) })
        engine.setBindings(engine.bindings)
        schedule()
    }

    func cancelRecording() {
        guard recorder != nil else { return }
        finishRecording(.cancelled)
    }

    var isRecordingShortcut: Bool { recorder != nil }

    private func finishRecording(_ outcome: ShortcutRecorder.Outcome) {
        recorder = nil
        schedule()
        onEvent(.recorded(outcome))
    }

    // MARK: Events

    /// Whether to drop the event.
    private func handle(type: CGEventType, event: CGEvent) -> Bool {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            return false
        }
        // Our own ⌘V (Inserter.postCommandV) passes through this tap too. With the hotkey already held for the
        // next dictation, its ⌘↓ and V↓ would count as "another key" and cancel that recording (review #300).
        // The same for the keys of a broken sequence, which this tap posts again.
        if event.getIntegerValueField(.eventSourceUnixProcessID) == Self.ownPID
            || event.getIntegerValueField(.eventSourceUserData) == Self.replayMark { return false }
        let code = event.getIntegerValueField(.keyboardEventKeycode)
        let flags = event.flags.rawValue
        let input: KeyInput
        switch type {
        case .flagsChanged: input = .flags(keyCode: code, flags: flags)
        case .keyDown: input = .keyDown(keyCode: code, flags: flags, autorepeat: event.getIntegerValueField(.keyboardEventAutorepeat) != 0)
        case .keyUp: input = .keyUp(keyCode: code, flags: flags)
        default: return false
        }
        let now = ProcessInfo.processInfo.systemUptime

        if recorder != nil {
            recorder?.feed(input, at: now)
            if let outcome = recorder?.outcome { finishRecording(outcome) } else { schedule() }
            // The modifiers pass, so the other apps don't think one is stuck.
            if case .flags = input { return false }
            return hasPriority
        }

        // The tap keeps its own copy: the event it was given may be gone once it is dropped.
        let result = engine.handle(input, payload: event.copy() ?? event, at: now)
        replay(result.replay)
        schedule()
        result.outputs.forEach { onEvent(.shortcut($0)) }
        return hasPriority && result.consume
    }

    /// Posts again, in order, the keys a sequence held back and gave up on.
    private func replay(_ events: [CGEvent]) {
        guard hasPriority else { return } // listen-only: nothing was held back
        for event in events {
            event.setIntegerValueField(.eventSourceUserData, value: Self.replayMark)
            event.post(tap: .cgSessionEventTap)
        }
    }

    /// The next deadline: a sequence's window, or the end of the recording.
    private func schedule() {
        timer?.cancel()
        guard let deadline = recorder?.deadline ?? engine.deadline else { return }
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            let now = ProcessInfo.processInfo.systemUptime
            if self.recorder != nil {
                if let outcome = self.recorder?.tick(now: now) { self.finishRecording(outcome) } else { self.schedule() }
            } else {
                self.replay(self.engine.tick(now: now).replay)
                self.schedule()
            }
        }
        timer = work
        DispatchQueue.main.asyncAfter(deadline: .now() + max(0, deadline - ProcessInfo.processInfo.systemUptime) + 0.01, execute: work)
    }
}
