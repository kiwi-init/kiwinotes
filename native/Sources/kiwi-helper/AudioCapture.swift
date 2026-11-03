import AVFoundation
import CoreAudio
import Foundation
import KiwiHelperCore

/// The real `MicEngine`: an `AVAudioEngine` on the default input. `AudioCapture` makes a new one when the input
/// changes, because an engine that already read a device keeps that device's format (T590).
final class AVMicEngine: MicEngine {
    var onConfigurationChange: (() -> Void)?

    private let engine = AVAudioEngine()
    private var tapInstalled = false
    private var observer: NSObjectProtocol?

    init() {
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

/// The system's default input device changed (a Bluetooth headset connected, or another mic picked in Settings).
/// `AVAudioEngine` doesn't always say so, and then the tap gets nothing (#589).
final class DefaultInputWatcher {
    private var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultInputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    private var block: AudioObjectPropertyListenerBlock?

    /// `onChange` runs on the main thread.
    func start(onChange: @escaping () -> Void) {
        guard block == nil else { return }
        let block: AudioObjectPropertyListenerBlock = { _, _ in onChange() }
        let status = AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, .main, block)
        if status == noErr { self.block = block }
    }

    deinit {
        if let block {
            AudioObjectRemovePropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, .main, block)
        }
    }
}
