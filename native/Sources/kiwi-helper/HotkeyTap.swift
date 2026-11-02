import CoreGraphics
import Foundation
import KiwiHelperCore

/// Listen-only CGEventTap: sees the dictation key in any app without blocking or changing events.
/// Needs Input Monitoring only (a tap that swallows events would need Accessibility).
final class HotkeyTap {
    enum Event {
        case down(TimeInterval)
        case up(TimeInterval)
        case otherKey
    }

    var key: HotkeyKey
    private let onEvent: (Event) -> Void
    private var tap: CFMachPort?
    private var source: CFRunLoopSource?
    private var keyIsDown = false

    init(key: HotkeyKey, onEvent: @escaping (Event) -> Void) {
        self.key = key
        self.onEvent = onEvent
    }

    var isRunning: Bool { tap != nil }

    /// Returns false when Input Monitoring hasn't been granted yet.
    @discardableResult
    func start() -> Bool {
        guard tap == nil else { return true }
        let mask = (1 << CGEventType.flagsChanged.rawValue) | (1 << CGEventType.keyDown.rawValue)
        let callback: CGEventTapCallBack = { _, type, event, refcon in
            let me = Unmanaged<HotkeyTap>.fromOpaque(refcon!).takeUnretainedValue()
            me.handle(type: type, event: event)
            return Unmanaged.passUnretained(event)
        }
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: CGEventMask(mask),
            callback: callback,
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ) else { return false }
        let source = CFMachPortCreateRunLoopSource(nil, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        self.tap = tap
        self.source = source
        return true
    }

    func stop() {
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        if let tap { CFMachPortInvalidate(tap) }
        tap = nil
        source = nil
        keyIsDown = false
    }

    private func handle(type: CGEventType, event: CGEvent) {
        switch type {
        case .tapDisabledByTimeout, .tapDisabledByUserInput:
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
        case .flagsChanged:
            let code = event.getIntegerValueField(.keyboardEventKeycode)
            if let down = key.isDown(keyCode: code, flags: event.flags.rawValue) {
                guard down != keyIsDown else { return }
                keyIsDown = down
                let now = ProcessInfo.processInfo.systemUptime
                onEvent(down ? .down(now) : .up(now))
            } else if keyIsDown {
                onEvent(.otherKey) // e.g. ⌥ right + ⇧: used as a modifier
            }
        case .keyDown:
            if keyIsDown { onEvent(.otherKey) }
        default:
            break
        }
    }
}
