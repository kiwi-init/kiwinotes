import Foundation

/// An exact output device/channel, never the newly selected default during restoration.
public struct MediaVolumeTarget: Hashable, Sendable {
    public let device: UInt32
    public let uid: String
    public let channel: UInt32
    public init(device: UInt32, uid: String, channel: UInt32) { self.device = device; self.uid = uid; self.channel = channel }
}
public protocol MediaVolumeControl: AnyObject {
    func targets() -> [MediaVolumeTarget]
    func read(_ target: MediaVolumeTarget) -> Float?
    func write(_ value: Float, to target: MediaVolumeTarget) -> Bool
}

/// Original Kiwi implementation of the approved lower-volume option. No player commands, devices or timers here.
/// Main-thread ownership lasts only through microphone capture, not transcription/insertion or meetings.
public final class DictationMedia {
    private let volume: MediaVolumeControl?
    private let notify: (String) -> Void
    private var active = false
    private var changed: [(target: MediaVolumeTarget, original: Float, lowered: Float)] = []
    public init(volume: MediaVolumeControl?, notify: @escaping (String) -> Void = { _ in }) {
        self.volume = volume; self.notify = notify
    }
    public func begin(meetingActive: Bool = false) {
        if meetingActive { end(); return }
        guard !active else { return }
        active = true
        guard let volume else { return } // headless/debug: even volume reads are disabled
        let targets = volume.targets()
        guard !targets.isEmpty else { notify("media: volume_unavailable"); return }
        for target in targets {
            guard let original = volume.read(target), original.isFinite, original >= 0, original <= 1 else {
                notify("media: volume_unavailable"); continue
            }
            if original == 0 { continue }
            let lowered = original * 0.25
            guard volume.write(lowered, to: target) else { notify("media: volume_unavailable"); continue }
            // Drivers may quantize scalar volume. Remember the value they actually accepted.
            let actual = volume.read(target) ?? lowered
            changed.append((target, original, actual))
        }
        if !changed.isEmpty { notify("media: lowered") }
    }
    public func end() {
        active = false
        let owned = changed; changed.removeAll()
        guard let volume else { return }
        for item in owned {
            // Respect manual changes, disconnects and reused device IDs. Never change the new default output.
            guard let current = volume.read(item.target), abs(current - item.lowered) < 0.0001 else { continue }
            if !volume.write(item.original, to: item.target) { notify("media: restore_unavailable") }
        }
        if !owned.isEmpty { notify("media: released") }
    }
    /// Capture failure has the same restoration guarantee as finish/cancel. Preparation never blocks capture.
    public func startCapture(meetingActive: Bool = false, _ start: () throws -> Void) rethrows {
        begin(meetingActive: meetingActive)
        do { try start() } catch { end(); throw error }
    }
}
