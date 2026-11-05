import AppKit
import CoreAudio
import Foundation
import KiwiHelperCore

/// The live side of the mic diagnosis (#5154): who else takes input now, and whether Core Audio says the device runs
/// somewhere. Only reads properties (no mic opened, no prompt). The pure parts are `MicBusy` and `CaptureDiagnostic`.
enum MicDiagnostics {
    /// The other apps taking mic input now, by name (the meeting apps' names first, then the app's own), without the
    /// helper itself. Empty when nobody else is on it, or on a macOS without process objects.
    static func otherApps() -> [String] {
        guard let users = MicListener.readOnce() else { return [] }
        let own = getpid()
        var names: [String] = []
        for user in users.sorted(by: { $0.pid < $1.pid }) where user.pid != own {
            let name = MeetingApps().match(user.bundleId)?.name
                ?? NSRunningApplication(processIdentifier: user.pid)?.localizedName
                ?? user.bundleId
            if !names.contains(name) { names.append(name) }
        }
        return names
    }

    /// `kAudioDevicePropertyDeviceIsRunningSomewhere` of the device (or of the system's default input).
    static func runningSomewhere(_ device: AudioDeviceID?) -> Bool? {
        guard let id = device ?? AudioDevices.defaultInput else { return nil }
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain
        )
        var running = UInt32(0)
        var size = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, &running) == noErr else { return nil }
        return running != 0
    }

    /// The log line for one diagnostic, with the device the selection picked. The "who else" reads only happen at
    /// the start and the end of a recording.
    static func line(_ diagnostic: CaptureDiagnostic, pick: MicPick?) -> String {
        let deviceID = pick?.device.map { AudioDeviceID($0.id) }
        let name = pick?.device?.name ?? "system default"
        switch diagnostic {
        case .starting, .ended:
            return diagnostic.logLine(device: name, inUseBy: otherApps(), runningSomewhere: runningSomewhere(deviceID))
        case .formatChanged, .startFailed:
            return diagnostic.logLine(device: name, inUseBy: [], runningSomewhere: nil)
        }
    }
}
