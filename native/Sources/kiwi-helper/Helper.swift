import Foundation
import KiwiHelperCore

/// Glue between the hotkey, the mic and the IPC connection. Everything here runs on the main thread.
final class Helper {
    static let version = "0.1.0"

    private let connection: SocketConnection
    private let dumpDirectory: URL?
    private let audio = AudioCapture()
    private let overlay = Overlay()
    private var gesture = HotkeyGesture()
    private var tap: HotkeyTap!
    private var tickTimer: DispatchWorkItem?
    private var recordingStartedAt: TimeInterval?
    private var lastPermissions: [String: String] = [:]
    private let llm = LLM()
    private var lastLlm = ""
    private let stt = Transcriber()
    /// The previous transcription: each one waits for it, so transcripts come out in recording order.
    private var sttChain: Task<Void, Never>?

    init(connection: SocketConnection, dumpDirectory: URL?) {
        self.connection = connection
        self.dumpDirectory = dumpDirectory
        tap = HotkeyTap(key: .fn) { [weak self] event in self?.onHotkey(event) }
        audio.onLevel = { [weak self] level in
            // Level queue: send straight away, the write queue serializes it.
            self?.emit("audio.level", ["rms": (Double(level) * 1000).rounded() / 1000])
            self?.overlay.push(level: level)
        }
        overlay.onCancel = { [weak self] in self?.endFromOverlay(finish: false) }
        overlay.onFinish = { [weak self] in self?.endFromOverlay(finish: true) }
        audio.onDeviceLost = { [weak self] code in
            guard let self else { return }
            self.gesture.reset()
            self.recordingStartedAt = nil
            self.emit("record.error", ["reason": "hotkey", "error": code, "microphone": Permission.microphone.status])
            self.overlay.set(.error, message: OverlayText.error(code))
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
        lastLlm = Self.key(llm.status)
        emit("ready", [
            "version": Self.version,
            "pid": Int(getpid()),
            "hotkey": tap.key.rawValue,
            "hotkeyActive": hotkeyActive,
            "permissions": lastPermissions,
            "permissionHelp": Permission.explanations(),
            "llm": llm.status,
        ])
        // Read only after `ready` is queued, so it is always the first line the app sees.
        connection.start()
        if Permission.microphone.status == "granted" { audio.warmUp() }
        schedulePermissionPoll()
        prepareSTT()
    }

    /// Loads the model while nobody is waiting for it (the first run downloads it), so the first dictation
    /// only pays for the transcription.
    private func prepareSTT() {
        let started = ProcessInfo.processInfo.systemUptime
        // The first load can take a minute (download, or CoreML compiling for the Neural Engine after a macOS
        // update): the app shows "preparing" until `ready`.
        emit("stt.status", ["state": "loading"])
        let previous = sttChain
        sttChain = Task { [stt, weak self] in
            await previous?.value
            do {
                try await stt.warmUp()
                let ms = Int((ProcessInfo.processInfo.systemUptime - started) * 1000)
                self?.emit("stt.status", ["state": "ready", "loadMs": ms])
            } catch {
                self?.emit("stt.status", ["state": "unavailable", "error": Transcriber.Failure.modelUnavailable.rawValue])
            }
        }
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
            emit("hotkey.toggle", ["on": true])
        case .stopRecording(let mode):
            if mode == .toggle { emit("hotkey.toggle", ["on": false]) }
            stopRecording(reason: "hotkey", mode: mode.rawValue)
        case .cancelRecording:
            cancelRecording(reason: "hotkey")
        }
    }

    /// The pill's ✕ (cancel) or ✓ (finish, like letting go of the key).
    private func endFromOverlay(finish: Bool) {
        guard audio.isRecording else { return }
        let mode = gesture.endedFromOverlay()
        tickTimer?.cancel()
        if finish {
            if mode == .toggle { emit("hotkey.toggle", ["on": false]) }
            stopRecording(reason: "overlay", mode: mode.rawValue)
        } else {
            cancelRecording(reason: "overlay")
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
        // Tell the app first, so the overlay shows up while the engine comes up. If the mic then fails,
        // record.error follows record.started (ADR 0001).
        emit("record.started", ["reason": reason])
        overlay.set(.listening)
        let t0 = ProcessInfo.processInfo.systemUptime
        do {
            try audio.start()
        } catch {
            gesture.reset()
            // A stable code for the app; AVAudioEngine's own errors are long sentences.
            let code = (error as? AudioCaptureError)?.description ?? "engine_start_failed"
            let microphone = Permission.microphone.status
            emit("record.error", ["reason": reason, "error": code, "microphone": microphone])
            let shown = microphone == "granted" ? code : microphone == "undetermined" ? "microphone_undetermined" : "microphone_denied"
            overlay.set(.error, message: OverlayText.error(shown))
            return code
        }
        recordingStartedAt = ProcessInfo.processInfo.systemUptime
        // Sound before the engine is up is lost (the first syllable); this shows how long that is.
        let startMs = Int(((recordingStartedAt! - t0) * 1000).rounded())
        emit("log", ["level": "debug", "message": "mic engine started in \(startMs) ms"])
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
        let audioPath = dump(samples)
        if let audioPath { fields["audioPath"] = audioPath }
        recordingStartedAt = nil
        emit("record.stopped", fields)
        // The app moves it on with overlay.state done|error. With nothing recorded (the mic prompt was up,
        // or the engine never delivered) there is nothing to transcribe, so no `done` would come: hide now.
        overlay.set(samples.isEmpty ? .hidden : .processing)
        transcribe(samples, durationMs: fields["durationMs"] as! Int, audioPath: audioPath)
    }

    /// `transcript.final` for a finished recording, or `transcript.error`. `latencyMs` goes from the end of the
    /// recording (the key let go) to the text, waiting behind an earlier transcription included.
    private func transcribe(_ samples: [Float], durationMs: Int, audioPath: String?) {
        let stoppedAt = ProcessInfo.processInfo.systemUptime
        let previous = sttChain
        sttChain = Task { [stt, weak self] in
            await previous?.value
            do {
                let output = try await stt.transcribe(samples)
                var fields: [String: Any] = [
                    "text": output.text,
                    "raw": output.raw,
                    "lang": output.lang,
                    "durationMs": durationMs,
                    "latencyMs": Int((ProcessInfo.processInfo.systemUptime - stoppedAt) * 1000),
                ]
                if let audioPath { fields["audioPath"] = audioPath }
                self?.emit("transcript.final", fields)
            } catch {
                let code = (error as? Transcriber.Failure)?.rawValue ?? Transcriber.Failure.failed.rawValue
                self?.emit("transcript.error", ["error": code])
            }
        }
    }

    private func cancelRecording(reason: String) {
        guard audio.isRecording else { return }
        _ = audio.stop()
        recordingStartedAt = nil
        emit("record.cancelled", ["reason": reason])
        overlay.set(.hidden)
    }

    private func dump(_ samples: [Float]) -> String? {
        guard let dumpDirectory, !samples.isEmpty else { return nil }
        let url = dumpDirectory.appendingPathComponent(WAV.dumpName(at: Date()))
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
            if let error = configure(message) { return reply(id, ok: false, error: error) }
            reply(id, ok: true, ["hotkey": tap.key.rawValue, "hotkeyActive": hotkeyActive])
        case "record.start":
            if let error = Rules.recordStart(isRecording: audio.isRecording) { return reply(id, ok: false, error: error) }
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
                self?.reply(id, ok: true, ["permission": name, "state": status])
                self?.pollPermissions()
            }
        case "llm.complete", "llm.prewarm":
            llm.handle(message) { [weak self] ok, error, fields in self?.reply(id, ok: ok, error: error, fields) }
        case "overlay.state":
            guard let name = message.string("state"), let phase = OverlayPhase(rawValue: name) else {
                return reply(id, ok: false, error: "unknown_state")
            }
            overlay.set(phase, message: message.string("message"))
            reply(id, ok: true)
        case "insert.text", "notify":
            reply(id, ok: false, error: "not_implemented")
        default:
            reply(id, ok: false, error: "unknown_type")
        }
    }

    /// `config.set {hotkey?, holdThresholdMs?, doubleTapMs?}` (ADR 0001). Hold and double tap share the one key.
    private func configure(_ message: InboundMessage) -> String? {
        // Check everything before changing anything: a bad value leaves the whole config as it was.
        let hold = message.double("holdThresholdMs"), doubleTap = message.double("doubleTapMs")
        if let error = Rules.timing(hold) ?? Rules.timing(doubleTap) { return error }
        var language: TranscriptionLanguage?
        if let name = message.string("language") {
            guard let value = TranscriptionLanguage(rawValue: name) else { return "invalid_value" }
            language = value
        }
        var dictionary: [DictionaryEntry]?
        if message.fields["dictionary"] != nil {
            guard let entries = DictionaryEntry.parse(message.fields["dictionary"]) else { return "invalid_value" }
            dictionary = entries
        }
        var vad: Bool?
        if let value = message.fields["vad"] {
            guard let flag = value as? Bool else { return "invalid_value" }
            vad = flag
        }
        var requested: HotkeyKey?
        if let name = message.string("hotkey") {
            guard let key = HotkeyKey(rawValue: name) else { return "unknown_hotkey" }
            requested = key
        }
        if let key = requested, key != tap.key {
            tap.stop()
            tap.key = key
            gesture.reset()
            if audio.isRecording { cancelRecording(reason: "config") }
            tap.start()
        }
        if let ms = hold { gesture.holdThreshold = ms / 1000 }
        if let ms = doubleTap { gesture.doubleTapWindow = ms / 1000 }
        if language != nil || dictionary != nil || vad != nil {
            let prepared = dictionary.map(TranscriptDictionary.init)
            // In the same chain as the transcriptions: a recording that ends after this command uses it.
            let previous = sttChain
            sttChain = Task { [stt] in
                await previous?.value
                await stt.configure(language: language, dictionary: prepared, vad: vad)
                // A new dictionary needs a new CTC session, and the VAD its model: load them now, not on the
                // next dictation.
                if prepared != nil || vad == true { try? await stt.warmUp() }
            }
        }
        return nil
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
        // Apple Intelligence can be turned on, or the model finish downloading, while we run.
        let llmStatus = llm.status
        guard now != lastPermissions || Self.key(llmStatus) != lastLlm else { return }
        lastLlm = Self.key(llmStatus)
        let key = Permission.inputMonitoring.rawValue
        if now[key] == "granted", lastPermissions[key] != "granted" {
            // A tap made before the grant stays filtered; make a new one.
            tap.stop()
            tap.start()
        }
        let mic = Permission.microphone.rawValue
        if now[mic] == "granted", lastPermissions[mic] != "granted" { audio.warmUp() }
        lastPermissions = now
        emit("permissions.changed", ["permissions": now, "hotkeyActive": hotkeyActive, "llm": llmStatus])
    }

    private static func key(_ status: [String: Any]) -> String {
        "\(status["available"] ?? false)|\(status["reason"] ?? "")"
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
