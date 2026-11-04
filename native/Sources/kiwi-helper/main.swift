import AppKit
import Foundation
import KiwiHelperCore

let usage = """
usage: kiwi-helper --socket <path> [--dump-wav <dir>]
       kiwi-helper --stdio [--dump-wav <dir>]
       kiwi-helper --transcribe <file.wav>… [--dictionary <file>] [--language auto|pt|en] [--vad] [--ctc]

  --socket <path>   connect to the app's unix socket (the app listens; NDJSON v1, see docs/adr/0001-ipc.md)
  --stdio           talk NDJSON over stdin/stdout instead, for manual testing
  --headless        for the agents' CLI (T1739): no hotkey tap, no pill, no mic, no permission asks, dry-run inserts
  --dump-wav <dir>  also save each recording as 16 kHz WAV there (for the STT benchmark; never inside the repo)
  --overlay-snapshot <dir>  render the dictation pill in each state as PNGs there, then exit
  --transcribe      transcribe 16 kHz mono WAV files the way a dictation is, one JSON line each, and exit
                    (--dictionary: one term per line; --ctc: also the CTC rescoring, on in the app since
                    T1973; downloads the model the first time and waits for it)
"""

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("kiwi-helper: \(message)\n".utf8))
    exit(2)
}

var socketPath: String?
var useStdio = false
var headless = ProcessInfo.processInfo.environment["KIWI_HEADLESS"] == "1"
var dumpDirectory: URL?
var transcribeFiles: [String] = []
var dictionaryFile: String?
var language = TranscriptionLanguage.auto
var useVAD = false
var useCTC = false
var args = CommandLine.arguments.dropFirst().makeIterator()
while let arg = args.next() {
    switch arg {
    case "--socket":
        guard let path = args.next() else { fail("--socket needs a path") }
        socketPath = path
    case "--stdio": useStdio = true
    case "--headless": headless = true
    case "--dump-wav":
        guard let path = args.next() else { fail("--dump-wav needs a folder") }
        let dir = URL(fileURLWithPath: path, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
        } catch {
            fail("can't create \(dir.path): \(error)")
        }
        dumpDirectory = dir
    case "--overlay-snapshot":
        guard let path = args.next() else { fail("--overlay-snapshot needs a folder") }
        let dir = URL(fileURLWithPath: path, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try MainActor.assumeIsolated { try OverlaySnapshots.write(to: dir) }
        } catch {
            fail("can't write snapshots to \(dir.path): \(error)")
        }
        print("wrote overlay snapshots to \(dir.path)")
        exit(0)
    case "--transcribe":
        guard let path = args.next() else { fail("--transcribe needs a file") }
        transcribeFiles.append(path)
    case "--dictionary":
        guard let path = args.next() else { fail("--dictionary needs a file") }
        dictionaryFile = path
    case "--language":
        guard let name = args.next(), let value = TranscriptionLanguage(rawValue: name) else { fail("--language auto|pt|en") }
        language = value
    case "--vad": useVAD = true
    case "--ctc": useCTC = true
    case _ where !arg.hasPrefix("-") && !transcribeFiles.isEmpty:
        transcribeFiles.append(arg)
    case "-h", "--help":
        print(usage)
        exit(0)
    default:
        fail("unknown option \(arg)\n\(usage)")
    }
}

if !transcribeFiles.isEmpty {
    let files = transcribeFiles, dictionary = dictionaryFile, lang = language, vad = useVAD, ctc = useCTC
    Task {
        exit(await TranscribeFiles.run(files, dictionaryFile: dictionary, language: lang, vad: vad, ctc: ctc))
    }
    CFRunLoopRun()
}

let connection: SocketConnection
if let socketPath {
    do {
        connection = try SocketConnection.connect(path: socketPath)
    } catch {
        fail("can't connect to \(socketPath): \(error)")
    }
} else if useStdio {
    connection = SocketConnection(fd: STDIN_FILENO, writeFD: STDOUT_FILENO)
} else {
    fail(usage)
}

// AppKit for the overlay panel. Accessory: no Dock icon, no menu bar, never activates by itself.
let app = NSApplication.shared
// Headless (T1739): prohibited, so it never shows anything on screen.
app.setActivationPolicy(headless ? .prohibited : .accessory)

let helper = Helper(connection: connection, dumpDirectory: dumpDirectory, headless: headless)
helper.run()
app.run()
