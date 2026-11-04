import CoreAudio
import Foundation
import KiwiHelperCore

/// The audio devices as Core Audio sees them (T3229, spec #3202). Only reads properties: no device is opened, so no
/// mic indicator and no permission prompt.
enum AudioDevices {
    static func all() -> [AudioDeviceInfo] {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        let system = AudioObjectID(kAudioObjectSystemObject)
        guard AudioObjectGetPropertyDataSize(system, &address, 0, nil, &size) == noErr, size > 0 else { return [] }
        var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(system, &address, 0, nil, &size, &ids) == noErr else { return [] }
        return ids.compactMap(info)
    }

    static var defaultInput: AudioDeviceID? { systemDevice(kAudioHardwarePropertyDefaultInputDevice) }
    static var defaultOutput: AudioDeviceID? { systemDevice(kAudioHardwarePropertyDefaultOutputDevice) }

    static func info(_ id: AudioDeviceID) -> AudioDeviceInfo? {
        guard let uid = string(id, kAudioDevicePropertyDeviceUID) else { return nil }
        return AudioDeviceInfo(
            id: id,
            uid: uid,
            name: string(id, kAudioObjectPropertyName) ?? uid,
            transport: transport(id),
            hasInput: streams(id, kAudioObjectPropertyScopeInput) > 0,
            hasOutput: streams(id, kAudioObjectPropertyScopeOutput) > 0
        )
    }

    private static func systemDevice(_ selector: AudioObjectPropertySelector) -> AudioDeviceID? {
        var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var id = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &id)
        return status == noErr && id != kAudioObjectUnknown ? id : nil
    }

    private static func string(_ id: AudioDeviceID, _ selector: AudioObjectPropertySelector) -> String? {
        var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, &value) == noErr, let cf = value?.takeRetainedValue() else { return nil }
        return cf as String
    }

    private static func streams(_ id: AudioDeviceID, _ scope: AudioObjectPropertyScope) -> Int {
        var address = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreams, mScope: scope, mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(id, &address, 0, nil, &size) == noErr else { return 0 }
        return Int(size) / MemoryLayout<AudioStreamID>.size
    }

    private static func transport(_ id: AudioDeviceID) -> AudioDeviceInfo.Transport {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyTransportType, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain
        )
        var value: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, &value) == noErr else { return .other }
        switch value {
        case kAudioDeviceTransportTypeBuiltIn: return .builtIn
        case kAudioDeviceTransportTypeBluetooth, kAudioDeviceTransportTypeBluetoothLE: return .bluetooth
        case kAudioDeviceTransportTypeUSB: return .usb
        case kAudioDeviceTransportTypeVirtual, kAudioDeviceTransportTypeAggregate, kAudioDeviceTransportTypeAutoAggregate: return .virtual
        default: return .other
        }
    }
}

/// Watches what decides the mic: a device connected or gone, and the default input or output changed (AirPods
/// connecting change the output too). Replaces `DefaultInputWatcher`, which only saw the default input.
final class AudioDevicesWatcher {
    private var blocks: [(AudioObjectPropertyAddress, AudioObjectPropertyListenerBlock)] = []

    /// `onChange` runs on the main thread, with what changed (for the log).
    func start(onChange: @escaping (String) -> Void) {
        guard blocks.isEmpty else { return }
        let watched: [(AudioObjectPropertySelector, String)] = [
            (kAudioHardwarePropertyDefaultInputDevice, "default input device"),
            (kAudioHardwarePropertyDefaultOutputDevice, "default output device"),
            (kAudioHardwarePropertyDevices, "devices"),
        ]
        for (selector, what) in watched {
            var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
            let block: AudioObjectPropertyListenerBlock = { _, _ in onChange(what) }
            if AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, .main, block) == noErr {
                blocks.append((address, block))
            }
        }
    }

    deinit {
        for (address, block) in blocks {
            var address = address
            AudioObjectRemovePropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, .main, block)
        }
    }
}

/// The `microphone` the app chose and the mic it came to (T3229). Each new engine asks it, so a change in the choice,
/// in the devices or in the defaults reaches the next engine. Main thread.
final class MicSelection {
    var choice: MicChoice = .auto
    /// What the last engine got: the `record.started` says it, and the log too.
    private(set) var last: MicPick?

    func pick() -> MicPick {
        let p = MicPicker.pick(choice, devices: AudioDevices.all(), defaultInput: AudioDevices.defaultInput, defaultOutput: AudioDevices.defaultOutput)
        last = p
        return p
    }

    /// `audio.inputs` (agreed in #3248): the mics, which one is the default, and the output now. Only reads.
    static func inputs() -> [String: Any] {
        let devices = AudioDevices.all()
        let defaultInput = AudioDevices.defaultInput
        let inputs: [[String: Any]] = devices.filter(\.hasInput).map {
            ["uid": $0.uid, "name": $0.name, "transport": $0.transport.rawValue, "isDefault": $0.id == defaultInput]
        }
        let output = devices.first { $0.id == AudioDevices.defaultOutput }
        return [
            "inputs": inputs,
            "output": output.map { ["name": $0.name, "transport": $0.transport.rawValue] as [String: Any] } ?? NSNull(),
        ]
    }
}

extension MicPick {
    /// For `record.started` and the log: no audio, only which device.
    var fields: [String: Any] {
        var out: [String: Any] = ["fellBack": fellBack, "reason": reason]
        if let device {
            out["uid"] = device.uid
            out["name"] = device.name
            out["transport"] = device.transport.rawValue
        } else {
            out["systemDefault"] = true
        }
        return out
    }
}
