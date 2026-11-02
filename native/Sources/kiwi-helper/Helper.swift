import Foundation
import KiwiHelperCore

/// Glue between the hotkey, the mic and the IPC connection. Everything here runs on the main thread.
final class Helper {
    static let version = "0.1.0"

    private let connection: SocketConnection
    private let dumpDirectory: URL?
    private let audio = AudioCapture()
    private var gesture = HotkeyGesture()
    private var tap: HotkeyTap!
    private var tickTimer: DispatchWorkItem?
    private var recordingStartedAt: TimeInterval?
    private var lastPermissions: [String: String] = [:]

    init(connection: SocketConnection, dumpDirectory: URL?) {
        self.connection = connection
        self.dumpDirectory = dumpDirectory
        tap = HotkeyTap(key: .fn) { [weak self] event in self?.onHotkey(event) }
        audio.onLevel = { [weak self] level in
            // Audio thread: send straight away, the write queue serializes it.
            self?.emit("audio.level", ["level": (Double(level) * 1000).rounded() / 1000])
        }
    }

    func run() {
        connection.onMessage = { [weak self] message in
            DispatchQueue.main.async { self?.handle(message) }
        }
        connection.onBadLine = { [weak self] error in
            let why = (error as? IPCError).map { "\($0)" } ?? "not_json"
            self?.emit("log", ["level": "warn", "message": "bad line from app: \(why)"])
        }
        connection.onClose = { [weak self] in
            // No orphan sidecar: when the app goes away, so do we.
            DispatchQueue.main.async {
                _ = self?.audio.stop()
                exit(0)
            }
        }
        tap.start()
        lastPermissions = Permission.snapshot()
        emit("ready", [
            "version": Self.version,
            "pid": Int(getpid()),
            "hotkey": tap.key.rawValue,
            "hotkeyActive": hotkeyActive,
            "permissions": lastPermissions,
            "permissionHelp": Permission.explanations(),
        ])
        // Read only after `ready` is queued, so it is always the first line the app sees.
        connection.start()
        schedulePermissionPoll()
    }

    // MARK: Hotkey

    private func onHotkey(_ event: HotkeyTap.Event) {
        let actions: [GestureAction]
        switch event {
        case .down(let t):
            emit("hotkey.down", ["key": tap.key.rawValue])
            actions = gesture.keyDown(at: t)
        case .up(let t):
            emit("hotkey.up", ["key": tap.key.rawValue])
            actions = gesture.keyUp(at: t)
        case .otherKey:
            actions = gesture.otherKeyDown()
        }
        actions.forEach(apply)
        scheduleTick()
    }

    private func apply(_ action: GestureAction) {
        switch action {
        case .startRecording:
            startRecording(reason: "hotkey")
        case .latch:
            emit("hotkey.toggle", ["key": tap.key.rawValue, "latched": true])
        case .stopRecording(let mode):
            stopRecording(reason: "hotkey", mode: mode.rawValue)
        case .cancelRecording:
            cancelRecording(reason: "hotkey")
        }
    }

    private func scheduleTick() {
        tickTimer?.cancel()
        guard let deadline = gesture.deadline else { return }
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.gesture.tick(now: ProcessInfo.processInfo.systemUptime).forEach(self.apply)
        }
        tickTimer = work
        let delay = max(0, deadline - ProcessInfo.processInfo.systemUptime) + 0.01
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    // MARK: Recording

    @discardableResult
    private func startRecording(reason: String) -> String? {
        guard !audio.isRecording else { return nil }
        do {
            try audio.start()
        } catch {
            gesture.reset()
            emit("record.error", ["reason": reason, "error": "\(error)", "microphone": Permission.microphone.status])
            return "\(error)"
        }
        recordingStartedAt = ProcessInfo.processInfo.systemUptime
        emit("record.started", ["reason": reason])
        return nil
    }

    private func stopRecording(reason: String, mode: String) {
        guard audio.isRecording else { return }
        let samples = audio.stop()
        var fields: [String: Any] = [
            "reason": reason,
            "mode": mode,
            "durationMs": Int(Double(samples.count) / AudioCapture.sampleRate * 1000),
            "samples": samples.count,
        ]
        if let path = dump(samples) { fields["audioPath"] = path }
        recordingStartedAt = nil
        emit("record.stopped", fields)
        // T51 hooks the STT in here and emits transcript.final.
    }

    private func cancelRecording(reason: String) {
        guard audio.isRecording else { return }
        _ = audio.stop()
        recordingStartedAt = nil
        emit("record.cancelled", ["reason": reason])
    }

    private func dump(_ samples: [Float]) -> String? {
        guard let dumpDirectory, !samples.isEmpty else { return nil }
        let name = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
        let url = dumpDirectory.appendingPathComponent("\(name).wav")
        do {
            try WAV.encode(samples: samples, sampleRate: Int(AudioCapture.sampleRate)).write(to: url)
            return url.path
        } catch {
            emit("log", ["level": "warn", "message": "dump failed: \(error)"])
            return nil
        }
    }

    // MARK: Commands from the app

    private func handle(_ message: InboundMessage) {
        let id = message.id
        switch message.type {
        case "ping":
            reply(id, ok: true)
        case "config.set":
            configure(message)
            reply(id, ok: true, ["hotkey": tap.key.rawValue, "hotkeyActive": hotkeyActive])
        case "record.start":
            if let error = startRecording(reason: "command") {
                reply(id, ok: false, error: error)
            } else {
                gesture.reset(latched: true) // a tap on the hotkey ends it, as in toggle mode
                reply(id, ok: true)
            }
        case "record.stop":
            gesture.reset()
            stopRecording(reason: "command", mode: "command")
            reply(id, ok: true)
        case "permissions.request":
            guard let name = message.string("permission"), let permission = Permission(rawValue: name) else {
                return reply(id, ok: false, error: "unknown_permission")
            }
            permission.request { [weak self] status in
                self?.reply(id, ok: status == "granted", ["permission": name, "status": status])
                self?.pollPermissions()
            }
        case "overlay.state", "insert.text", "notify", "llm.complete":
            reply(id, ok: false, error: "not_implemented")
        default:
            reply(id, ok: false, error: "unknown_type")
        }
    }

    private func configure(_ message: InboundMessage) {
        if let name = message.string("hotkey"), let key = HotkeyKey(rawValue: name), key != tap.key {
            tap.stop()
            tap.key = key
            gesture.reset()
            if audio.isRecording { cancelRecording(reason: "config") }
            tap.start()
        }
        if let ms = message.double("holdThresholdMs") { gesture.holdThreshold = ms / 1000 }
        if let ms = message.double("doubleTapMs") { gesture.doubleTapWindow = ms / 1000 }
    }

    // MARK: Permissions

    private func schedulePermissionPoll() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            self?.pollPermissions()
            self?.schedulePermissionPoll()
        }
    }

    private func pollPermissions() {
        let now = Permission.snapshot()
        guard now != lastPermissions else { return }
        let key = Permission.inputMonitoring.rawValue
        if now[key] == "granted", lastPermissions[key] != "granted" {
            // A tap made before the grant stays filtered; make a new one.
            tap.stop()
            tap.start()
        }
        lastPermissions = now
        emit("permissions.changed", ["permissions": now, "hotkeyActive": hotkeyActive])
    }

    /// The tap exists and macOS actually delivers key events to it (a listen-only tap is created
    /// even without Input Monitoring, but receives nothing).
    private var hotkeyActive: Bool {
        tap.isRunning && Permission.inputMonitoring.status == "granted"
    }

    // MARK: Output

    private func emit(_ type: String, _ fields: [String: Any] = [:]) {
        guard let data = try? IPC.encode(type, fields) else { return }
        connection.send(data)
    }

    private func reply(_ id: String?, ok: Bool, error: String? = nil, _ fields: [String: Any] = [:]) {
        guard let id, let data = try? IPC.result(id: id, ok: ok, error: error, fields) else { return }
        connection.send(data)
    }
}
