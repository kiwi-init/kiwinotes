import AVFoundation
import CoreAudio
import Foundation
import KiwiHelperCore

/// The real `MicEngine`: an `AVAudioEngine` on the default input, or on `device` (T3229: the Mac's mic when the
/// output is a Bluetooth headset). `AudioCapture` makes a new one when the input changes, because an engine that
/// already read a device keeps that device's format (T590).
final class AVMicEngine: MicEngine {
    var onConfigurationChange: (() -> Void)?

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
        }
        engine.prepare()
    }

    func start() throws {
        try engine.start()
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
