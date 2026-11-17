import Foundation

/// An exact output device/channel, never the newly selected default during restoration.
public struct MediaVolumeTarget: Hashable, Codable, Sendable {
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
    private let journal: MediaVolumeJournal?
    private var changed: [MediaVolumeChange] = []
    private var journalBlocked = false
    public init(volume: MediaVolumeControl?, journal: MediaVolumeJournal? = nil, notify: @escaping (String) -> Void = { _ in }) {
        self.volume = volume; self.journal = journal; self.notify = notify
    }
    public func begin(meetingActive: Bool = false) {
        if meetingActive { end(); return }
        guard !active else { return }
        restorePending()
        guard !journalBlocked else { return }
        active = true
        guard let volume else { return } // headless/debug: even volume reads are disabled
        guard let journal else { notify("media: recovery_unavailable"); return }
        let targets = volume.targets()
        guard !targets.isEmpty else { notify("media: volume_unavailable"); return }
        for target in targets {
            // A disconnected old output may still need restoration; do not compound its lease if it returns.
            if changed.contains(where: { $0.target.uid == target.uid && $0.target.channel == target.channel }) { continue }
            guard let original = volume.read(target), original.isFinite, original >= 0, original <= 1 else {
                notify("media: volume_unavailable"); continue
            }
            if original == 0 { continue }
            let lowered = original * 0.25
            let planned = MediaVolumeChange(target: target, original: original, lowered: lowered)
            do { try journal.save(changed + [planned]) }
            catch { notify("media: recovery_unavailable"); return } // no unjournaled volume change
            changed.append(planned)
            guard volume.write(lowered, to: target) else {
                changed.removeLast()
                do { if changed.isEmpty { try journal.clear() } else { try journal.save(changed) } }
                catch { journalBlocked = true; notify("media: recovery_unavailable") }
                notify("media: volume_unavailable"); continue
            }
            // Drivers may quantize scalar volume. Persist what they actually accepted as well.
            let actual = volume.read(target) ?? lowered
            if actual != lowered {
                changed[changed.count - 1].lowered = actual
                do { try journal.save(changed) }
                catch { notify("media: recovery_unavailable"); end(); return }
            }
        }
        if !changed.isEmpty { notify("media: lowered") }
    }
    /// Startup recovery is explicit so headless/debug never even reads a production marker.
    public func restorePending() {
        guard !active, let _ = volume, let journal else { return }
        if !changed.isEmpty { end(); return }
        do { changed = try journal.load() ?? []; journalBlocked = false }
        catch { journalBlocked = true; notify("media: recovery_unavailable"); return }
        if !changed.isEmpty { end() }
    }
    public func end() {
        active = false
        let owned = changed; changed.removeAll()
        guard let volume, let journal, !owned.isEmpty else { return }
        for item in owned {
            // Respect manual changes, disconnects and reused device IDs. Never change the new default output.
            guard let current = volume.read(item.target) else { changed.append(item); continue }
            guard abs(current - item.lowered) < 0.0001 else { continue }
            if !volume.write(item.original, to: item.target) {
                changed.append(item); notify("media: restore_unavailable")
            }
        }
        do {
            if changed.isEmpty { try journal.clear() } else { try journal.save(changed) }
        } catch { journalBlocked = true; notify("media: recovery_unavailable") }
        notify("media: released")
    }
    /// Capture failure has the same restoration guarantee as finish/cancel. Preparation never blocks capture.
    public func startCapture(meetingActive: Bool = false, _ start: () throws -> Void) rethrows {
        begin(meetingActive: meetingActive)
        do { try start() } catch { end(); throw error }
    }
}
