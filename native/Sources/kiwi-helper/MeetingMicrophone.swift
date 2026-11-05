import CoreAudio
import Foundation
import KiwiHelperCore

/// Reuses MicChoice, the input-change debounce and the dictation watchdog, with no recording-sized array in RAM.
final class MeetingMicrophone: MeetingAudioSource {
    let selection = MicSelection()
    private(set) lazy var audio: AudioCapture = {
        let capture = AudioCapture(makeEngine: { [selection] in AVMicEngine(device: selection.pick().device.map { AudioDeviceID($0.id) }) }, retainSamples: false)
        capture.mayWarmUp = { false } // meetings never prepare an input outside an explicit recording
        return capture
    }()

    func start(onSamples: @escaping ([Float], TimeInterval) -> Void) throws {
        audio.onSamples = onSamples
        try audio.start()
    }

    func stop() { _ = audio.stop() }
}
