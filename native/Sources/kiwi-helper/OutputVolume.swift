import CoreAudio
import Foundation
import KiwiHelperCore

/// Only public Core Audio scalar-volume properties. No audio playback, AppleScript, Automation or permissions.
/// Constructing this adapter does nothing; headless/debug never constructs or invokes it.
final class OutputVolume: MediaVolumeControl {
    func targets() -> [MediaVolumeTarget] {
        guard let device = AudioDevices.defaultOutput, let info = AudioDevices.info(device) else { return [] }
        func target(_ channel: UInt32) -> MediaVolumeTarget? {
            let target = MediaVolumeTarget(device: device, uid: info.uid, channel: channel)
            var property = address(target), writable = DarwinBoolean(false)
            guard AudioObjectHasProperty(device, &property),
                  AudioObjectIsPropertySettable(device, &property, &writable) == noErr, writable.boolValue,
                  read(target) != nil else { return nil }
            return target
        }
        if let master = target(kAudioObjectPropertyElementMain) { return [master] }
        // Devices without a master may expose individual output channels (including surround devices).
        return (1...32).compactMap { target(UInt32($0)) }
    }
    func read(_ target: MediaVolumeTarget) -> Float? {
        guard AudioDevices.info(target.device)?.uid == target.uid else { return nil }
        var property = address(target), value: Float32 = 0, size = UInt32(MemoryLayout<Float32>.size)
        guard AudioObjectGetPropertyData(target.device, &property, 0, nil, &size, &value) == noErr else { return nil }
        return value
    }
    func write(_ value: Float, to target: MediaVolumeTarget) -> Bool {
        guard value.isFinite, value >= 0, value <= 1, AudioDevices.info(target.device)?.uid == target.uid else { return false }
        var property = address(target), scalar = Float32(value)
        return AudioObjectSetPropertyData(target.device, &property, 0, nil, UInt32(MemoryLayout<Float32>.size), &scalar) == noErr
    }
    private func address(_ target: MediaVolumeTarget) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyVolumeScalar, mScope: kAudioObjectPropertyScopeOutput, mElement: target.channel)
    }
}
