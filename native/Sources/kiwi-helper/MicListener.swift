// Portado de OpenWhispr/resources/macos-mic-listener.swift @ ed28e3cc22a4f831abd5cf7c31f4ea275fb76d3c (MIT).
// Mudanças: uma classe em vez de um processo à parte com stdout; os listeners em bloco na fila principal; devolve
// os processos que usam o mic com o bundle id (o snapshot puro está em KiwiHelperCore/Meeting/MicUsage.swift);
// sem o modo "aggregate", que não diz qual app pegou o mic e contaria o próprio Kiwi; sem os sinais nem o
// `--print-default-input`.

import AppKit
import CoreAudio
import Foundation
import KiwiHelperCore

/// Which processes are taking mic input (R2, #195), from CoreAudio's process objects (macOS 14.2+). It only reads
/// properties of the audio system: it never opens the mic, and asks for no permission. Call it on the main thread.
final class MicListener {
    /// The whole set, each time it changes. On the main thread.
    var onChange: ((Set<MicUser>) -> Void)?

    private(set) var users: Set<MicUser> = []
    private var objects: [AudioObjectID: pid_t] = [:]
    private var objectListeners: [AudioObjectID: AudioObjectPropertyListenerBlock] = [:]
    private var listListener: AudioObjectPropertyListenerBlock?
    private var heartbeat: DispatchSourceTimer?
    /// Process monitoring is up (the list listener and one per process).
    private var monitoring = false

    /// Starts listening, and keeps retrying on a heartbeat when CoreAudio can't be read yet. Returns whether this
    /// macOS has process objects at all (14.2+); false: nothing will ever come, and the meeting shortcut still works.
    @discardableResult
    func start() -> Bool {
        guard Self.supported else { return false }
        if !monitoring { monitoring = startMonitoring() }
        guard heartbeat == nil else { return true }
        // Like OpenWhispr: a heartbeat catches a missed change, and retries after a failed start.
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + 5, repeating: 5)
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            if self.monitoring { self.reconcile() } else { self.monitoring = self.startMonitoring() }
        }
        timer.resume()
        heartbeat = timer
        return true
    }

    func stop() {
        heartbeat?.cancel()
        heartbeat = nil
        removeMonitoring()
        if !users.isEmpty {
            users = []
            onChange?([])
        }
    }

    /// One read, for `kiwi-helper --mic-users` (the harry's checks and the lead's script): nil when it can't be read.
    static func readOnce() -> Set<MicUser>? {
        guard supported, let list = processObjects() else { return nil }
        return snapshot(list)?.active
    }

    // MARK: CoreAudio

    private static func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    }

    private static var supported: Bool {
        var list = address(kAudioHardwarePropertyProcessObjectList)
        return AudioObjectHasProperty(AudioObjectID(kAudioObjectSystemObject), &list)
    }

    private static func processObjects() -> [AudioObjectID]? {
        let system = AudioObjectID(kAudioObjectSystemObject)
        var list = address(kAudioHardwarePropertyProcessObjectList)
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(system, &list, 0, nil, &size) == noErr else { return nil }
        guard size > 0 else { return [] }
        var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
        guard AudioObjectGetPropertyData(system, &list, 0, nil, &size, &ids) == noErr else { return nil }
        return ids
    }

    private static func pid(_ object: AudioObjectID) -> Int32? {
        var property = address(kAudioProcessPropertyPID)
        var value: pid_t = 0
        var size = UInt32(MemoryLayout<pid_t>.size)
        return AudioObjectGetPropertyData(object, &property, 0, nil, &size, &value) == noErr && value > 0 ? value : nil
    }

    private static func isRunningInput(_ object: AudioObjectID) -> Bool? {
        var property = address(kAudioProcessPropertyIsRunningInput)
        guard AudioObjectHasProperty(object, &property) else { return nil }
        var value: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        return AudioObjectGetPropertyData(object, &property, 0, nil, &size, &value) == noErr ? value > 0 : nil
    }

    private static func bundleId(_ object: AudioObjectID) -> String? {
        var property = address(kAudioProcessPropertyBundleID)
        var value: CFString?
        var size = UInt32(MemoryLayout<CFString?>.size)
        let status = withUnsafeMutablePointer(to: &value) { AudioObjectGetPropertyData(object, &property, 0, nil, &size, $0) }
        return status == noErr ? value as String? : nil
    }

    private static func snapshot(_ list: [AudioObjectID]) -> (pids: [UInt32: Int32], active: Set<MicUser>)? {
        guard let snapshot = MicUsage.snapshot(list, readPid: pid, readInputRunning: isRunningInput, readBundleId: bundleId)
        else { return nil }
        return (snapshot.pids, Set(snapshot.active.map(responsible)))
    }

    /// The app behind a process: Safari for its WebKit GPU process, Chrome for its helper, Kiwi for the helper. The
    /// mic is often taken by a helper process whose bundle id says little (`com.apple.WebKit.GPU` is every WebKit
    /// app's); macOS knows which app is responsible for it. Falls back to the process itself.
    private static func responsible(_ user: MicUser) -> MicUser {
        guard let lookup = responsibleLookup else { return user }
        let owner = lookup(user.pid)
        guard owner > 0, owner != user.pid,
              let bundleId = NSRunningApplication(processIdentifier: owner)?.bundleIdentifier, !bundleId.isEmpty
        else { return user }
        return MicUser(pid: owner, bundleId: bundleId)
    }

    /// `responsibility_get_pid_responsible_for_pid` (libquarantine, in libSystem): not in the SDK headers, so looked
    /// up at run time; without it, each process counts as itself.
    private static let responsibleLookup: (@convention(c) (pid_t) -> pid_t)? = {
        guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_get_pid_responsible_for_pid") else { return nil }
        return unsafeBitCast(symbol, to: (@convention(c) (pid_t) -> pid_t).self)
    }()

    // MARK: Monitoring

    private func startMonitoring() -> Bool {
        let system = AudioObjectID(kAudioObjectSystemObject)
        var list = Self.address(kAudioHardwarePropertyProcessObjectList)
        let block: AudioObjectPropertyListenerBlock = { [weak self] _, _ in self?.reconcile() }
        guard AudioObjectAddPropertyListenerBlock(system, &list, .main, block) == noErr else { return false }
        listListener = block
        guard let objects = Self.processObjects(), let snapshot = Self.snapshot(objects) else {
            removeMonitoring()
            return false
        }
        for object in snapshot.pids.keys {
            guard addListener(object) else {
                removeMonitoring()
                return false
            }
        }
        self.objects = snapshot.pids
        publish(snapshot.active)
        return true
    }

    private func addListener(_ object: AudioObjectID) -> Bool {
        var running = Self.address(kAudioProcessPropertyIsRunningInput)
        let block: AudioObjectPropertyListenerBlock = { [weak self] _, _ in self?.reconcile() }
        guard AudioObjectAddPropertyListenerBlock(object, &running, .main, block) == noErr else { return false }
        objectListeners[object] = block
        return true
    }

    private func removeListener(_ object: AudioObjectID) {
        guard let block = objectListeners.removeValue(forKey: object) else { return }
        var running = Self.address(kAudioProcessPropertyIsRunningInput)
        AudioObjectRemovePropertyListenerBlock(object, &running, .main, block)
    }

    private func removeMonitoring() {
        for object in Array(objectListeners.keys) { removeListener(object) }
        objects = [:]
        if let block = listListener {
            var list = Self.address(kAudioHardwarePropertyProcessObjectList)
            AudioObjectRemovePropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &list, .main, block)
            listListener = nil
        }
        monitoring = false
    }

    private func reconcile() {
        guard monitoring else { return }
        guard let list = Self.processObjects(), var snapshot = Self.snapshot(list) else {
            // The state can't be trusted: start over on the next heartbeat.
            removeMonitoring()
            return
        }
        let next = Set(snapshot.pids.keys), previous = Set(objects.keys)
        for object in previous.subtracting(next) { removeListener(object) }
        for object in next.subtracting(previous) where !addListener(object) {
            // Lost the same vanish race as the snapshot: drop it, the next reconcile retries if it's alive.
            snapshot.pids.removeValue(forKey: object)
        }
        objects = snapshot.pids
        publish(snapshot.active)
    }

    private func publish(_ active: Set<MicUser>) {
        guard active != users else { return }
        users = active
        onChange?(active)
    }
}
