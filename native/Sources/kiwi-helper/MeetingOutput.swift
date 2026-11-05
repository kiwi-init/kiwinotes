import CoreAudio

/// Read-only stream terminal, since transport alone cannot distinguish a Bluetooth speaker or the Mac's headphone jack.
enum MeetingOutput {
    static func route() -> String {
        guard let device = AudioDevices.defaultOutput else { return "unknown" }
        var address = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreams, mScope: kAudioObjectPropertyScopeOutput, mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(device, &address, 0, nil, &size) == noErr, size > 0 else { return "unknown" }
        var streams = [AudioStreamID](repeating: 0, count: Int(size) / MemoryLayout<AudioStreamID>.size)
        let status = streams.withUnsafeMutableBytes { AudioObjectGetPropertyData(device, &address, 0, nil, &size, $0.baseAddress!) }
        guard status == noErr else { return "unknown" }
        var terminals: [UInt32] = []
        for stream in streams {
            var property = AudioObjectPropertyAddress(mSelector: kAudioStreamPropertyTerminalType, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
            var terminal: UInt32 = 0
            var length = UInt32(MemoryLayout<UInt32>.size)
            if AudioObjectGetPropertyData(stream, &property, 0, nil, &length, &terminal) == noErr { terminals.append(terminal) }
        }
        if terminals.contains(kAudioStreamTerminalTypeHeadphones) { return "headphones" }
        if terminals.contains(kAudioStreamTerminalTypeSpeaker) || terminals.contains(kAudioStreamTerminalTypeReceiverSpeaker) { return "speaker" }
        return "unknown"
    }
}
