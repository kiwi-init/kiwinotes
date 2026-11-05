import CoreAudio
import Foundation
import KiwiHelperCore

/// Glue between the hotkey, the mic and the IPC connection. Everything here runs on the main thread.
final class Helper {
    static let version = "0.1.0"

    private let connection: SocketConnection
    private let dumpDirectory: URL?
    /// The mic the dictation records from (T3229, spec #3202): the Mac's when the output is a Bluetooth headset.
    private let mic: MicSelection
    private let audio: AudioCapture
    private let devicesWatcher = AudioDevicesWatcher()
    /// The app sent `microphone` in a `config.set`, so it knows `audio.inputs.changed`.
    private var appKnowsMicrophone = false
    private let overlay = Overlay()
    private let inserter = Inserter()
    private var gesture = HotkeyGesture()
    /// ⌥ was held when the dictation key last went down: the recording it starts is a quick note (T1320).
    private var nextIsNote = false
    private var tap: HotkeyTap!
    private var tickTimer: DispatchWorkItem?
    private var recordingStartedAt: TimeInterval?
    private var lastPermissions: [String: String] = [:]
    private let llm = LLM()
    private var lastLlm = ""
    /// The CTC vocabulary boosting is on (T1973); `KIWI_STT_BOOSTING=off` turns it off (to measure without it).
    private let stt = Transcriber(vocabularyBoosting: ProcessInfo.processInfo.environment["KIWI_STT_BOOSTING"] != "off")
    /// The previous transcription: each one waits for it, so transcripts come out in recording order.
    private var sttChain: Task<Void, Never>?
    /// The last `stt.status` sent, so a model that loads after an `unavailable` gets its `ready` (#383).
    private var sttStatus = STTStatus()
    private let frontApp = FrontApp()
    /// `debug.transcribe` exists only with `KIWI_DEBUG=1` (development; never in a release build's environment).
    private let debugCommands = ProcessInfo.processInfo.environment["KIWI_DEBUG"] == "1"
    /// `--headless` (T1739): for the agents' CLI. No hotkey tap, no overlay, no mic, no permission asks, and every
    /// insert is a dry run. Nothing reaches the screen or the person's keyboard, clipboard or microphone.
    private let headless: Bool
    private let meetingDirectory: URL?
    private let meetingMic = MeetingMicrophone()
    private var meetings: MeetingCommands?
    /// R3: the live transcript of the meeting being recorded, and the dictionary it uses.
    private let live = LiveMeetingSlot()
    private var meetingDictionary = TranscriptDictionary.empty
    /// R2 (#195): which app takes the mic, the pop-up, the meeting shortcuts and the meeting pill.
    private var meeting: MeetingController!

    init(connection: SocketConnection, dumpDirectory: URL?, headless: Bool = false, meetingDirectory: URL? = nil) {
        self.connection = connection
        self.dumpDirectory = dumpDirectory
        self.headless = headless
        self.meetingDirectory = meetingDirectory
        let mic = MicSelection()
        self.mic = mic
        audio = AudioCapture(makeEngine: { AVMicEngine(device: mic.pick().device.map { AudioDeviceID($0.id) }) })
        tap = HotkeyTap(key: .fn) { [weak self] event in self?.onHotkey(event) }
        tap.meetingCombo = KeyCombo(MeetingController.defaultShortcut)
        tap.pauseMineCombo = KeyCombo(MeetingController.defaultPauseShortcut)
        meeting = MeetingController(ownPids: [getpid(), getppid()], headless: headless)
        meeting.startCapture = { [weak self] app in
            var fields: [String: Any] = [:]
            if let app { fields["app"] = app.name }
            self?.meetingCommand("meeting.start", fields)
        }
        meeting.stopCapture = { [weak self] in self?.meetingCommand("meeting.stop") }
        meeting.setMinePaused = { [weak self] paused in self?.meetingCommand(paused ? "meeting.pauseMine" : "meeting.resumeMine") }
        meeting.emit = { [weak self] type, fields in self?.emit(type, fields) }
        audio.onLevel = { [weak self] level in
            // Level queue: send straight away, the write queue serializes it.
            self?.emit("audio.level", ["rms": (Double(level) * 1000).rounded() / 1000])
            self?.overlay.push(level: level)
        }
        overlay.onCancel = { [weak self] in self?.endFromOverlay(finish: false) }
        overlay.onFinish = { [weak self] in self?.endFromOverlay(finish: true) }
        overlay.onVisibleChange = { [weak self] visible in self?.meeting.setDictating(visible) }
        // Touching the input before the mic is granted can bring up the system prompt.
        audio.mayWarmUp = { [headless] in !headless && Permission.microphone.status == "granted" }
        audio.onLog = { [weak self] message in self?.emit("log", ["level": "info", "message": "mic: \(message)"]) }
        // The time from the key to the first sound kept, per dictation (T985): only a number, no audio.
        audio.onFirstBuffer = { [weak self] after in
            let ms = Int((after * 1000).rounded())
            DispatchQueue.main.async { self?.emit("log", ["level": "info", "message": "mic: first audio \(ms) ms after the key"]) }
        }
        audio.onLost = { [weak self] code, samples in
            guard let self else { return }
            guard !samples.isEmpty else {
                self.gesture.reset()
                self.recordingStartedAt = nil
                self.emit("record.error", ["reason": "hotkey", "error": code, "microphone": Permission.microphone.status])
                return self.overlay.set(.error, message: OverlayText.error(code))
            }
            // T883: the mic went away mid-dictation. What it heard is transcribed like a normal end (as the pill's ✓:
            // the key still held doesn't start another one), and `lost` tells the app to say the mic dropped.
            let mode = self.gesture.endedFromOverlay()
            self.tickTimer?.cancel()
            if mode == .toggle { self.emit("hotkey.toggle", ["on": false]) }
            self.finishRecording(samples, reason: "hotkey", mode: mode.rawValue, lost: code)
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
                try? self?.meetings?.capture.stop()
                exit(0)
            }
        }
        if !headless { tap.start() }
        overlay.enabled = !headless
        meeting.start()
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
            "headless": headless,
        ])
        // Read only after `ready` is queued, so it is always the first line the app sees.
        connection.start()
        // Recovery enumerates already-spooled files only. It never starts the mic or system tap.
        if let meetingDirectory, FileManager.default.fileExists(atPath: meetingDirectory.path) {
            do {
                try meetingCommands().recover()
                recoverTranscripts()
            } catch { emit("meeting.error", ["error": "meeting_recovery_failed"]) }
        }
        // Who macOS checks the permissions against, and what it says (T658). No dialog: these only read.
        let tcc = Responsible.current()?.summary ?? "responsible process unknown"
        emit("log", ["level": "info", "message": "tcc: \(tcc); \(Permission.snapshot().sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: " "))"])
        // `mayWarmUp` checks the mic permission (T590).
        if !headless {
            audio.warmUp()
        }
        // Only reads Core Audio, so it runs headless too (the Settings list the mics there).
        devicesWatcher.start { [weak self] what in
            guard let self else { return }
            if !self.headless, self.mic.isStale(after: what) { self.audio.inputChanged(what) }
            if !self.headless, self.meetings?.capture.session != nil, self.meetingMic.selection.isStale(after: what) { self.meetingMic.audio.inputChanged(what) }
            // Only to an app that knows the event: it sent `microphone` (T3230). An older app logs an unknown type.
            if self.appKnowsMicrophone { self.emit("audio.inputs.changed", [:]) }
        }
        schedulePermissionPoll()
        prepareSTT()
        frontApp.onChange = { [weak self] app in self?.emit("app.active", app.fields) }
        frontApp.start()
    }

    /// `stt.status`, only when it changes. Main thread.
    private func setSTT(_ state: STTStatus.State, _ fields: [String: Any] = [:]) {
        guard sttStatus.update(state) else { return }
        emit("stt.status", fields.merging(["state": state.rawValue]) { _, new in new })
    }

    /// Loads the model while nobody is waiting for it (the first run downloads it), so the first dictation
    /// only pays for the transcription.
    private func prepareSTT() {
        let started = ProcessInfo.processInfo.systemUptime
        // The first load can take a minute (download, or CoreML compiling for the Neural Engine after a macOS
        // update): the app shows "preparing" until `ready`.
        setSTT(.loading)
        let previous = sttChain
        // On the main actor, like the rest of Helper: the awaits on `stt` leave it, and `setSTT` runs back on it.
        sttChain = Task { @MainActor [stt, weak self] in
            await previous?.value
            await stt.setBoostingHandler { [weak self] state in
                Task { @MainActor in self?.emit("stt.boosting", ["state": state]) }
            }
            do {
                try await stt.warmUp()
                let ms = Int((ProcessInfo.processInfo.systemUptime - started) * 1000)
                self?.setSTT(.ready, ["loadMs": ms])
            } catch {
                self?.setSTT(.unavailable, ["error": Transcriber.Failure.modelUnavailable.rawValue])
            }
        }
    }

    // MARK: Hotkey

    private func onHotkey(_ event: HotkeyTap.Event) {
        let actions: [GestureAction]
        switch event {
        case .down(let t, let note):
            emit("hotkey.down", ["key": tap.key.rawValue])
            // A recording this press starts is a quick note (T1320); the 2nd tap of a double tap keeps the 1st's.
            nextIsNote = note
            actions = gesture.keyDown(at: t)
        case .up(let t):
            emit("hotkey.up", ["key": tap.key.rawValue])
            actions = gesture.keyUp(at: t)
        case .otherKey:
            actions = gesture.otherKeyDown()
        case .notesShortcut:
            emit("hotkey.notes", [:])
            return
        case .meetingShortcut:
            meeting.meetingShortcut()
            return
        case .pauseMineShortcut:
            meeting.pauseMineShortcut()
            return
        }
        actions.forEach(apply)
        scheduleTick()
    }

    private func apply(_ action: GestureAction) {
        switch action {
        case .startRecording:
            startRecording(reason: "hotkey", note: nextIsNote)
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
    private func startRecording(reason: String, note: Bool = false) -> String? {
        guard !audio.isRecording else { return nil }
        // Tell the app first, so the overlay shows up while the engine comes up. If the mic then fails,
        // record.error follows record.started (ADR 0001).
        var started: [String: Any] = ["reason": reason]
        if note { started["target"] = "note" }
        if let app = FrontApp.current { started["app"] = ["bundleId": app.bundleId, "name": app.name] }
        // Which mic (T3229): the app tells the person when the chosen one wasn't connected (`fellBack`).
        // The lid closed (or opened) since the engine was made: `start` makes the new one right away (T3229, #3300).
        let stale = !headless && mic.isStale()
        if stale { audio.inputChanged("mic changed since the warm-up") }
        if let pick = stale ? mic.peek() : mic.last { started["microphone"] = pick.fields }
        emit("record.started", started)
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
        emit("log", ["level": "info", "message": "mic: engine started in \(startMs) ms"])
        return nil
    }

    private func stopRecording(reason: String, mode: String) {
        guard audio.isRecording else { return }
        finishRecording(audio.stop(), reason: reason, mode: mode)
    }

    /// The end of a recording, from the mic or from `debug.transcribe`: `record.stopped`, the pill, the transcript.
    private func finishRecording(_ samples: [Float], reason: String, mode: String, lost: String? = nil) {
        var fields: [String: Any] = [
            "reason": reason,
            "mode": mode,
            "durationMs": Int(Double(samples.count) / AudioCapture.sampleRate * 1000),
            "samples": samples.count,
        ]
        if let lost { fields["lost"] = lost }
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
        sttChain = Task { @MainActor [stt, weak self] in
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
                // The model loaded now, after a failed start (offline on the first run, #383).
                self?.setSTT(.ready)
            } catch {
                let code = (error as? Transcriber.Failure)?.rawValue ?? Transcriber.Failure.failed.rawValue
                self?.emit("transcript.error", ["error": code])
                if code == Transcriber.Failure.modelUnavailable.rawValue {
                    self?.setSTT(.unavailable, ["error": code])
                }
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
        case _ where ["meeting.pauseMine", "meeting.resumeMine"].contains(message.type) && meeting.isRecording:
            // Through the detector, so the meeting app's mute and the person's pause don't undo each other (R2).
            meeting.minePausedByApp(message.type == "meeting.pauseMine")
            reply(id, ok: true)
        case "debug.meetingMicUsers" where debugCommands:
            // The agents' CLI drives the meeting detection with made-up mic users; nothing reads the real audio system.
            guard let list = message.fields["users"] as? [[String: Any]] else { return reply(id, ok: false, error: "invalid_value") }
            let users = list.compactMap { u -> MicUser? in
                guard let pid = (u["pid"] as? NSNumber)?.int32Value, let bundleId = u["bundleId"] as? String else { return nil }
                return MicUser(pid: pid, bundleId: bundleId)
            }
            meeting.micUsers(Set(users))
            reply(id, ok: true)
        case "meeting.answer":
            // The meeting panel's buttons, from the app (the hub's card, R6, or a test): `record`, `notNow`, `stop`, `keepGoing`.
            guard let name = message.string("answer"), let answer = MeetingDetector.Answer(rawValue: name) else {
                return reply(id, ok: false, error: "invalid_value")
            }
            meeting.answer(answer)
            reply(id, ok: true)
        case _ where message.type.hasPrefix("meeting."):
            // Before even constructing a source; agents can never trigger a capture or TCC prompt headless.
            if headless && ["meeting.start", "meeting.resumeMine"].contains(message.type) {
                return reply(id, ok: false, error: "headless_no_mic")
            }
            do {
                let result = try meetingCommands().handle(message)
                reply(id, ok: result.ok, error: result.error, result.data)
            } catch { reply(id, ok: false, error: "meeting_unavailable") }
        case "ping":
            reply(id, ok: true)
        case "config.set":
            if let error = configure(message) { return reply(id, ok: false, error: error) }
            reply(id, ok: true, ["hotkey": tap.key.rawValue, "hotkeyActive": hotkeyActive])
        case "record.start" where headless:
            reply(id, ok: false, error: "headless_no_mic") // dictate a WAV with debug.transcribe instead
        case "permissions.request" where headless:
            reply(id, ok: false, error: "headless")
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
            permission.request(reset: message.fields["reset"] as? Bool == true) { [weak self] status in
                self?.reply(id, ok: true, ["permission": name, "state": status])
                self?.pollPermissions()
            }
        case "llm.complete", "llm.prewarm":
            llm.handle(message) { [weak self] ok, error, fields in self?.reply(id, ok: ok, error: error, fields) }
        case "audio.inputs":
            reply(id, ok: true, mic.inputs())
        case "overlay.state":
            guard let name = message.string("state"), let phase = OverlayPhase(rawValue: name) else {
                return reply(id, ok: false, error: "unknown_state")
            }
            overlay.set(phase, message: message.string("message"))
            reply(id, ok: true)
        case "insert.text":
            guard let text = message.string("text") else { return reply(id, ok: false, error: "invalid_value") }
            if headless || message.fields["dryRun"] as? Bool == true {
                // Agents' tests (#490): nothing touches the person's clipboard or keyboard. The text only reaches the
                // log in a debug run; otherwise its length, so no real dictation ends up in a log.
                let shown = debugCommands ? "\"\(text)\"" : "\(text.count) chars"
                emit("log", ["level": "info", "message": "insert.text dryRun: \(shown)"])
                var data: [String: Any] = ["pasted": false, "restored": false, "dryRun": true]
                // `simulate` (the agents' CLI, T1740): a described field instead of the real one. The plan and the space
                // come from the same rules as a paste, and nothing about the app in front is read.
                if message.fields["simulate"] != nil, SimulatedField(message.fields["simulate"]) == nil {
                    // A described field that doesn't parse: an error, not a silent fall back to the real front app (T1853).
                    return reply(id, ok: false, error: "invalid_value")
                } else if let field = SimulatedField(message.fields["simulate"]) {
                    let autoSpace = (message.fields["autoSpace"] as? Bool) ?? true
                    let outcome = field.outcome(text: text, autoSpace: autoSpace)
                    data["plan"] = outcome.plan.name
                    if let reason = outcome.plan.reason { data["reason"] = reason }
                    data["spaced"] = outcome.spaced
                } else if let app = FrontApp.current {
                    data["app"] = app.bundleId
                }
                return reply(id, ok: true, data)
            }
            let restore = (message.fields["restoreClipboard"] as? Bool) ?? true
            let autoSpace = (message.fields["autoSpace"] as? Bool) ?? true
            inserter.insert(text, restoreClipboard: restore, autoSpace: autoSpace) { [weak self] outcome in
                var data: [String: Any] = ["pasted": outcome.pasted, "restored": outcome.restored]
                if outcome.spaced { data["spaced"] = true }
                if let reason = outcome.reason { data["reason"] = reason }
                if let app = outcome.app { data["app"] = app }
                data["focusVia"] = outcome.focusVia
                self?.reply(id, ok: true, data)
            }
        case "debug.transcribe" where debugCommands:
            debugTranscribe(id, message)
        case "notify":
            reply(id, ok: false, error: "not_implemented")
        default:
            reply(id, ok: false, error: "unknown_type")
        }
    }

    private func meetingCommands() throws -> MeetingCommands {
        if let meetings { return meetings }
        guard let meetingDirectory, #available(macOS 14.2, *) else { throw MeetingFailure.invalidValue }
        let system = SystemAudioTap()
        let capture = try MeetingCapture(root: meetingDirectory, mine: meetingMic, system: system)
        let fail: (String) -> Void = { [weak self] code in
            DispatchQueue.main.async {
                guard let self else { return }
                let session = self.meetings?.capture.session
                try? self.meetings?.capture.stop()
                self.emit("meeting.error", ["error": code])
                // The capture is over: the app's live card (R6) and the note (R4) learn it like a normal stop.
                if let session {
                    let pending = self.meetings?.capture.pendingChunks().filter { $0.session == session }.count ?? 0
                    self.emit("meeting.stopped", ["session": session, "pendingChunks": pending, "reason": "error", "error": code])
                    self.finishLive()
                }
            }
        }
        let failAndStop: (String) -> Void = { [weak self] code in
            fail(code)
            DispatchQueue.main.async { self?.meeting.captureStopped() }
        }
        system.onError = failAndStop
        capture.onError = failAndStop
        meetingMic.audio.onLost = { code, _ in failAndStop(code) }
        meetingMic.audio.onLog = { [weak self] message in self?.emit("log", ["level": "info", "message": "meeting mic: \(message)"]) }
        meetingMic.selection.choice = mic.choice
        // R3: every packet, after the spool has it, goes to the live transcript too.
        capture.onSamples = { [live] channel, frame, samples in live.feed(channel, startFrame: frame, samples: samples) }
        let commands = MeetingCommands(capture: capture, headless: headless,
            microphonePermission: { Permission.microphone.status },
            metadata: { [weak self] in
                return ["output": MeetingOutput.route(), "microphone": self?.meetingMic.selection.last?.fields ?? [:]]
            }, emit: { [weak self] type, fields in
                self?.emit(type, fields)
                // R3: the transcript starts with the capture (right here, so no packet waits long) and ends with it.
                if type == "meeting.started", let session = fields["session"] as? String { self?.startLive(session: session, output: fields["output"] as? String) }
                if type == "meeting.stopped" { self?.finishLive() }
                // The detector counts a recording only once R1 says it started, whoever asked for it.
                DispatchQueue.main.async {
                    if type == "meeting.started" { self?.meeting.captureStarted(appName: fields["app"] as? String) }
                    if type == "meeting.stopped" { self?.meeting.captureStopped() }
                }
            })
        meetings = commands
        return commands
    }

    // MARK: Live transcript (R3)

    private func startLive(session: String, output: String?) {
        guard !headless else { return }
        live.start(makeTranscriber(session: session, output: output ?? "unknown"))
    }

    private func finishLive() {
        guard let t = live.take() else { return }
        Task { await t.finish() }
    }

    private func makeTranscriber(session: String, output: String) -> LiveMeetingTranscriber {
        LiveMeetingTranscriber(
            session: session, output: output, dictionary: meetingDictionary,
            systemChunks: { [weak self] in self?.meetings?.capture.pendingChunks().filter { $0.session == session } ?? [] },
            emit: { [weak self] type, fields in self?.emit(type, fields) })
    }

    /// After a crash: the meetings left in the spool are transcribed (as fast as the models go), one after the other.
    /// The app writes the finals into each note by its session and acks the audio as usual (R1, R4).
    private func recoverTranscripts() {
        guard !headless, let capture = meetings?.capture else { return }
        let sessions = Dictionary(grouping: capture.pendingChunks(), by: \.session)
        guard !sessions.isEmpty else { return }
        emit("log", ["level": "info", "message": "meeting: recovering \(sessions.count) meeting(s)"])
        Task { [weak self] in
            for (session, chunks) in sessions.sorted(by: { $0.key < $1.key }) {
                guard let self else { return }
                let t = self.makeTranscriber(session: session, output: "unknown")
                for chunk in chunks.sorted(by: { $0.startFrame < $1.startFrame }) {
                    guard let samples = try? LiveMeetingTranscriber.floats(chunk) else { continue }
                    t.feed(chunk.channel, startFrame: chunk.startFrame, samples: samples)
                }
                await t.finish()
            }
        }
    }

    /// A meeting command from the detector (R2): the same path as the app's, with no reply to send.
    private func meetingCommand(_ type: String, _ fields: [String: Any] = [:]) {
        guard !headless || !["meeting.start", "meeting.resumeMine"].contains(type) else {
            return emit("meeting.error", ["error": "headless_no_mic"])
        }
        var object = fields
        object["type"] = type
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              let message = try? InboundMessage.decode(data) else { return }
        do { _ = try meetingCommands().handle(message) } catch { emit("meeting.error", ["error": "meeting_unavailable"]) }
    }

    /// `debug.transcribe {path}` (KIWI_DEBUG=1): a WAV takes the path of a recording that just ended, so the app can
    /// be tested end to end without the mic. Synthetic audio only (`say`).
    private func debugTranscribe(_ id: String?, _ message: InboundMessage) {
        guard let path = message.string("path") else { return reply(id, ok: false, error: "invalid_value") }
        if let error = Rules.recordStart(isRecording: audio.isRecording) { return reply(id, ok: false, error: error) }
        let samples: [Float]
        do {
            samples = try AudioFile.samples16k(URL(fileURLWithPath: (path as NSString).expandingTildeInPath))
        } catch {
            return reply(id, ok: false, error: "invalid_value")
        }
        // The same events as a dictation: started (with the app in front), stopped, then the transcript. The agents'
        // CLI (T1740) can say which app it is (`app: {bundleId, name?}`) and make it a quick note (`target: "note"`).
        var started: [String: Any] = ["reason": "debug"]
        if let app = message.fields["app"] as? [String: Any], let bundleId = app["bundleId"] as? String, !bundleId.isEmpty {
            started["app"] = ["bundleId": bundleId, "name": (app["name"] as? String) ?? bundleId]
        } else if message.fields["app"] != nil {
            return reply(id, ok: false, error: "invalid_value")
        } else if let app = FrontApp.current {
            started["app"] = ["bundleId": app.bundleId, "name": app.name]
        }
        if let target = message.string("target") {
            guard target == "note" else { return reply(id, ok: false, error: "invalid_value") }
            started["target"] = "note"
        }
        reply(id, ok: true)
        emit("record.started", started)
        overlay.set(.listening)
        finishRecording(samples, reason: "debug", mode: "debug")
    }

    /// `config.set {hotkey?, holdThresholdMs?, doubleTapMs?, notesShortcut?, microphone?}` (ADR 0001; `microphone`:
    /// T3229, "auto" | "builtin" | "system" | "uid:<UID>"). Hold and double tap share
    /// the one key. `notesShortcut`: "control+option+n", or null to turn it off (T1499). R2 (#195):
    /// `meetingShortcut`/`meetingPauseShortcut` (the same format, or null; default ⌃⌥R and ⌃⌥M), `meetingSuggest`
    /// (the pop-up, default true) and `meetingApps` (`[{bundleId, name}]`, replaces the default list).
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
        var microphone: MicChoice?
        if let value = message.fields["microphone"] {
            guard let name = value as? String, let choice = MicChoice(name) else { return "invalid_value" }
            microphone = choice
        }
        var notesCombo: KeyCombo??
        if let value = message.fields["notesShortcut"] {
            if value is NSNull {
                notesCombo = .some(nil)
            } else {
                guard let spec = value as? String, let combo = KeyCombo(spec) else { return "invalid_value" }
                notesCombo = .some(combo)
            }
        }
        var meetingCombos: [WritableKeyPath<HotkeyTap, KeyCombo?>: KeyCombo?] = [:]
        for (field, path) in [("meetingShortcut", \HotkeyTap.meetingCombo), ("meetingPauseShortcut", \HotkeyTap.pauseMineCombo)] {
            guard let value = message.fields[field] else { continue }
            if value is NSNull {
                meetingCombos[path] = .some(nil)
            } else {
                guard let spec = value as? String, let combo = KeyCombo(spec) else { return "invalid_value" }
                meetingCombos[path] = .some(combo)
            }
        }
        if let value = message.fields["meetingSuggest"], !(value is Bool) { return "invalid_value" }
        if let value = message.fields["meetingApps"], MeetingApps.parse(value) == nil { return "invalid_value" }
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
            if !headless { tap.start() }
        }
        if let combo = notesCombo { tap.notesCombo = combo }
        for (path, combo) in meetingCombos { tap[keyPath: path] = combo }
        _ = meeting.configure(message.fields)
        if microphone != nil { appKnowsMicrophone = true }
        if let choice = microphone, choice != mic.choice {
            mic.choice = choice
            // A new engine for the new mic; mid-recording it switches and keeps what was captured.
            if !headless { audio.inputChanged("microphone: \(choice.value)") }
            meetingMic.selection.choice = choice
            if meetings?.capture.session != nil, !headless { meetingMic.audio.inputChanged("microphone: \(choice.value)") }
        }
        if let ms = hold { gesture.holdThreshold = ms / 1000 }
        if let ms = doubleTap { gesture.doubleTapWindow = ms / 1000 }
        if language != nil || dictionary != nil || vad != nil {
            let prepared = dictionary.map(TranscriptDictionary.init)
            if let prepared {
                meetingDictionary = prepared
                live.transcriber?.setDictionary(prepared)
            }
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
            if !headless { tap.start() }
        }
        let mic = Permission.microphone.rawValue
        if now[mic] == "granted", lastPermissions[mic] != "granted", !headless { audio.warmUp() }
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
