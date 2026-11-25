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
    /// The device's own dB scale (Core Audio `VolumeScalarToDecibels`/`DecibelsToScalar`). nil: the device has none.
    func decibels(fromScalar value: Float, on target: MediaVolumeTarget) -> Float?
    func scalar(fromDecibels value: Float, on target: MediaVolumeTarget) -> Float?
}
public extension MediaVolumeControl {
    func decibels(fromScalar value: Float, on target: MediaVolumeTarget) -> Float? { nil }
    func scalar(fromDecibels value: Float, on target: MediaVolumeTarget) -> Float? { nil }
}

/// How far down. The dictation: a quarter of the scalar (#17697). The cat's voice (T26830): a fixed number of dB on the
/// device's own scale, because the scalar maps to sound through a curve of each device, and the player can only give
/// the voice back what it knows was taken. A device without the dB scale is left alone in that mode.
public enum MediaLowering: Equatable, Sendable {
    case scalar(Float)
    case decibels(Float)
}

/// Original Kiwi implementation of the approved lower-volume option. No player commands, devices or timers here.
/// Main-thread ownership lasts only through microphone capture, not transcription/insertion or meetings.
/// The rule (spec #17697, which replaces the "dictation only" of #4756): the volume goes down while the mic records a
/// dictation **or a talk to the Kiwi-cat**, and comes back when that recording ends, is cancelled or loses the mic.
/// Never during a meeting. Proof without the real mic or the Mac's sound: `bun scripts/agent-media-check.ts` (T18410).
public final class DictationMedia {
    private let volume: MediaVolumeControl?
    private let notify: (String) -> Void
    private var active = false
    private let journal: MediaVolumeJournal?
    private var changed: [MediaVolumeChange] = []
    private var journalBlocked = false
    private let lowering: MediaLowering
    /// The amplitude the lowered output keeps (1 = untouched), from the device's dB scale. Only in `.decibels`.
    private var attenuation: Float = 1
    public init(volume: MediaVolumeControl?, journal: MediaVolumeJournal? = nil, lowering: MediaLowering = .scalar(0.25),
                notify: @escaping (String) -> Void = { _ in }) {
        self.volume = volume; self.journal = journal; self.lowering = lowering; self.notify = notify
    }
    /// The output is down right now, by this helper.
    public var isLowered: Bool { active && !changed.isEmpty }
    /// The volume the person had before (the first output lowered), while it is down.
    public var originalVolume: Float? { isLowered ? changed.first?.original : nil }
    /// The gain that gives back what the lowering took (T26830), between 1 and `limit`. 1 when nothing is down or the
    /// mode is `.scalar`, whose loss in sound nobody knows.
    public func compensation(limit: Float = 2) -> Float {
        guard isLowered, attenuation > 0, attenuation < 1 else { return 1 }
        return min(limit, max(1, 1 / attenuation))
    }
    private func lowered(_ original: Float, on target: MediaVolumeTarget, _ volume: MediaVolumeControl) -> Float? {
        switch lowering {
        case .scalar(let factor):
            return original * factor
        case .decibels(let step):
            guard let now = volume.decibels(fromScalar: original, on: target), now.isFinite,
                  let scalar = volume.scalar(fromDecibels: now + step, on: target), scalar.isFinite else { return nil }
            return max(0, min(original, scalar))
        }
    }
    private func measureAttenuation(_ volume: MediaVolumeControl) {
        attenuation = 1
        guard case .decibels = lowering, let first = changed.first,
              let before = volume.decibels(fromScalar: first.original, on: first.target),
              let after = volume.decibels(fromScalar: first.lowered, on: first.target),
              before.isFinite, after.isFinite, after < before else { return }
        attenuation = pow(10, (after - before) / 20)
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
            guard let lowered = lowered(original, on: target, volume) else { notify("media: no_decibels"); continue }
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
        measureAttenuation(volume)
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
        attenuation = 1
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
