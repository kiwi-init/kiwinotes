// Portado de OpenWhispr/resources/macos-audio-tap.swift @ ed28e3cc22a4f831abd5cf7c31f4ea275fb76d3c (MIT).
// Mudanças: fonte no sidecar, Float32 16 kHz pelo Resampler, sem stdout/CLI; cleanup na falha e no stop.
// Copyright (c) 2024 OpenWhispr Team. Licença em docs/licenses/OpenWhispr-MIT.txt.
import AVFoundation
import CoreAudio
import Foundation
import KiwiHelperCore

/// Only constructed for an explicit meeting.start. Starting the aggregate may show Apple's system-audio consent.
/// Never warmed up, polled, or started in headless mode. The source has no mic, network, playback or file output.
@available(macOS 14.2, *)
final class SystemAudioTap: MeetingAudioSource {
    var onError: ((String) -> Void)?
    private let ioQueue = DispatchQueue(label: "kiwi.meeting.system.audio")
    private let listenerQueue = DispatchQueue(label: "kiwi.meeting.system.listeners")
    private var tapID: AudioObjectID = 0
    private var aggregateDeviceID: AudioObjectID = 0
    private var ioProcID: AudioDeviceIOProcID?
    private var sourceFormat: AVAudioFormat?
    private let resampler = Resampler()
    private var callback: (([Float], TimeInterval) -> Void)?
    private let stateLock = NSLock()
    private var stopped = true
    private var stopping: Bool {
        get { stateLock.lock(); defer { stateLock.unlock() }; return stopped }
        set { stateLock.lock(); stopped = newValue; stateLock.unlock() }
    }
    private typealias Listener = (object: AudioObjectID, address: AudioObjectPropertyAddress, block: AudioObjectPropertyListenerBlock)
    private var listeners: [Listener] = []
    private var invalidationWorkItem: DispatchWorkItem?
    private var invalidationReported = false

    /// The HAL's process object of a pid (`kAudioHardwarePropertyTranslatePIDToProcessObject`), or 0 when it has none.
    static func processObject(_ pid: Int32) -> UInt32 {
        var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject,
                                                 mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var qualifier = pid
        var object = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address,
                                                UInt32(MemoryLayout<pid_t>.size), &qualifier, &size, &object)
        return status == noErr ? object : 0
    }

    func start(onSamples: @escaping ([Float], TimeInterval) -> Void) throws {
        guard stopping else { throw MeetingFailure.alreadyRecording }
        stopping = false
        invalidationReported = false
        callback = onSamples
        do { try startTap() } catch { stop(); throw error }
    }

    private func startTap() throws {
        let tapDescription = CATapDescription()
        tapDescription.name = "kiwinotes-meeting-audio"
        tapDescription.uuid = UUID()
        // `isExclusive`: every process but these. T5833: the helper and the app stay out, so Kiwi's own start and end
        // sounds never reach the "sistema" channel or its transcript.
        tapDescription.processes = MeetingTapExclusion.processObjects(pids: [getpid(), getppid()], translate: Self.processObject)
        tapDescription.isMono = true
        tapDescription.isExclusive = true
        tapDescription.isMixdown = true
        tapDescription.isPrivate = true
        tapDescription.muteBehavior = .unmuted

        var newTapID = AudioObjectID()
        var status = AudioHardwareCreateProcessTap(tapDescription, &newTapID)
        guard status == noErr else {
            throw makeError("Failed to create process tap", status: status, operation: "create_process_tap")
        }
        tapID = newTapID

        let tapUID = tapDescription.uuid.uuidString
        try createAggregateDevice(tapUID: tapUID)
        try waitForAggregateDeviceReady()
        try configureFormat()
        try registerIOProc()

        status = AudioDeviceStart(aggregateDeviceID, ioProcID)
        guard status == noErr else {
            throw makeError("Failed to start aggregate device", status: status, operation: "start_device")
        }

        installInvalidationListeners()

        emit(event: [
            "type": "start",
            "sampleRate": 16_000,
            "channels": 1,
            "bitsPerChannel": 32,
        ])
    }

    func stop() {
        if stopping {
            return
        }
        stopping = true
        removeInvalidationListeners()

        if aggregateDeviceID != 0 {
            AudioDeviceStop(aggregateDeviceID, ioProcID)
        }
        if let ioProcID {
            AudioDeviceDestroyIOProcID(aggregateDeviceID, ioProcID)
            self.ioProcID = nil
        }
        if aggregateDeviceID != 0 {
            AudioHardwareDestroyAggregateDevice(aggregateDeviceID)
            aggregateDeviceID = 0
        }
        if tapID != 0 {
            AudioHardwareDestroyProcessTap(tapID)
            tapID = 0
        }

        ioQueue.sync {} // drain the final callback before disposing the converter
        sourceFormat = nil
        resampler.reset()
        emit(event: ["type": "stop"])
    }

    private func createAggregateDevice(tapUID: String) throws {
        let description: [String: Any] = [
            kAudioAggregateDeviceNameKey: "Kiwi Notes Meeting Audio",
            kAudioAggregateDeviceUIDKey: "app.kiwinotes.meeting.\(UUID().uuidString)",
            kAudioAggregateDeviceSubDeviceListKey: [],
            kAudioAggregateDeviceTapListKey: [[kAudioSubTapUIDKey: tapUID]],
            kAudioAggregateDeviceTapAutoStartKey: false,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
        ]

        var deviceID = AudioObjectID()
        let status = AudioHardwareCreateAggregateDevice(description as CFDictionary, &deviceID)
        guard status == noErr else {
            throw makeError("Failed to create aggregate device", status: status, operation: "create_aggregate_device")
        }
        aggregateDeviceID = deviceID
    }

    private func isAggregateDeviceAlive() -> Bool {
        guard aggregateDeviceID != 0 else {
            return false
        }

        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceIsAlive,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var isAlive: UInt32 = 0
        var dataSize = UInt32(MemoryLayout<UInt32>.size)
        let status = AudioObjectGetPropertyData(
            aggregateDeviceID,
            &address,
            0,
            nil,
            &dataSize,
            &isAlive
        )
        return status == noErr && isAlive != 0
    }

    private func waitForAggregateDeviceReady() throws {
        for _ in 0..<20 {
            if isAggregateDeviceAlive() {
                return
            }
            Thread.sleep(forTimeInterval: 0.1)
        }

        throw makeError("Aggregate device did not become ready", operation: "wait_for_device")
    }

    // The tap is built once and never follows the system afterwards, so a route
    // change or a disappearing device can stop delivery with the process still
    // healthy. These listeners turn that into a warning the host can act on.
    private func installInvalidationListeners() {
        addInvalidationListener(
            object: AudioObjectID(kAudioObjectSystemObject),
            selector: kAudioHardwarePropertyDefaultOutputDevice,
            reason: "default_output_changed"
        )
        // kAudioHardwarePropertyDevices is deliberately not observed. Our
        // aggregate has an empty sub-device list, so it stays alive when a
        // physical device disappears and the report would always be suppressed;
        // meanwhile the notification fires on unrelated device churn from any
        // app, and sharing the coalescing window would cancel a pending
        // default_output_changed report that does matter.
        addInvalidationListener(
            object: aggregateDeviceID,
            selector: kAudioDevicePropertyDeviceIsAlive,
            reason: "device_not_alive"
        )
    }

    private func addInvalidationListener(
        object: AudioObjectID,
        selector: AudioObjectPropertySelector,
        reason: String
    ) {
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        let block: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
            self?.scheduleInvalidationReport(reason: reason)
        }

        let status = AudioObjectAddPropertyListenerBlock(object, &address, listenerQueue, block)
        guard status == noErr else {
            // Capture still works, it just loses this detection path, so report
            // and carry on rather than failing the whole session.
            emit(event: [
                "type": "warning",
                "code": "listener_unavailable",
                "reason": reason,
                "message": "Failed to observe \(reason): \(Int(status))",
            ])
            return
        }

        listeners.append((object: object, address: address, block: block))
    }

    private func removeInvalidationListeners() {
        listenerQueue.sync {
            invalidationWorkItem?.cancel()
            invalidationWorkItem = nil
        }

        for listener in listeners {
            var address = listener.address
            AudioObjectRemovePropertyListenerBlock(
                listener.object,
                &address,
                listenerQueue,
                listener.block
            )
        }
        listeners.removeAll()
    }

    // A route change fires several notifications in a burst, so coalesce them
    // into one report. Runs on listenerQueue, never on the IO thread.
    private func scheduleInvalidationReport(reason: String) {
        invalidationWorkItem?.cancel()
        let workItem = DispatchWorkItem { [weak self] in
            self?.reportInvalidation(reason: reason)
        }
        invalidationWorkItem = workItem
        listenerQueue.asyncAfter(deadline: .now() + 0.3, execute: workItem)
    }

    private func reportInvalidation(reason: String) {
        guard !invalidationReported, !stopping else {
            return
        }

        invalidationReported = true
        emit(event: [
            "type": "warning",
            "code": "device_invalidated",
            "reason": reason,
            "message": "System audio device changed (\(reason)); capture may have stopped.",
        ])
    }

    private func configureFormat() throws {
        var asbd = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        var address = AudioObjectPropertyAddress(mSelector: kAudioTapPropertyFormat, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        let status = AudioObjectGetPropertyData(tapID, &address, 0, nil, &size, &asbd)
        guard status == noErr, let format = AVAudioFormat(streamDescription: &asbd) else {
            throw makeError("Invalid tap format", status: status, operation: "tap_format")
        }
        sourceFormat = format
    }

    private func registerIOProc() throws {
        guard let sourceFormat else { throw MeetingFailure.invalidValue }
        var procID: AudioDeviceIOProcID?
        let status = AudioDeviceCreateIOProcIDWithBlock(&procID, aggregateDeviceID, ioQueue) { [weak self] time, inputData, inputTime, _, _ in
            guard let self, !self.stopping,
                  let buffer = AVAudioPCMBuffer(pcmFormat: sourceFormat, bufferListNoCopy: UnsafeMutablePointer(mutating: inputData), deallocator: nil),
                  let samples = self.resampler.convert(buffer), !samples.isEmpty else { return }
            let host = inputTime.pointee.mHostTime
            let start = host > 0 ? AVAudioTime.seconds(forHostTime: host) : ProcessInfo.processInfo.systemUptime - Double(samples.count) / 16_000
            self.callback?(samples, start)
        }
        guard status == noErr, let procID else { throw makeError("Failed to create IO proc", status: status, operation: "create_ioproc") }
        ioProcID = procID
    }

    private func makeError(_ message: String, status: OSStatus = -1, operation: String) -> Error {
        NSError(domain: "kiwi.meeting.system.\(operation)", code: Int(status), userInfo: [NSLocalizedDescriptionKey: message])
    }

    private func emit(event: [String: Any]) {
        if event["type"] as? String == "warning", event["code"] as? String == "device_invalidated" {
            onError?("system_device_changed")
        }
    }
}
