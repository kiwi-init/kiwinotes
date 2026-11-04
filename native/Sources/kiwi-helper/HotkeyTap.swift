import CoreGraphics
import Foundation
import KiwiHelperCore

/// Listen-only CGEventTap: sees the dictation key in any app without blocking or changing events.
/// Needs Input Monitoring only (a tap that swallows events would need Accessibility).
final class HotkeyTap {
    enum Event {
        /// `note`: ⌥ was held as the key went down (the quick note, T1320).
        case down(TimeInterval, note: Bool)
        case up(TimeInterval)
        case otherKey
        /// The combination that opens the Notes window was pressed (`hotkey.notes`, T1499).
        case notesShortcut
    }

    var key: HotkeyKey
    /// The combination that opens the Notes window; nil: off (until the app sends it in `config.set`).
    var notesCombo: KeyCombo?
    private let onEvent: (Event) -> Void
    private var tap: CFMachPort?
    private var source: CFRunLoopSource?
    private var keyIsDown = false
    /// This press started with ⌥ held: ⌥ going up or down meanwhile is part of the gesture.
    private var noteHeld = false
    /// The dictation key went down as part of the Notes combination (T1653): neither its down nor its up is a gesture.
    private var chordPress = false

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

    private static let ownPID = Int64(getpid())

    func stop() {
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        if let tap { CFMachPortInvalidate(tap) }
        tap = nil
        source = nil
        keyIsDown = false
        noteHeld = false
        chordPress = false
    }

    private func handle(type: CGEventType, event: CGEvent) {
        // Our own ⌘V (Inserter.postCommandV) passes through this tap too. With the hotkey already held for the
        // next dictation, its ⌘↓ and V↓ would count as "another key" and cancel that recording (review #300).
        if event.getIntegerValueField(.eventSourceUnixProcessID) == Self.ownPID { return }
        switch type {
        case .tapDisabledByTimeout, .tapDisabledByUserInput:
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
        case .flagsChanged:
            let code = event.getIntegerValueField(.keyboardEventKeycode)
            if let down = key.isDown(keyCode: code, flags: event.flags.rawValue) {
                if chordPress {
                    if !down { chordPress = false }
                    return
                }
                if down, !keyIsDown, notesCombo?.startsWith(key, flags: event.flags.rawValue) == true {
                    chordPress = true
                    return
                }
                guard down != keyIsDown else { return }
                keyIsDown = down
                let now = ProcessInfo.processInfo.systemUptime
                if down {
                    noteHeld = key.noteModifierHeld(flags: event.flags.rawValue)
                    onEvent(.down(now, note: noteHeld))
                } else {
                    noteHeld = false
                    onEvent(.up(now))
                }
            } else if keyIsDown, noteHeld, key.isNoteModifier(keyCode: code) {
                return // letting go of ⌥ in a quick note
            } else if keyIsDown {
                onEvent(.otherKey) // e.g. ⌥ right + ⇧: used as a modifier
            }
        case .keyDown:
            if keyIsDown { onEvent(.otherKey) }
            let code = event.getIntegerValueField(.keyboardEventKeycode)
            let repeated = event.getIntegerValueField(.keyboardEventAutorepeat) != 0
            if let combo = notesCombo, combo.matches(keyCode: code, flags: event.flags.rawValue, autorepeat: repeated, typed: {
                KeyboardLayout.character(forKeyCode: code, withCommand: combo.usesCommandLayer)
            }) {
                onEvent(.notesShortcut)
            }
        default:
            break
        }
    }
}
