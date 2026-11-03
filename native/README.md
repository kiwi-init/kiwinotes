# native: the Swift helper (sidecar)

`kiwi-helper` handles the parts of dictation that need macOS APIs: the global hotkey, the microphone and the permissions. It also turns each recording into text (T256), shows the dictation pill (T56) and pastes the text (T55); notifications come later. The Bun app listens on a unix socket and starts the helper with `--socket <path>`. They talk NDJSON v1; the contract is in `docs/adr/0001-ipc.md` and `app/src/shared/ipc.ts`.

```sh
swift build              # .build/debug/kiwi-helper and kiwi-ipc-probe
swift test               # pure logic: gestures, IPC framing, socket, levels, WAV
swift run kiwi-ipc-probe # plays the app: listens, starts the helper, prints what arrives
swift run kiwi-helper --transcribe a.wav b.wav --dictionary terms.txt   # the STT on files, one JSON line each
```

The probe prints each line after the ms since it started, so you can read latencies off it (`hotkey.down` → first `audio.level`). In the probe, type commands as single lines, for example `{"type":"record.start","id":"1"}`. Pass `-- --dump-wav ~/kiwi-dumps` to also save each recording as a 16 kHz WAV. That folder must be outside the repo, because audio is never committed.

## Speech to text (T256, ADR 0003 and 0004)
The local engine from VoiceInk (`19546d2`), ported with the origin at the top of each file:
1. **Model:** Parakeet TDT 0.6B Ultra through FluidAudio 0.18.2 on the Neural Engine. The first start downloads it from Hugging Face (~600 MB). That download is the only network access; audio and text never leave the Mac. At start the helper loads it and runs one inference, so the first dictation doesn't pay for it; `stt.status` goes `loading` → `ready` (the first load can take a minute while CoreML compiles the model).
2. **Optional VAD** (`config.set {vad: true}`, Silero, threshold 0.7): only speech goes to the model, and audio without speech gives `text: ""`.
3. **Language hint** (`config.set {language}`): passed to Parakeet as VoiceInk does. T51 measured no change for PT and EN (it filters by script).
4. **CTC vocabulary boosting: off.** It swapped real words for dictionary terms ("cluster de homologação" → "DICOM", review #335). With a guard that only lets through changes that sound like the term (`VocabularyRescoreGuard`), it gained 0.1 point of WER over step 5 alone on the T51 clips, for 150–250 ms more per sentence. `--transcribe … --ctc` still measures it.
5. **VoiceInk's post-processing, in its order:** `TranscriptionOutputFilter` (`[noise]`, `(laughs)`, tags) → `PhoneticVocabularyMatcher` (the dictionary's spellings: "pulo recueste" → "pull request", plus "cubectl" → "kubectl" since the first letter may be c, k or q for the same K sound; the aliases too, so "Daikon Stor" lands on the alias "Daikon Store"; T591) → word replacements (the dictionary's `aliases` become the term).
6. **`transcript.final {text, raw, lang, durationMs, latencyMs}`:** one per `record.stopped`, in order. `lang` comes from `NLLanguageRecognizer` (`pt`, `en` or `mix`). If the model can't load, the event is `transcript.error {error}`.

On the T51 clips, a short sentence takes ~80 to 150 ms from the end of the recording to the text, with the dictionary.

## Hotkey
- **Hold** the key to talk (push-to-talk). **Double tap** it to lock recording on, and tap again to stop.
- A single short tap, or using the key as a modifier (Fn+F5, ⌥+letter), cancels the recording and discards the audio.
- Recording starts on key down, before the gesture is known, so the first syllable isn't lost.
- Defaults: Fn/🌐; also `rightOption`, `rightCommand` and `rightControl` (set with `config.set {hotkey}`; hold and double tap share that one key). Hold is 250 ms (`holdThresholdMs`) and the double-tap window is 350 ms (`doubleTapMs`).
- For Fn: set **System Settings → Keyboard → "Press 🌐 key to" → Do Nothing**, otherwise macOS opens the emoji picker or its own dictation.

## Events (helper → app)
`ready`, `hotkey.down|up`, `hotkey.toggle {on}`, `record.started {reason, app?}`, `record.stopped {reason, mode, durationMs, samples, audioPath?}`, `record.cancelled {reason}`, `record.error {error, microphone}` (also `device_changed`, the new input wouldn't start, and `no_audio`, no buffers for ~1 s even after a new engine; may follow `record.started`, which goes out before the mic is up), `audio.level {rms 0..1}` (dBFS scaled from -60 to 0) (~30 Hz while recording), `transcript.final {text, raw, lang, durationMs, latencyMs, audioPath?}`, `transcript.error {error}`, `stt.status {state, loadMs?}`, `app.active {bundleId, name, pid}` (the app in front, not Kiwi itself; for the cleanup's tone), `permissions.changed`, `log`.

## Commands (app → helper)
`ping`, `config.set {hotkey?, holdThresholdMs?, doubleTapMs?, language?, dictionary?, vad?}`, `record.start`, `record.stop`, `permissions.request {permission}`, `insert.text {text, restoreClipboard, dryRun?}` (`dryRun`: touches nothing, for agents' tests), `llm.prewarm {system}` and `llm.complete {system, prompt, maxTokens?, temperature?, timeoutMs?}` (Apple Foundation Models, on-device only, fresh session per call; `ready` says `llm: {available, reason?}`). `overlay.state {state, message?}` drives the dictation pill (ADR 0005); its ✕ and ✓ end a recording with `reason: "overlay"`. `kiwi-helper --overlay-snapshot <dir>` renders it in each state as PNGs. `notify` returns `not_implemented` until its task lands. With `KIWI_DEBUG=1` there is also `debug.transcribe {path}`: an audio file (synthetic, from `say`) takes the path of a finished recording, so the app can be tested end to end without the mic.

## Inserting text (`insert.text`)
- Pastes with ⌘V in every app (Cocoa, Electron, terminals, browsers). Typing through Accessibility (`AXSelectedText`) is ignored by Electron and terminals, so it isn't used.
- The ⌘V goes 200 ms after the text is on the clipboard, as ⌘↓ V↓ V↑ ⌘↑ from a private event source (VoiceInk's `CursorPaster`). The person's clipboard (every item, every type) goes back 2 s after the paste, unless they copied something new meanwhile; Electron apps such as Teams read the pasteboard late. Back-to-back dictations paste in order, and the clipboard that comes back is the one from before the first. The dictation is marked transient, so clipboard managers skip it.
- ⌘V uses the key that types "v" in the current layout (Dvorak, etc.) and only the ⌘ flag.
- No focused element, a focused button, or no Accessibility: `pasted: false` with a `reason`, and the text stays on the clipboard.
- Secure Event Input on (password field, Terminal's Secure Keyboard Entry; the flag is global): ⌘V goes anyway, since macOS may or may not drop it, but the text stays on the clipboard and the old one doesn't come back (`restored: false, reason: "secure_input"`).
- Accessibility calls time out after 250 ms (the default is ~6 s on the main thread). An app that doesn't answer in time gets the paste.
- In the probe, `:insert some text` waits 3 s (click into another app) and sends `insert.text`.

## Permissions
| Permission | Why | Checked with |
|---|---|---|
| Microphone | recording | `AVCaptureDevice` (prompt comes from `NSMicrophoneUsageDescription`, embedded in the binary) |
| Input Monitoring | seeing the hotkey in any app (listen-only event tap; it never changes or blocks keys) | `CGPreflightListenEventAccess` |
| Accessibility | pasting the text (T55) | `AXIsProcessTrusted` |

macOS grants these to the *responsible* process: the Kiwi Notes app when it starts the helper, or your terminal when you run it by hand. `ready` and `permissions.changed` carry the status of each permission plus a one-line explanation the onboarding can show. The helper checks every 2 s and recreates the event tap once Input Monitoring is granted.
