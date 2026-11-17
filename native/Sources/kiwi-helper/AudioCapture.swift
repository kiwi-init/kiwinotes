import AVFoundation
import CoreAudio
import Foundation
import KiwiHelperCore

/// The real `MicEngine`: an `AVAudioEngine` on the default input, or on `device` (T3229: the Mac's mic when the
/// output is a Bluetooth headset). `AudioCapture` makes a new one when the input changes, because an engine that
/// already read a device keeps that device's format (T590).
final class AVMicEngine: MicEngine {
    var onConfigurationChange: (() -> Void)?
    /// `prepare` sets `device` on the input unit, and the engine then posts a configuration change about it (#7007).
    var switchesDevice: Bool { device != nil }
    /// The device's format when the tap went in, read the same way as `hardwareFormat()` so the two compare (#5154).
    private(set) var preparedFormat: InputFormat?

    private let engine = AVAudioEngine()
    private let device: AudioDeviceID?
    private var tapInstalled = false
    private var observer: NSObjectProtocol?

    init(device: AudioDeviceID? = nil) {
        self.device = device
        observer = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main
        ) { [weak self] _ in self?.onConfigurationChange?() }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    func prepare(onBuffer: @escaping (AVAudioPCMBuffer) -> Void) throws {
        if !tapInstalled {
            let input = engine.inputNode
            // The device goes on the input unit before its format is read: the tap takes that device's format.
            if var device, let unit = input.audioUnit {
                let status = AudioUnitSetProperty(
                    unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &device, UInt32(MemoryLayout<AudioDeviceID>.size)
                )
                guard status == noErr else { throw AudioCaptureError.noInputDevice }
            }
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else { throw AudioCaptureError.noInputDevice }
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in onBuffer(buffer) }
            tapInstalled = true
            preparedFormat = hardwareFormat()
        }
        engine.prepare()
    }

    func start() throws {
        try engine.start()
    }

    /// The input device's nominal rate and input channels, from Core Audio's properties: nothing is opened, so no mic
    /// indicator and no prompt. The device is the one set on the input unit, or the system's default input.
    func hardwareFormat() -> InputFormat? {
        guard let id = device ?? AudioDevices.defaultInput else { return nil }
        var rateAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyNominalSampleRate, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain
        )
        var rate = Float64(0)
        var size = UInt32(MemoryLayout<Float64>.size)
        guard AudioObjectGetPropertyData(id, &rateAddress, 0, nil, &size, &rate) == noErr, rate > 0 else { return nil }
        var configAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreamConfiguration, mScope: kAudioObjectPropertyScopeInput, mElement: kAudioObjectPropertyElementMain
        )
        guard AudioObjectGetPropertyDataSize(id, &configAddress, 0, nil, &size) == noErr, size > 0 else { return nil }
        let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { raw.deallocate() }
        guard AudioObjectGetPropertyData(id, &configAddress, 0, nil, &size, raw) == noErr else { return nil }
        let list = UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self))
        return InputFormat(sampleRate: rate, channels: list.reduce(0) { $0 + Int($1.mNumberChannels) })
    }

    func stop() {
        engine.stop()
        engine.prepare()
    }

    func discard() {
        if let observer { NotificationCenter.default.removeObserver(observer) }
        observer = nil
        engine.stop()
        if tapInstalled { engine.inputNode.removeTap(onBus: 0) }
        tapInstalled = false
    }
}
