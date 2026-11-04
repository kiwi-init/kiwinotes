import Foundation

/// Which microphone the dictation records from (T3229, spec #3202).
///
/// With AirPods (or any Bluetooth headset) as the output, recording from the headset's own mic makes macOS duck the
/// media and switch the headset to its call mode: the music gets quieter while you dictate (#3202). So by default
/// (`auto`) the dictation records from another mic (the Mac's, or a USB one) whenever the output is Bluetooth, and the
/// headset keeps playing as before.
public enum MicChoice: Equatable, Sendable {
    /// Another mic when the output is a Bluetooth headset; otherwise the system's default input.
    case auto
    /// The Mac's built-in mic, if it has one.
    case mac
    /// The system's default input, whatever it is (how it worked before T3229).
    case system
    /// One device, by its Core Audio UID (stable across reboots and reconnections).
    case device(uid: String)

    /// The `microphone` of `config.set` (agreed with the app in #3248): `"auto"`, `"builtin"`, `"system"` or
    /// `"uid:<Core Audio UID>"`. Anything else is nil (the command answers `invalid_value`).
    public init?(_ value: String) {
        switch value {
        case "auto": self = .auto
        case "builtin": self = .mac
        case "system": self = .system
        default:
            guard value.hasPrefix("uid:"), value.count > 4 else { return nil }
            self = .device(uid: String(value.dropFirst(4)))
        }
    }

    public var value: String {
        switch self {
        case .auto: return "auto"
        case .mac: return "builtin"
        case .system: return "system"
        case .device(let uid): return "uid:\(uid)"
        }
    }
}

/// An audio device as Core Audio describes it: only what choosing a mic needs.
public struct AudioDeviceInfo: Equatable, Sendable {
    public enum Transport: String, Sendable {
        case builtIn = "builtin"
        case bluetooth
        case usb
        /// Virtual devices (Zoom, Teams, loopback drivers) and aggregates: never picked on our own.
        case virtual
        /// AirPlay, Thunderbolt, HDMI and the rest: never picked on our own either.
        case other
    }

    public var id: UInt32
    public var uid: String
    public var name: String
    public var transport: Transport
    public var hasInput: Bool
    public var hasOutput: Bool

    public init(id: UInt32, uid: String, name: String, transport: Transport, hasInput: Bool, hasOutput: Bool) {
        self.id = id
        self.uid = uid
        self.name = name
        self.transport = transport
        self.hasInput = hasInput
        self.hasOutput = hasOutput
    }
}

/// The mic to record from, and why (for the log and for the app).
public struct MicPick: Equatable, Sendable {
    /// The device to set on the input unit; nil keeps the system's default input.
    public var device: AudioDeviceInfo?
    /// The chosen device isn't connected, so `auto` decided instead.
    public var fellBack: Bool
    public var reason: String

    public init(device: AudioDeviceInfo?, fellBack: Bool = false, reason: String) {
        self.device = device
        self.fellBack = fellBack
        self.reason = reason
    }
}

public enum MicPicker {
    /// Picks the mic for `choice`, given the devices connected now and the system's defaults.
    public static func pick(
        _ choice: MicChoice, devices: [AudioDeviceInfo], defaultInput: UInt32?, defaultOutput: UInt32?
    ) -> MicPick {
        let inputs = devices.filter(\.hasInput)
        let builtIn = inputs.first { $0.transport == .builtIn }
        switch choice {
        case .system:
            return MicPick(device: nil, reason: "system default")
        case .mac:
            guard let builtIn else { return MicPick(device: nil, reason: "no built-in mic: system default") }
            return MicPick(device: builtIn, reason: "built-in mic")
        case .device(let uid):
            if let d = inputs.first(where: { $0.uid == uid }) { return MicPick(device: d, reason: "chosen device") }
            var pick = pick(.auto, devices: devices, defaultInput: defaultInput, defaultOutput: defaultOutput)
            pick.fellBack = true
            pick.reason = "chosen device not connected; auto: \(pick.reason)"
            return pick
        case .auto:
            let output = devices.first { $0.id == defaultOutput }
            let input = devices.first { $0.id == defaultInput }
            guard output?.transport == .bluetooth else { return MicPick(device: nil, reason: "output isn't Bluetooth: system default") }
            // The person picked a wired or built-in mic as the default input: that one is already fine.
            guard input == nil || input?.transport == .bluetooth else {
                return MicPick(device: nil, reason: "default input isn't Bluetooth: system default")
            }
            if let builtIn { return MicPick(device: builtIn, reason: "Bluetooth output: built-in mic") }
            if let usb = inputs.first(where: { $0.transport == .usb }) { return MicPick(device: usb, reason: "Bluetooth output: USB mic") }
            return MicPick(device: nil, reason: "Bluetooth output, no other mic: system default")
        }
    }
}
