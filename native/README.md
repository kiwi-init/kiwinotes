# native: the Swift helper (sidecar)

`kiwi-helper` handles the parts of dictation that need macOS APIs: the global hotkey, the microphone and the permissions. Later tasks add speech-to-text (T51), text insertion (T55), the overlay and notifications. The Bun app listens on a unix socket and starts the helper with `--socket <path>`. They talk NDJSON v1; the contract is in `docs/adr/0001-ipc.md` and `app/src/shared/ipc.ts`.

```sh
swift build              # .build/debug/kiwi-helper and kiwi-ipc-probe
swift test               # pure logic: gestures, IPC framing, socket, levels, WAV
swift run kiwi-ipc-probe # plays the app: listens, starts the helper, prints what arrives
```

In the probe, type commands as single lines, for example `{"type":"record.start","id":"1"}`. Pass `-- --dump-wav ~/kiwi-dumps` to also save each recording as a 16 kHz WAV. That folder must be outside the repo, because audio is never committed.

## Hotkey
- **Hold** the key to talk (push-to-talk). **Double tap** it to lock recording on, and tap again to stop.
- A single short tap, or using the key as a modifier (Fn+F5, ⌥+letter), cancels the recording and discards the audio.
- Recording starts on key down, before the gesture is known, so the first syllable isn't lost.
- Defaults: Fn/🌐; also `rightOption`, `rightCommand` and `rightControl` (set with `config.set {hotkey}`). Hold is 250 ms (`holdThresholdMs`) and the double-tap window is 350 ms (`doubleTapMs`).
- For Fn: set **System Settings → Keyboard → "Press 🌐 key to" → Do Nothing**, otherwise macOS opens the emoji picker or its own dictation.

## Events (helper → app)
`ready`, `hotkey.down|up|toggle`, `record.started {reason}`, `record.stopped {reason, mode, durationMs, samples, audioPath?}`, `record.cancelled {reason}`, `record.error {error, microphone}`, `audio.level {level 0..1}` (~30 Hz while recording), `permissions.changed`, `log`.

## Commands (app → helper)
`ping`, `config.set`, `record.start`, `record.stop`, `permissions.request {permission}`. `insert.text`, `overlay.state`, `notify` and `llm.complete` return `not_implemented` until their tasks land.

## Permissions
| Permission | Why | Checked with |
|---|---|---|
| Microphone | recording | `AVCaptureDevice` (prompt comes from `NSMicrophoneUsageDescription`, embedded in the binary) |
| Input Monitoring | seeing the hotkey in any app (listen-only event tap; it never changes or blocks keys) | `CGPreflightListenEventAccess` |
| Accessibility | pasting the text (T55) | `AXIsProcessTrusted` |

macOS grants these to the *responsible* process: the Kiwi Notes app when it starts the helper, or your terminal when you run it by hand. `ready` and `permissions.changed` carry the status of each permission plus a one-line explanation the onboarding can show. The helper checks every 2 s and recreates the event tap once Input Monitoring is granted.
