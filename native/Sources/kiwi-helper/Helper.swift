import CoreAudio
import Foundation
import KiwiHelperCore

/// Glue between the hotkey, the mic and the IPC connection. Everything here runs on the main thread.
final class Helper {
    static let version = "0.1.0"

    private let connection: SocketConnection
    private let dumpDirectory: URL?
    private let recordingJournal: RecordingJournal?
    private var currentRecovery: RecordingRecovery?
    /// The mic the dictation records from (T3229, spec #3202): the Mac's when the output is a Bluetooth headset.
    private let mic: MicSelection
    private let audio: AudioCapture
    private var media: DictationMedia!
    private let devicesWatcher = AudioDevicesWatcher()
    /// The app sent `microphone` in a `config.set`, so it knows `audio.inputs.changed`.
    private var appKnowsMicrophone = false
    private let overlay = Overlay()
    /// O gato no overlay (spec #9810): a página do gato numa janela como a da pílula.
    private lazy var catOverlay: CatOverlay = MainActor.assumeIsolated { CatOverlay() }
    /// L26 (T6910): the card that asks before a correction goes into the dictionary.
    private let learnPanel = LearnPanel()
    private let learnPrompt = LearnPrompt { delay, run in DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: run) }
    private let inserter = Inserter()
    /// The two talk keys (spec #9876): Fn for the dictation, Control for the agent. They never record together.
    private var talk = TalkKeys()
    /// Whose recording is on (or finishing its tail): the dictation's or the agent's.
    private var recordingTarget: TalkTarget?
    /// The agent's recording passed the hold (or was latched): the person is talking to the agent, not using ⌃ as a
    /// modifier. Only then the sound and the cat's `ouvindo` (`agent.listening`), so ⌃C never flashes them.
    private var agentConfirmed = false
    private var agentConfirmTimer: DispatchWorkItem?
    /// Spec #9876 (#11393): the agent's mic opens only after the hold time or on the 2nd tap, never at the press.
    private var agentGate = AgentMicGate()
    /// The agent's transcription is under way; Esc now drops it (`agentDropped`), and nothing is sent.
    private var agentTranscribing = false
    private var agentDropped = false
    /// The app says the agent is busy with a request: the Control doesn't start listening (one request at a time).
    private var agentBusy = false
    /// T5833 (#213): os sons de início e de fim. Ligados por padrão; o app manda o ajuste no `config.set {cues}`.
    private let cues: RecordingCues
    /// ⌥ was held when the dictation key last went down: the recording it starts is a quick note (T1320).
    private var nextIsNote = false
    private var tap: HotkeyTap!
    /// Every global shortcut, by id (T5349, #175): `dictation`, `notes`, `meeting`, `meetingPause`. A missing id is off.
    private var shortcuts: [String: Shortcut] = [
        "dictation": .key(.fn),
        "meeting": Shortcut(MeetingController.defaultShortcut)!,
        "meetingPause": Shortcut(MeetingController.defaultPauseShortcut)!,
        // L5 (T5458): Esc cancels the dictation, only while it records (see `tap.isActive`).
        "cancel": Shortcut("escape", bareKey: true)!,
        // L9 (T5459): paste the last dictation again, from any app. ⌃⌥V, next to Kiwi's other ⌃⌥ shortcuts.
        "pasteLast": Shortcut("control+option+v")!,
    ]
    static let shortcutIds: Set<String> = ["dictation", "cancel", "pasteLast", "notes", "meeting", "meetingPause", "agent"]
    /// A `shortcut.record` waiting for the person to press the shortcut.
    private var recordingShortcutId: String?
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
    /// O modo preciso (T6602): o Whisper small, quando o app manda o caminho do modelo no `config.set {precise}`.
    private let precise = PreciseTranscriber()
    /// O modelo do modo preciso está carregado: os ditados saem por ele. Só no main actor.
    private var preciseReady = false
    /// As cargas e as trocas do modelo do modo preciso, em ordem, fora da fila das transcrições: um ditado não espera
    /// o modelo carregar, sai pelo Parakeet até ele ficar pronto.
    private var preciseChain: Task<Void, Never>?
    /// R2 (#195): which app takes the mic, the pop-up, the meeting shortcuts and the meeting pill.
    private var meeting: MeetingController!
    /// L6 (T5457): com o Fn como atalho, a ação do 🌐 do macOS fica em "Nenhuma ação" enquanto o helper roda.
    private var globe: GlobeKeyOwner!
    private var globeStarted = false
    private var signalSources: [DispatchSourceSignal] = []

    init(connection: SocketConnection, dumpDirectory: URL?, headless: Bool = false, meetingDirectory: URL? = nil, recoveryDirectory: URL? = nil) {
        self.connection = connection
        self.dumpDirectory = dumpDirectory
        cues = RecordingCues(player: headless ? SilentCuePlayer() : SoundCuePlayer())
        self.recordingJournal = recoveryDirectory.map { RecordingJournal(directory: $0) }
        self.headless = headless
        self.meetingDirectory = meetingDirectory
        let mic = MicSelection()
        self.mic = mic
        audio = AudioCapture(makeEngine: { AVMicEngine(device: mic.pick().device.map { AudioDeviceID($0.id) }) })
        let dataDirectory = meetingDirectory?.deletingLastPathComponent()
        media = DictationMedia(volume: headless || ProcessInfo.processInfo.environment["KIWI_DEBUG"] == "1" ? nil : OutputVolume(),
                               journal: dataDirectory.map { FileMediaVolumeJournal(file: $0.appendingPathComponent("dictation-media-volume.json")) },
                               notify: { [weak self] code in self?.emit("log", ["level": "info", "message": code]) })
        tap = HotkeyTap { [weak self] event in self?.onTap(event) }
        // The cancel is armed only while a dictation records: outside it, Esc is the other apps' (L5).
        // L12 (T5835): o que a conferência da colagem achou, sem texto, para o log em arquivo.
        inserter.onChecked = { [weak self] verdict, typed, app in
            self?.emit("log", ["level": "info", "message": "paste: \(verdict.log)\(typed ? " · typed instead" : "") · \(app ?? "-")"])
        }
        // L23: a correção logo depois da colagem vai ao app, que decide se vira dicionário. Só o trecho colado.
        inserter.onEdited = { [weak self] pasted, edited, app in
            var fields: [String: Any] = ["pasted": pasted, "edited": edited]
            if let app { fields["app"] = app }
            self?.emit("paste.edited", fields)
        }
        tap.isActive = { [weak self] id in
            guard let self else { return false }
            switch id {
            // Esc: while recording, and while the agent's text is being transcribed (it drops it).
            case "cancel": return self.audio.isRecording || self.agentTranscribing
            // The Control: not while the agent is busy (spec #9876).
            case "agent": return !self.agentBusy
            default: return true
            }
        }
        // A preferência de verdade só no app. No headless e com KIWI_DEBUG (os agentes), uma falsa num arquivo, e o
        // AppleFnUsageType do Mac nunca é tocado (AGENTS.md, #4871).
        let fake = headless || ProcessInfo.processInfo.environment["KIWI_DEBUG"] == "1"
        let store: FnUsageStore? = fake
            ? dataDirectory.map { FileFnUsageStore(file: $0.appendingPathComponent("fn-usage-fake.json"),
                                                   initial: Int32(ProcessInfo.processInfo.environment["KIWI_FAKE_FN_USAGE"] ?? "") ?? 2) }
            : SystemFnUsage()
        globe = GlobeKeyOwner(store: store, marker: dataDirectory?.appendingPathComponent("globe-preference.json")) { [weak self] line in
            self?.emit("log", ["level": "info", "message": line])
        }
        applyShortcuts()
        meeting = MeetingController(ownPids: [getpid(), getppid()], headless: headless)
        meeting.startCapture = { [weak self] app in
            var fields: [String: Any] = [:]
            if let app { fields["app"] = app.name }
            self?.meetingCommand("meeting.start", fields)
        }
        meeting.stopCapture = { [weak self] in self?.meetingCommand("meeting.stop") }
        meeting.setMinePaused = { [weak self] paused in self?.meetingCommand(paused ? "meeting.pauseMine" : "meeting.resumeMine") }
        meeting.emit = { [weak self] type, fields in self?.emit(type, fields) }
        let journal = recordingJournal
        journal?.onError = { [weak self] _ in self?.emit("log", ["level": "warn", "message": "mic: recording_storage"]) }
        audio.onLevel = { [weak self] level in
            // Level queue: send straight away, the write queue serializes it.
            self?.emit("audio.level", ["rms": (Double(level) * 1000).rounded() / 1000])
            self?.overlay.push(level: level)
            // Spec #9876: com a escuta do agente confirmada, as ondas do gato no overlay seguem a voz, direto do mic.
            DispatchQueue.main.async { self?.catOverlayVoice(Double(level)) }
        }
        overlay.onCancel = { [weak self] in self?.endFromOverlay(finish: false) }
        overlay.onFinish = { [weak self] in self?.endFromOverlay(finish: true) }
        overlay.onVisibleChange = { [weak self] visible in
            self?.meeting.setDictating(visible)
            // A pílula do ditado tem a vez: o gato do overlay espera ela sair (spec #9810).
            if let cat = self?.catOverlay { MainActor.assumeIsolated { cat.setPillVisible(visible) } }
            if visible { self?.learnPrompt.dictationStarted() }
        }
        learnPanel.lift = { [weak self] in self?.meeting.panel.isShowing == true ? MeetingView.panelSize.height - MeetingView.bottom : 0 }
        learnPanel.onAnswer = { [weak self] answer in self?.learnPrompt.answer(answer) }
        learnPrompt.onChange = { [weak self] offer in self?.learnPanel.show(offer) }
        learnPrompt.onAnswer = { [weak self] offer, answer in
            self?.emit("learn.answered", ["from": offer.from, "to": offer.to, "answer": answer.rawValue])
        }
        // Touching the input before the mic is granted can bring up the system prompt.
        audio.mayWarmUp = { [headless] in !headless && Permission.microphone.status == "granted" }
        audio.onLog = { [weak self] message in self?.emit("log", ["level": "info", "message": "mic: \(message)"]) }
        // The device side of each dictation (#5154): formats, buffers, why it ended and who else holds the mic.
        audio.onDiagnostic = { [weak self, mic] diagnostic in
            DispatchQueue.main.async {
                self?.emit("log", ["level": "info", "message": "mic: " + MicDiagnostics.line(diagnostic, pick: mic.last)])
            }
        }
        // The time from the key to the first sound kept, per dictation (T985): only a number, no audio.
        audio.onFirstBuffer = { [weak self] after in
            let ms = Int((after * 1000).rounded())
            DispatchQueue.main.async { self?.emit("log", ["level": "info", "message": "mic: first audio \(ms) ms after the key"]) }
        }
        audio.onLost = { [weak self] code, samples in
            guard let self else { return }
            self.media.end()
            let target = self.recordingTarget ?? .dictation
            if target == .agent { self.agentGate.reset() }
            guard !samples.isEmpty else {
                self.talk.reset(target)
                self.recordingTarget = nil
                self.recordingStartedAt = nil
                // No audio while another app holds the mic (#5154): say which one.
                let busy = MicBusy.classify(code, otherApps: MicDiagnostics.otherApps())
                var fields: [String: Any] = ["reason": "hotkey", "error": busy.code, "microphone": Permission.microphone.status]
                if let app = busy.app { fields["busyApp"] = app }
                if let recovery = self.finishRecovery() { fields["recovery"] = recovery.fields }
                if target == .agent { return self.emit("agent.record.error", fields) }
                self.emit("record.error", fields)
                return self.overlay.set(.error, message: busy.app.map(MicBusy.message) ?? OverlayText.error(busy.code))
            }
            // T883: the mic went away mid-dictation. What it heard is transcribed like a normal end (as the pill's ✓:
            // the key still held doesn't start another one), and `lost` tells the app to say the mic dropped.
            let mode = self.talk.ended(target)
            self.tickTimer?.cancel()
            if mode == .toggle, target == .dictation { self.emit("hotkey.toggle", ["on": false]) }
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
                guard let self else { exit(0) }
                self.quit()
            }
        }
        // O app encerra o helper com SIGTERM: antes de sair, a ação do 🌐 volta (T5457).
        signalSources = [SIGTERM, SIGINT].map { number in
            signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
            source.setEventHandler { [weak self] in
                guard let self else { exit(0) }
                self.quit()
            }
            source.resume()
            return source
        }
        media.restorePending()
        globe.start(fnIsShortcut: dictationKey == .fn)
        globeStarted = true
        if !headless { tap.start() }
        overlay.enabled = !headless
        let catOn = !headless
        MainActor.assumeIsolated {
            catOverlay.enabled = catOn
            catOverlay.log = { [weak self] line in self?.emit("log", ["level": "info", "message": line]) }
        }
        learnPanel.enabled = !headless
        meeting.start()
        lastPermissions = Permission.snapshot()
        lastLlm = Self.key(llm.status)
        emit("ready", [
            "version": Self.version,
            "pid": Int(getpid()),
            "hotkey": dictationSpec,
            "hotkeyActive": hotkeyActive,
            "hotkeyPriority": hotkeyPriority,
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
            if !self.audio.isRecording { self.media.restorePending() }
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

    private func onTap(_ event: HotkeyTap.Event) {
        switch event {
        case .shortcut(let output):
            onShortcut(output)
        case .recorded(let outcome):
            guard let id = recordingShortcutId else { return }
            recordingShortcutId = nil
            switch outcome {
            case .recorded(let spec): reply(id, ok: true, ["shortcut": spec])
            case .cancelled: reply(id, ok: false, error: "cancelled")
            case .invalid: reply(id, ok: false, error: "invalid_shortcut")
            }
        }
    }

    /// The dictation shortcut's text, for `ready` and `config.set`'s reply ("fn", "control+option+d"…); "" when off.
    private var dictationSpec: String { shortcuts["dictation"]?.spec ?? "" }

    /// The dictation key when the dictation shortcut is a modifier on its own: the quick note's ⌥ is read from it.
    private var dictationKey: HotkeyKey? {
        if case .key(let key) = shortcuts["dictation"] { return key }
        return nil
    }

    /// One of the shortcuts did something (T5349). The dictation's key or combination: hold to talk, tap twice to
    /// keep recording (`HotkeyGesture`). Its double tap or sequence: start and stop, like a toggle. Every other one
    /// fires once: a combination as it goes down, a modifier on its own when it comes up untouched.
    private func onShortcut(_ output: ShortcutOutput) {
        var actions: [GestureAction] = []
        switch output {
        case .press("dictation", let flags):
            emit("hotkey.down", ["key": dictationSpec])
            // A recording this press starts is a quick note (T1320); the 2nd tap of a double tap keeps the 1st's.
            nextIsNote = dictationKey?.noteModifierHeld(flags: flags) ?? false
            actions = talk.press(.dictation, at: ProcessInfo.processInfo.systemUptime, otherRecording: recordingTarget == .agent || agentGate.armed)
        case .release("dictation", _):
            emit("hotkey.up", ["key": dictationSpec])
            actions = talk.release(.dictation, at: ProcessInfo.processInfo.systemUptime)
        case .interrupt("dictation", let code):
            // Letting go of ⌥ in a quick note is part of the gesture.
            if nextIsNote, talk.dictation.isRecording, dictationKey?.isNoteModifier(keyCode: code) == true { return }
            // A click is "another key" only for the agent's Control (spec #9876): the dictation doesn't change.
            if code == ShortcutOutput.mouseKeyCode { return }
            actions = talk.interrupt(.dictation)
        case .trigger("dictation"):
            if recordingTarget == .agent { return }
            if audio.isRecording {
                talk.reset(.dictation)
                emit("hotkey.toggle", ["on": false])
                stopRecording(reason: "hotkey", mode: StopMode.toggle.rawValue)
            } else {
                nextIsNote = false
                if startRecording(reason: "hotkey") == nil, audio.isRecording {
                    talk.reset(.dictation, latched: true)
                    emit("hotkey.toggle", ["on": true])
                }
            }
            return
        // Spec #9876: the Control talks to the agent, with the dictation's gesture.
        case .press("agent", _):
            apply(talk.press(.agent, at: ProcessInfo.processInfo.systemUptime, otherRecording: recordingTarget == .dictation), for: .agent)
            scheduleTick()
            return
        case .release("agent", _):
            apply(talk.release(.agent, at: ProcessInfo.processInfo.systemUptime), for: .agent)
            scheduleTick()
            return
        case .interrupt("agent", _):
            apply(talk.interrupt(.agent), for: .agent)
            scheduleTick()
            return
        case .press("cancel", _), .trigger("cancel"):
            cancelFromShortcut()
            return
        case .release("cancel", _):
            return
        case .press(let id, _) where Self.firesOnPress(shortcuts[id]):
            fire(id)
            return
        case .release(let id, clean: true) where !Self.firesOnPress(shortcuts[id]):
            fire(id)
            return
        case .trigger(let id):
            fire(id)
            return
        default:
            return
        }
        apply(actions, for: .dictation)
        scheduleTick()
    }

    /// A combination fires as it goes down; a modifier on its own as it comes up (it may still become ⌥+letter).
    private static func firesOnPress(_ shortcut: Shortcut?) -> Bool {
        if case .combo = shortcut { return true }
        return false
    }

    private func fire(_ id: String) {
        switch id {
        case "notes": emit("hotkey.notes", [:])
        // The app pastes it (it keeps the History): the text never comes back through here.
        case "pasteLast": emit("hotkey.pasteLast", [:])
        case "meeting": meeting.meetingShortcut()
        case "meetingPause": meeting.pauseMineShortcut()
        default: break
        }
    }

    private func applyShortcuts() {
        // A fixed order, so two shortcuts on the same keys always resolve the same way.
        // Spec #9876, #12946: the Kiwi Cat's shortcut is off while the dictation is on the same keys (the app says so in
        // Settings and refuses to save it).
        let agentClashes = Shortcut.shareKeys(shortcuts["agent"] ?? nil, shortcuts["dictation"] ?? nil)
        tap.bindings = ["dictation", "agent", "cancel", "pasteLast", "notes", "meeting", "meetingPause"].compactMap { id in
            guard id != "agent" || !agentClashes else { return nil }
            return shortcuts[id].map { (id: id, shortcut: $0) }
        }
        // L6 (T5457): trocar o atalho para outra tecla devolve a ação do 🌐; voltar para o Fn troca de novo.
        if globeStarted { globe.set(fnIsShortcut: dictationKey == .fn) }
    }

    /// Devolve a ação do 🌐 e sai: o app fechou (o socket, ⌘Q) ou mandou encerrar (SIGTERM). Uma queda fica para a
    /// próxima abertura, que desfaz a troca primeiro.
    private func quit() -> Never {
        globe.restore()
        _ = audio.stop()
        media.end()
        // L3 (T5455): o journal do ditado em curso fecha antes de sair, para a recuperação.
        _ = finishRecovery()
        try? meetings?.capture.stop()
        // T6602: o Metal do transcribe.cpp aborta num assert no fim do processo com um modelo vivo. Sem ele, sai normal;
        // com um ditado em curso segurando o modelo, sai sem os destrutores do C++.
        if !precise.loaded.release() {
            fflush(stdout)
            _exit(0)
        }
        exit(0)
    }

    private func apply(_ actions: [GestureAction], for target: TalkTarget) {
        for action in actions { apply(action, for: target) }
    }

    /// A key's action, for its own recording only: one key never stops or cancels the other's.
    private func apply(_ action: GestureAction, for target: TalkTarget) {
        switch action {
        case .startRecording where target == .agent:
            // Armed only: the mic waits for the hold time or the 2nd tap (#11393).
            run(agentGate.start())
            scheduleAgentConfirm()
        case .latch where target == .agent:
            run(agentGate.latch())
        case .stopRecording(let mode) where target == .agent:
            run(agentGate.stop(mode))
        case .cancelRecording where target == .agent:
            run(agentGate.cancel())
        case .startRecording:
            startRecording(reason: "hotkey", note: nextIsNote)
        case .latch:
            guard recordingTarget == target else { return }
            emit("hotkey.toggle", ["on": true])
        case .stopRecording(let mode):
            guard recordingTarget == target else { return }
            if mode == .toggle, target == .dictation { emit("hotkey.toggle", ["on": false]) }
            stopRecording(reason: "hotkey", mode: mode.rawValue)
        case .cancelRecording:
            guard recordingTarget == target else { return }
            cancelRecording(reason: "hotkey")
        }
    }

    /// What the gate says to do with the agent's mic.
    private func run(_ effects: [AgentMicGate.Effect]) {
        for effect in effects {
            switch effect {
            case .openMic(let latched):
                // Only now the mic opens: then the sound and `agent.listening` (the cat goes to `ouvindo`).
                if startRecording(reason: "hotkey", target: .agent) == nil, recordingTarget == .agent {
                    confirmAgent(latched: latched)
                } else {
                    agentGate.reset()
                }
            case .stopMic(let mode):
                guard recordingTarget == .agent else { continue }
                stopRecording(reason: "hotkey", mode: mode.rawValue)
            case .cancelMic:
                guard recordingTarget == .agent else { continue }
                cancelRecording(reason: "hotkey")
            }
        }
    }

    /// Spec #9876 (#11393): held past the hold time, the Control is a talk to the agent: the mic opens now. A ⌃C or a
    /// tap before that never opened it.
    private func scheduleAgentConfirm() {
        agentConfirmTimer?.cancel()
        guard agentGate.armed else { return }
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            let pressed: Bool
            if case .pressed = self.talk.agent.state { pressed = true } else { pressed = false }
            self.run(self.agentGate.holdPassed(stillPressed: pressed))
        }
        agentConfirmTimer = work
        DispatchQueue.main.asyncAfter(deadline: .now() + talk.agent.holdThreshold, execute: work)
    }

    /// O gato no overlay carregou a página (`catOverlay.load`): só então o nível do mic vai a ela.
    private var catOverlayLoaded = false

    private func catOverlayVoice(_ level: Double?) {
        guard catOverlayLoaded else { return }
        if level != nil, !(recordingTarget == .agent && agentConfirmed) { return }
        let cat = catOverlay
        MainActor.assumeIsolated { cat.voice(level) }
    }

    private func confirmAgent(latched: Bool) {
        agentConfirmTimer?.cancel()
        guard recordingTarget == .agent else { return }
        if !agentConfirmed { cues.playStart() }
        agentConfirmed = true
        emit("agent.listening", ["latched": latched])
    }

    /// L5 (T5458): the cancel shortcut (Esc) during a dictation, like the pill's ✕: the audio is thrown away and
    /// nothing is pasted. A key still held for push-to-talk does nothing when it comes up.
    private func cancelFromShortcut() {
        guard audio.isRecording else {
            // Spec #9876: Esc while the agent's speech is being transcribed: the text that comes is dropped.
            if agentTranscribing, !agentDropped {
                agentDropped = true
                emit("agent.record.cancelled", ["reason": "escape", "phase": "transcribing"])
            }
            return
        }
        _ = talk.ended(recordingTarget ?? .dictation)
        tickTimer?.cancel()
        cancelRecording(reason: "escape")
    }

    /// The pill's ✕ (cancel) or ✓ (finish, like letting go of the key).
    private func endFromOverlay(finish: Bool) {
        guard audio.isRecording else { return }
        let mode = talk.ended(recordingTarget ?? .dictation)
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
        guard let deadline = talk.deadline?.at else { return }
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            for (target, action) in self.talk.tick(now: ProcessInfo.processInfo.systemUptime) { self.apply(action, for: target) }
            self.scheduleTick()
        }
        tickTimer = work
        let delay = max(0, deadline - ProcessInfo.processInfo.systemUptime) + 0.01
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    // MARK: Recording

    private let siteReads = DispatchQueue(label: "kiwi.browser-site", qos: .userInitiated)

    /// L18: o título e o host do navegador em frente, para o tom da limpeza. Só o tempo da leitura vai ao log.
    private func reportSite(_ app: ActiveApp) {
        guard BrowserSite.isBrowser(app.bundleId) else { return }
        siteReads.async { [weak self] in
            let t0 = ProcessInfo.processInfo.systemUptime
            let site = BrowserSiteReader.read(app)
            let ms = Int(((ProcessInfo.processInfo.systemUptime - t0) * 1000).rounded())
            let fields = BrowserSite.siteFields(bundleId: app.bundleId, title: site.title, host: site.host)
            DispatchQueue.main.async {
                self?.emit("log", ["level": "info", "message": "site read: \(ms) ms · \(app.bundleId)"])
                if let fields { self?.emit("record.site", fields) }
            }
        }
    }

    @discardableResult
    private func startRecording(reason: String, note: Bool = false, target: TalkTarget = .dictation) -> String? {
        // Pressed again while the last one is still recording its tail (T5456): that one ends now, with what it has.
        if audio.isFinishing { audio.finishNow() }
        guard !audio.isRecording else { return nil }
        // Spec #9876: the agent's recording has events of its own (`agent.*`), so the dictation never sees it: it's
        // never pasted, never journaled for recovery, never dumped, and the pill doesn't show (the cat does).
        if target == .agent { return startAgentRecording(reason: reason) }
        // Tell the app first, so the overlay shows up while the engine comes up. If the mic then fails,
        // record.error follows record.started (ADR 0001).
        var started: [String: Any] = ["reason": reason]
        if note { started["target"] = "note" }
        recordingTarget = .dictation
        let front = FrontApp.current
        if let app = front { started["app"] = ["bundleId": app.bundleId, "name": app.name] }
        // Which mic (T3229): the app tells the person when the chosen one wasn't connected (`fellBack`).
        // The lid closed (or opened) since the engine was made: `start` makes the new one right away (T3229, #3300).
        let stale = !headless && mic.isStale()
        if stale { audio.inputChanged("mic changed since the warm-up") }
        if let pick = stale ? mic.peek() : mic.last { started["microphone"] = pick.fields }
        beginRecovery(&started)
        // T5833: o som de início antes de tudo: antes de a L8 baixar a mídia e de o mic abrir (#5880, #5897).
        cues.playStart()
        let t0 = ProcessInfo.processInfo.systemUptime
        do {
            try media.startCapture(meetingActive: meeting.isRecording) {
                emit("record.started", started)
                overlay.set(.listening)
                try audio.start()
                // L18: o site do navegador sai do caminho do mic: lido numa fila própria, depois que o mic subiu, e
                // vai num `record.site`, bem antes da transcrição.
                if let app = front { reportSite(app) }
            }
        } catch {
            talk.reset(.dictation)
            recordingTarget = nil
            // A stable code for the app; AVAudioEngine's own errors are long sentences.
            var code = (error as? AudioCaptureError)?.description ?? "engine_start_failed"
            let microphone = Permission.microphone.status
            var fields: [String: Any] = ["reason": reason, "microphone": microphone]
            var busyApp: String?
            if microphone == "granted" {
                // The engine wouldn't start while another app holds the mic (#5154): say which one.
                let busy = MicBusy.classify(code, otherApps: MicDiagnostics.otherApps())
                code = busy.code
                busyApp = busy.app
                if let app = busy.app { fields["busyApp"] = app }
            }
            fields["error"] = code
            if let recovery = finishRecovery() { fields["recovery"] = recovery.fields }
            emit("record.error", fields)
            let shown = microphone == "granted" ? code : microphone == "undetermined" ? "microphone_undetermined" : "microphone_denied"
            overlay.set(.error, message: busyApp.map(MicBusy.message) ?? OverlayText.error(shown))
            return code
        }
        recordingStartedAt = ProcessInfo.processInfo.systemUptime
        // Sound before the engine is up is lost (the first syllable); this shows how long that is.
        let startMs = Int(((recordingStartedAt! - t0) * 1000).rounded())
        emit("log", ["level": "info", "message": "mic: engine started in \(startMs) ms"])
        return nil
    }

    /// The agent's recording (spec #9876): the mic opens at once; the sound and the cat wait for the confirmation.
    private func startAgentRecording(reason: String) -> String? {
        recordingTarget = .agent
        agentConfirmed = false
        agentDropped = false
        // The media (L8) isn't lowered: pausing the music is only for the dictation (#4756).
        do {
            emit("agent.record.started", ["reason": reason])
            try audio.start()
        } catch {
            talk.reset(.agent)
            agentGate.reset()
            recordingTarget = nil
            agentConfirmTimer?.cancel()
            let microphone = Permission.microphone.status
            var code = (error as? AudioCaptureError)?.description ?? "engine_start_failed"
            var fields: [String: Any] = ["reason": reason, "microphone": microphone]
            if microphone == "granted" {
                let busy = MicBusy.classify(code, otherApps: MicDiagnostics.otherApps())
                code = busy.code
                if let app = busy.app { fields["busyApp"] = app }
            }
            fields["error"] = code
            emit("agent.record.error", fields)
            return code
        }
        recordingStartedAt = ProcessInfo.processInfo.systemUptime
        return nil
    }

    private func stopRecording(reason: String, mode: String) {
        guard audio.isRecording, !audio.isFinishing else { return }
        // Let go (or the pill's ✓): the pill says "processing" now, and the mic takes in `releaseTail` more, so the last
        // word isn't cut (T5456, issue #155). `record.stop` from the app ends right away.
        guard reason != "command" else { return finishRecording(audio.stop(), reason: reason, mode: mode) }
        let releasedAt = ProcessInfo.processInfo.systemUptime
        if recordingTarget == .agent {
            // The waves stop the instant the listening ends, before the transcription (spec #9876).
            emit("agent.record.stopping", ["mode": mode])
            catOverlayVoice(nil)
        } else {
            overlay.set(.processing)
        }
        audio.stop(after: AudioCapture.releaseTail) { [weak self] samples in
            self?.finishRecording(samples, reason: reason, mode: mode, releasedAt: releasedAt)
        }
    }

    /// The end of a recording, from the mic or from `debug.transcribe`: `record.stopped`, the pill, the transcript.
    private func finishRecording(_ samples: [Float], reason: String, mode: String, lost: String? = nil, releasedAt: TimeInterval? = nil) {
        if recordingTarget == .agent { return finishAgentRecording(samples, reason: reason, mode: mode, lost: lost, releasedAt: releasedAt) }
        recordingTarget = nil
        media.end()
        // T5833: o mic já fechou e a mídia já voltou (L8): o som de fim. O `debug.transcribe` não grava.
        if reason != "debug" { cues.playEnd() }
        var fields: [String: Any] = [
            "reason": reason,
            "mode": mode,
            "durationMs": Int(Double(samples.count) / AudioCapture.sampleRate * 1000),
            "samples": samples.count,
        ]
        if let lost { fields["lost"] = lost }
        let recovery = finishRecovery()
        if let recovery { fields["recovery"] = recovery.fields }
        let audioPath = dump(samples)
        if let audioPath { fields["audioPath"] = audioPath }
        recordingStartedAt = nil
        emit("record.stopped", fields)
        // The app moves it on with overlay.state done|error. With nothing recorded (the mic prompt was up,
        // or the engine never delivered) there is nothing to transcribe, so no `done` would come: hide now.
        overlay.set(samples.isEmpty ? .hidden : .processing)
        transcribe(samples, durationMs: fields["durationMs"] as! Int, audioPath: audioPath, releasedAt: releasedAt, recovery: recovery)
    }

    /// Spec #9876: the end of the agent's recording. `agent.record.stopped`, then `agent.transcript` with the text, or
    /// nothing when Esc came first. The samples live only in memory: no dump, no journal; the audio is gone after.
    private func finishAgentRecording(_ samples: [Float], reason: String, mode: String, lost: String?, releasedAt: TimeInterval?) {
        recordingTarget = nil
        agentGate.reset()
        agentConfirmTimer?.cancel()
        if agentConfirmed { cues.playEnd() }
        agentConfirmed = false
        let durationMs = Int(Double(samples.count) / AudioCapture.sampleRate * 1000)
        var fields: [String: Any] = ["reason": reason, "mode": mode, "durationMs": durationMs, "samples": samples.count]
        if let lost { fields["lost"] = lost }
        recordingStartedAt = nil
        emit("agent.record.stopped", fields)
        guard !samples.isEmpty else { return }
        let stoppedAt = releasedAt ?? ProcessInfo.processInfo.systemUptime
        agentTranscribing = true
        agentDropped = false
        let previous = sttChain
        sttChain = Task { @MainActor [weak self] in
            await previous?.value
            guard let self else { return }
            defer { self.agentTranscribing = false }
            do {
                let (output, engine) = try await self.recognize(samples)
                // Esc during the transcription: the text is dropped here, and nothing is sent.
                guard !self.agentDropped else { return }
                self.emit("agent.transcript", [
                    "text": output.text, "raw": output.raw, "lang": output.lang, "engine": engine,
                    "durationMs": durationMs, "latencyMs": Int((ProcessInfo.processInfo.systemUptime - stoppedAt) * 1000),
                ])
            } catch {
                guard !self.agentDropped else { return }
                self.emit("agent.transcript.error", ["error": (error as? Transcriber.Failure)?.rawValue ?? Transcriber.Failure.failed.rawValue])
            }
        }
    }

    /// `transcript.final` for a finished recording, or `transcript.error`. `latencyMs` goes from the end of the
    /// recording (the key let go) to the text, waiting behind an earlier transcription included.
    private func transcribe(_ samples: [Float], durationMs: Int, audioPath: String?, releasedAt: TimeInterval? = nil, recovery: RecordingRecovery? = nil) {
        // From the key let go, tail included (T5456): the person waits from there.
        let stoppedAt = releasedAt ?? ProcessInfo.processInfo.systemUptime
        let previous = sttChain
        sttChain = Task { @MainActor [weak self] in
            await previous?.value
            guard let self else { return }
            do {
                let (output, engine) = try await self.recognize(samples)
                var fields: [String: Any] = [
                    "text": output.text,
                    "raw": output.raw,
                    "lang": output.lang,
                    "engine": engine,
                    "durationMs": durationMs,
                    "latencyMs": Int((ProcessInfo.processInfo.systemUptime - stoppedAt) * 1000),
                ]
                if let audioPath { fields["audioPath"] = audioPath }
                if let recovery { fields["recovery"] = recovery.fields }
                self.emit("transcript.final", fields)
                // The model loaded now, after a failed start (offline on the first run, #383).
                if engine == "parakeet" { self.setSTT(.ready) }
            } catch {
                let code = (error as? Transcriber.Failure)?.rawValue ?? Transcriber.Failure.failed.rawValue
                var fields: [String: Any] = ["error": code]
                if let recovery { fields["recovery"] = recovery.fields }
                self.emit("transcript.error", fields)
                if code == Transcriber.Failure.modelUnavailable.rawValue {
                    self.setSTT(.unavailable, ["error": code])
                }
            }
        }
    }

    /// O texto de uma gravação e o motor que o fez (T6602): o Whisper do modo preciso quando ele está carregado e há
    /// pelo menos um segundo de fala (pelo VAD, T7454), e o Parakeet no resto do tempo: numa palavra solta, quando o Whisper falha ou
    /// quando ele devolve o próprio prompt (o ditado nunca se perde por causa dele). Um ditado de mais de 28 s vai ao
    /// Whisper em pedaços, e o Parakeet cobre o pedaço que sair vazio (`PreciseChunks`, #7082).
    private func recognize(_ samples: [Float]) async throws -> (Transcriber.Output, String) {
        // A rota pelo VAD (T7454): um som sem fala (zumbido, bipe) vai ao Parakeet, que não inventa nada nele.
        if preciseReady, PreciseRoute.usesWhisper(samples, sampleRate: AudioCapture.sampleRate, vadSpeechSeconds: await stt.vadSpeechSeconds(samples)) {
            let dictionary = meetingDictionary
            let precise = precise
            let stt = stt
            let raw = await PreciseChunks.transcribe(
                samples, terms: dictionary.terms, sampleRate: AudioCapture.sampleRate,
                whisper: { try await precise.transcribe($0, terms: $1) },
                parakeet: { try await stt.transcribe($0).raw },
                log: { [weak self] in self?.emit("log", ["level": "info", "message": $0]) })
            if let raw {
                let text = TranscriptPostProcessor.process(raw, dictionary: dictionary)
                return (Transcriber.Output(raw: raw, text: text, lang: SpokenLanguage.detect(text)), "whisper")
            }
        }
        return (try await stt.transcribe(samples), "parakeet")
    }

    private func cancelRecording(reason: String) {
        guard audio.isRecording else { return }
        if recordingTarget == .agent {
            // Spec #9876: the audio is thrown away; the sound only if the listening had been confirmed.
            _ = audio.stop()
            agentConfirmTimer?.cancel()
            if agentConfirmed { cues.playEnd() }
            agentGate.reset()
            recordingTarget = nil
            recordingStartedAt = nil
            emit("agent.record.cancelled", ["reason": reason, "listened": agentConfirmed])
            catOverlayVoice(nil)
            agentConfirmed = false
            return
        }
        recordingTarget = nil
        _ = audio.stop()
        media.end()
        cues.playEnd() // T5833: cancelar também termina a gravação, com o mic fechado e a mídia de volta
        if currentRecovery != nil { try? recordingJournal?.cancel() }
        currentRecovery = nil
        recordingStartedAt = nil
        emit("record.cancelled", ["reason": reason])
        overlay.set(.hidden)
    }

    private func beginRecovery(_ started: inout [String: Any]) {
        currentRecovery = nil
        audio.onRetainedSamples = nil
        guard let recordingJournal else { return }
        let app = started["app"] as? [String: String]
        guard let metadata = recordingJournal.beginIfAvailable(app: app?["bundleId"].map { RecordingApp(bundleId: $0, name: app?["name"]) }, target: started["target"] as? String) else { return }
        audio.onRetainedSamples = { [recordingJournal] samples, offset in recordingJournal.append(samples, at: offset) }
        currentRecovery = metadata
        started["recovery"] = metadata.fields
    }

    private func finishRecovery() -> RecordingRecovery? {
        guard let metadata = currentRecovery else { return nil }
        currentRecovery = nil
        do { return try recordingJournal?.finish() }
        catch {
            emit("log", ["level": "warn", "message": "mic: recording_storage"])
            return metadata // keep the readable prefix, never erase it after an I/O failure
        }
    }

    /// Only managed UUIDs; a retry never starts a device or emits a new recording into the dictation FIFO.
    private func retryRecording(_ id: String?, _ message: InboundMessage) {
        guard let recordingJournal, let recordingId = message.string("recordingId"), RecordingJournal.isIdentifier(recordingId) else {
            return reply(id, ok: false, error: "invalid_value")
        }
        guard currentRecovery?.id != recordingId else { return reply(id, ok: false, error: "already_recording") }
        let samples: [Float]
        do {
            let file = try recordingJournal.audioURL(recordingId)
            guard try RecordingJournal.repair(file) > 0 else { return reply(id, ok: false, error: "no_audio") }
            samples = try AudioFile.samples16k(file)
        } catch { return reply(id, ok: false, error: "recovery_unavailable") }
        let previous = sttChain
        let started = ProcessInfo.processInfo.systemUptime
        sttChain = Task { @MainActor [weak self] in
            await previous?.value
            guard let self else { return }
            do {
                let (output, engine) = try await self.recognize(samples)
                self.reply(id, ok: true, ["text": output.text, "raw": output.raw, "lang": output.lang, "engine": engine,
                    "durationMs": Int(Double(samples.count) / AudioCapture.sampleRate * 1000),
                    "latencyMs": Int((ProcessInfo.processInfo.systemUptime - started) * 1000)])
                if engine == "parakeet" { self.setSTT(.ready) }
            } catch {
                let code = (error as? Transcriber.Failure)?.rawValue ?? Transcriber.Failure.failed.rawValue
                self.reply(id, ok: false, error: code)
            }
        }
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
        case "learn.offer":
            // L26: the app found a correction after a paste and asks the person, on the card, before learning it.
            guard let offer = LearnOffer.parse(message.fields) else { return reply(id, ok: false, error: "invalid_value") }
            learnPrompt.offer(offer)
            reply(id, ok: true)
        case "learn.answer":
            // The card's buttons, from the app or a test (headless has no card): `add` or `notNow`.
            guard let name = message.string("answer"), let answer = LearnAnswer(rawValue: name), answer != .expired else {
                return reply(id, ok: false, error: "invalid_value")
            }
            if learnPrompt.answer(answer) { reply(id, ok: true) } else { reply(id, ok: false, error: "no_offer") }
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
            if message.type == "meeting.start" { media.end() }
            do {
                let result = try handleMeeting(message)
                reply(id, ok: result.ok, error: result.error, result.data)
            } catch { reply(id, ok: false, error: "meeting_unavailable") }
        case "dictation.retry":
            retryRecording(id, message)
        case "spelling.check":
            let language = message.string("language")
            guard let word = message.string("word"),
                  message.fields["language"] == nil || language != nil,
                  let result = LocalSpelling.check(word, language: language, using: NativeSpelling.check) else {
                return reply(id, ok: false, error: "invalid_value")
            }
            reply(id, ok: true, result.fields)
        case "ping":
            reply(id, ok: true)
        case "config.set":
            if let error = configure(message) { return reply(id, ok: false, error: error) }
            reply(id, ok: true, ["hotkey": dictationSpec, "hotkeyActive": hotkeyActive, "hotkeyPriority": hotkeyPriority])
        case "shortcut.record":
            // Settings' "aperte o atalho" (T5349): the reply comes when the person has pressed it (or Esc).
            guard !headless, tap.isRunning else { return reply(id, ok: false, error: "hotkey_inactive") }
            if let previous = recordingShortcutId {
                recordingShortcutId = nil
                reply(previous, ok: false, error: "cancelled")
            }
            guard let id else { return }
            recordingShortcutId = id
            if audio.isRecording { cancelRecording(reason: "config") }
            talk.reset(.dictation); talk.reset(.agent)
            // `bareKey`: recording the cancel (L5), where ⌫ or ↩ alone is a shortcut too.
            tap.record(bareKey: message.fields["bareKey"] as? Bool == true)
        case "shortcut.cancel":
            tap.cancelRecording()
            reply(id, ok: true)
        case "record.start" where headless:
            reply(id, ok: false, error: "headless_no_mic") // dictate a WAV with debug.transcribe instead
        case "permissions.request" where headless:
            reply(id, ok: false, error: "headless")
        case "record.start":
            if let error = Rules.recordStart(isRecording: audio.isRecording) { return reply(id, ok: false, error: error) }
            if let error = startRecording(reason: "command") {
                reply(id, ok: false, error: error)
            } else {
                talk.reset(.dictation, latched: true) // a tap on the hotkey ends it, as in toggle mode
                reply(id, ok: true)
            }
        case "record.stop":
            guard recordingTarget != .agent else { return reply(id, ok: false, error: "not_recording") }
            talk.reset(.dictation)
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
        case "catOverlay.load":
            guard let dir = message.string("dir") else { return reply(id, ok: false, error: "invalid_value") }
            let cat = catOverlay
            let error = MainActor.assumeIsolated { cat.load(dir: dir) }
            catOverlayLoaded = error == nil
            reply(id, ok: error == nil, error: error)
        case "catOverlay.show":
            guard let estado = message.string("estado") else { return reply(id, ok: false, error: "invalid_value") }
            let fade = message.double("fadeMs") ?? 180
            let cat = catOverlay
            MainActor.assumeIsolated { cat.show(estado: estado, fadeMs: fade) }
            reply(id, ok: true)
        case "catOverlay.state":
            guard let estado = message.string("estado") else { return reply(id, ok: false, error: "invalid_value") }
            let cat = catOverlay
            MainActor.assumeIsolated { cat.state(estado: estado) }
            reply(id, ok: true)
        case "catOverlay.hide":
            let fade = message.double("fadeMs") ?? 0
            let cat = catOverlay
            MainActor.assumeIsolated { cat.hide(fadeMs: fade) }
            reply(id, ok: true)
        case "catOverlay.color":
            guard let cor = message.string("cor") else { return reply(id, ok: false, error: "invalid_value") }
            let cat = catOverlay
            let ok = MainActor.assumeIsolated { cat.color(cor) }
            reply(id, ok: ok, error: ok ? nil : "invalid_value")
        case "catOverlay.place":
            // A posição e o tamanho (spec #12949): antes do `load`, como a cor.
            let position = message.string("posicao")
            let scale = message.double("escala")
            let cat = catOverlay
            MainActor.assumeIsolated { cat.place(position: position, scale: scale) }
            reply(id, ok: true)
        case "catOverlay.bubble":
            let text = message.string("text")
            let error = message.fields["error"] as? Bool ?? false
            let cat = catOverlay
            MainActor.assumeIsolated { cat.bubble(text: text, error: error) }
            reply(id, ok: true)
        case "catOverlay.unload":
            catOverlayLoaded = false
            let cat = catOverlay
            MainActor.assumeIsolated { cat.unload() }
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
        // The meeting app holds the same mic (#5154): a channel that gives nothing says so (`mic_busy`).
        meetingMic.audio.onLost = { code, _ in failAndStop(MicBusy.classify(code, otherApps: MicDiagnostics.otherApps()).code) }
        meetingMic.audio.onLog = { [weak self] message in self?.emit("log", ["level": "info", "message": "meeting mic: \(message)"]) }
        meetingMic.audio.onDiagnostic = { [weak self, meetingMic] diagnostic in
            DispatchQueue.main.async {
                self?.emit("log", ["level": "info", "message": "meeting mic: " + MicDiagnostics.line(diagnostic, pick: meetingMic.selection.last)])
            }
        }
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
            systemAudio: { [weak self] in
                try LiveMeetingTranscriber.audio(self?.meetings?.capture.pendingChunks().filter { $0.session == session } ?? [])
            },
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
        if type == "meeting.start" { media.end() }
        do { _ = try handleMeeting(message) } catch { emit("meeting.error", ["error": "meeting_unavailable"]) }
    }

    /// T5833: o som de início antes de a reunião começar a gravar (o mic "você" ainda fechado; o canal "sistema" não
    /// ouve o Kiwi), e o de fim depois de ela parar. Pelos dois caminhos: o comando do app e o atalho ou o pop-up.
    private func handleMeeting(_ message: InboundMessage) throws -> MeetingReply {
        let commands = try meetingCommands()
        switch message.type {
        case "meeting.start":
            var result: MeetingReply!
            cues.begin(open: { result = commands.handle(message) })
            return result
        case "meeting.stop":
            let result = commands.handle(message)
            if result.ok { cues.playEnd() }
            return result
        default:
            return commands.handle(message)
        }
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
            started["app"] = BrowserSite.appFields(bundleId: bundleId, name: (app["name"] as? String) ?? bundleId,
                                                   title: app["title"] as? String, host: app["urlHost"] as? String)
        } else if message.fields["app"] != nil {
            return reply(id, ok: false, error: "invalid_value")
        } else if !headless, let app = FrontApp.current {
            started["app"] = ["bundleId": app.bundleId, "name": app.name]
        }
        if let target = message.string("target") {
            // Spec #9876: `target: "agent"` plays a WAV as a talk to the agent through the Control (no mic, no key):
            // the agent's events, the confirmation and the transcription, as with the key held.
            if target == "agent" {
                reply(id, ok: true)
                recordingTarget = .agent
                agentConfirmed = false
                emit("agent.record.started", ["reason": "debug"])
                emit("agent.listening", ["latched": false])
                agentConfirmed = true
                return playAgentDebug(samples)
            }
            guard target == "note" else { return reply(id, ok: false, error: "invalid_value") }
            started["target"] = "note"
        }
        beginRecovery(&started)
        if currentRecovery != nil { recordingJournal?.append(samples, at: 0) }
        reply(id, ok: true)
        emit("record.started", started)
        overlay.set(.listening)
        finishRecording(samples, reason: "debug", mode: "debug")
    }

    /// Spec #9876: the WAV plays in real time, like a key held while talking: its level goes out as `audio.level` (the
    /// waves), at the mic's rate, and then the listening ends and the transcription runs.
    private func playAgentDebug(_ samples: [Float]) {
        var meter = LevelMeter()
        let step = Int(AudioCapture.sampleRate / 30)
        var at = 0
        func tick() {
            guard recordingTarget == .agent else { return } // cancelled meanwhile
            guard at < samples.count else {
                emit("agent.record.stopping", ["mode": "debug"])
                catOverlayVoice(nil)
                return finishAgentRecording(samples, reason: "debug", mode: "debug", lost: nil, releasedAt: nil)
            }
            let end = min(at + step, samples.count)
            for level in meter.push(Array(samples[at..<end])) {
                emit("audio.level", ["rms": (Double(level) * 1000).rounded() / 1000])
                catOverlayVoice(Double(level))
            }
            at = end
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0 / 30, execute: tick)
        }
        tick()
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
        // T5349 (#175): `shortcuts {dictation?, notes?, meeting?, meetingPause?}`, each a shortcut's text or null (off).
        // The fields before it still work: `hotkey`, `notesShortcut`, `meetingShortcut` and `meetingPauseShortcut`.
        var changed: [String: Shortcut?] = [:]
        var legacy: [(String, Any)] = [("notesShortcut", "notes"), ("meetingShortcut", "meeting"), ("meetingPauseShortcut", "meetingPause")]
            .compactMap { field, id in message.fields[field].map { (id, $0) } }
        if let name = message.string("hotkey") {
            guard let key = HotkeyKey(rawValue: name) else { return "unknown_hotkey" }
            changed["dictation"] = .some(.key(key))
        }
        if let value = message.fields["shortcuts"] {
            guard let given = value as? [String: Any] else { return "invalid_value" }
            legacy += given.map { ($0.key, $0.value) }
        }
        for (id, value) in legacy {
            guard Self.shortcutIds.contains(id) else { return "invalid_value" }
            let bareKey = id == "cancel"
            if value is NSNull {
                changed[id] = .some(nil)
            } else {
                guard let text = value as? String, let shortcut = Shortcut(text, bareKey: bareKey) else { return "invalid_value" }
                changed[id] = .some(shortcut)
            }
        }
        if let value = message.fields["meetingSuggest"], !(value is Bool) { return "invalid_value" }
        // T5833: os sons de início e de fim (padrão: ligados).
        if let value = message.fields["cues"], !(value is Bool) { return "invalid_value" }
        if let value = message.fields["agentBusy"], !(value is Bool) { return "invalid_value" }
        if let value = message.fields["meetingApps"], MeetingApps.parse(value) == nil { return "invalid_value" }
        // T6602: `precise`, o caminho do GGUF do Whisper do modo preciso, ou null para desligar.
        if let value = message.fields["precise"], !(value is NSNull), (value as? String)?.isEmpty != false { return "invalid_value" }
        if !changed.isEmpty {
            let dictationChanged = changed["dictation"].map { $0 != shortcuts["dictation"] } ?? false
            // Before the assignment (spec #12946): after it, the new one always equals itself, and a change of the Kiwi
            // Cat's shortcut mid-talk never reset the gesture.
            let agentChanged = changed["agent"].map { $0 != shortcuts["agent"] } ?? false
            for (id, shortcut) in changed { shortcuts[id] = shortcut }
            if dictationChanged || agentChanged {
                talk.reset(.dictation); talk.reset(.agent)
                if audio.isRecording { cancelRecording(reason: "config") }
            }
            applyShortcuts()
        }
        _ = meeting.configure(message.fields)
        if microphone != nil { appKnowsMicrophone = true }
        if let choice = microphone, choice != mic.choice {
            mic.choice = choice
            // A new engine for the new mic; mid-recording it switches and keeps what was captured.
            if !headless { audio.inputChanged("microphone: \(choice.value)") }
            meetingMic.selection.choice = choice
            if meetings?.capture.session != nil, !headless { meetingMic.audio.inputChanged("microphone: \(choice.value)") }
        }
        if let on = message.fields["cues"] as? Bool { cues.enabled = on }
        if let value = message.fields["precise"] { setPrecise(value as? String) }
        talk.setTimings(holdThreshold: hold.map { $0 / 1000 }, doubleTapWindow: doubleTap.map { $0 / 1000 })
        if hold != nil || doubleTap != nil { tap.timings = (doubleTap: talk.dictation.doubleTapWindow, tap: talk.dictation.holdThreshold) }
        // Spec #9876: the agent is busy with a request: the Control doesn't start listening.
        if let busy = message.fields["agentBusy"] as? Bool { agentBusy = busy }
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

    /// Carrega (ou troca) o Whisper do modo preciso, ou solta o modelo com `nil`, e diz no `stt.precise`. Quem estava
    /// ditando enquanto isso segue pelo Parakeet.
    private func setPrecise(_ path: String?) {
        if path == nil { preciseReady = false }
        let previous = preciseChain
        preciseChain = Task { @MainActor [precise, weak self] in
            await previous?.value
            guard let path else {
                await precise.unload()
                self?.emit("stt.precise", ["state": "off"])
                return
            }
            self?.emit("stt.precise", ["state": "loading"])
            let started = ProcessInfo.processInfo.systemUptime
            do {
                try await precise.load(path: path)
                self?.preciseReady = true
                self?.emit("stt.precise", ["state": "ready", "loadMs": Int((ProcessInfo.processInfo.systemUptime - started) * 1000)])
            } catch {
                await precise.unload()
                self?.preciseReady = false
                self?.emit("stt.precise", ["state": "unavailable"])
            }
        }
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
        let key = Permission.inputMonitoring.rawValue, ax = Permission.accessibility.rawValue
        // A tap made before the Input Monitoring grant stays filtered; make a new one. Accessibility given or taken
        // away turns the tap's priority on or off (T5349): a new one too.
        if (now[key] == "granted" && lastPermissions[key] != "granted") || (now[ax] == "granted") != (lastPermissions[ax] == "granted") {
            tap.stop()
            if !headless { tap.start() }
        }
        let mic = Permission.microphone.rawValue
        if now[mic] == "granted", lastPermissions[mic] != "granted", !headless { audio.warmUp() }
        lastPermissions = now
        emit("permissions.changed", ["permissions": now, "hotkeyActive": hotkeyActive, "hotkeyPriority": hotkeyPriority, "llm": llmStatus])
    }

    private static func key(_ status: [String: Any]) -> String {
        "\(status["available"] ?? false)|\(status["reason"] ?? "")"
    }

    /// The tap exists and macOS actually delivers key events to it (a listen-only tap is created
    /// even without Input Monitoring, but receives nothing).
    private var hotkeyActive: Bool {
        tap.isRunning && (tap.hasPriority || Permission.inputMonitoring.status == "granted")
    }

    /// The shortcuts are Kiwi's: the tap drops them, so the app in front doesn't get them too (T5349). False
    /// without Accessibility: they still work, but the other app also sees the keystroke.
    private var hotkeyPriority: Bool { hotkeyActive && tap.hasPriority }

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
