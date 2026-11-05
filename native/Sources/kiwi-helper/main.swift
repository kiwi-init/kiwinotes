import AppKit
import Foundation
import KiwiExport
import KiwiHelperCore

let usage = """
usage: kiwi-helper --socket <path> [--dump-wav <dir>]
       kiwi-helper --stdio [--dump-wav <dir>]
       kiwi-helper --transcribe <file.wav>… [--dictionary <file>] [--language auto|pt|en] [--vad] [--ctc]
       kiwi-helper --meeting <file.wav> [--asr stream|batch|none] [--diarizer sortformer|lseend|vbx|none] [--realtime]

  --socket <path>   connect to the app's unix socket (the app listens; NDJSON v1, see docs/adr/0001-ipc.md)
  --stdio           talk NDJSON over stdin/stdout instead, for manual testing
  --headless        for the agents' CLI (T1739): no hotkey tap, no pill, no mic, no permission asks, dry-run inserts
  --dump-wav <dir>  also save each recording as 16 kHz WAV there (for the STT benchmark; never inside the repo)
  --overlay-snapshot <dir>  render the dictation pill and the meeting panel in each state as PNGs there, then exit
  --mic-users       print the processes taking mic input now, as JSON, and exit (R2): reads CoreAudio's process
                    list only, never opens the mic and asks for no permission
  --ocr <file>…     read the text in images and PDFs with Vision and PDFKit (T2709), one JSON line each, and exit;
                    no session, no mic, no permission asks (for the app's OCR queue, which runs it at background priority)
  --export-pdf <in.html> <out.pdf>  print a note's HTML to PDF in an off-screen WebKit view (T2684), then exit;
                    no window, no network, no permission asks
  --transcribe      transcribe 16 kHz mono WAV files the way a dictation is, one JSON line each, and exit
                    (--dictionary: one term per line; --ctc: also the CTC rescoring, on in the app since
                    T1973; downloads the model the first time and waits for it)
  --meeting-live <file.wav> [--realtime] [--output speaker|headphones]  the R3 pipeline as the app runs it (two
                    streaming ASRs, live Sortformer, echo filter, VBx at the end) over a 2-channel WAV, as `score.ts`
                    lines (T4943). No mic, no sound, no spool.
  --meeting         measure the meeting pipeline (T4926, spec #4823) on a 2-channel 16 kHz WAV (0 = you, 1 = the
                    others): streaming or batch ASR per channel and diarization of channel 1, JSON lines, and exit.
                    No mic, no sound. --realtime feeds the stream at real-time pace, for the true lag.
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
var ocrFiles: [String] = []
var exportPDF: (String, String)?
var dictionaryFile: String?
var language = TranscriptionLanguage.auto
var useVAD = false
var useCTC = false
var meeting: MeetingBench.Options?
var meetingLive: MeetingLiveRun.Options?
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
            try MainActor.assumeIsolated {
                try OverlaySnapshots.write(to: dir)
                try MeetingSnapshots.write(to: dir)
            }
        } catch {
            fail("can't write snapshots to \(dir.path): \(error)")
        }
        print("wrote overlay snapshots to \(dir.path)")
        exit(0)
    case "--mic-users":
        guard let users = MicListener.readOnce() else { fail("can't read CoreAudio's process list (macOS 14.2+)") }
        let apps = MeetingApps()
        let list = users.sorted { $0.pid < $1.pid }.map { user -> [String: Any] in
            var fields: [String: Any] = ["pid": Int(user.pid), "bundleId": user.bundleId]
            if let app = apps.match(user.bundleId) { fields["meeting"] = app.name }
            return fields
        }
        let data = try! JSONSerialization.data(withJSONObject: list, options: [.sortedKeys])
        print(String(decoding: data, as: UTF8.self))
        exit(0)
    case "--export-pdf":
        guard let input = args.next(), let output = args.next() else { fail("--export-pdf needs <in.html> <out.pdf>") }
        exportPDF = (input, output)
    case "--ocr":
        guard let path = args.next() else { fail("--ocr needs a file") }
        ocrFiles.append(path)
    case _ where !arg.hasPrefix("-") && !ocrFiles.isEmpty:
        ocrFiles.append(arg)
    case "--transcribe":
        guard let path = args.next() else { fail("--transcribe needs a file") }
        transcribeFiles.append(path)
    case "--dictionary":
        guard let path = args.next() else { fail("--dictionary needs a file") }
        dictionaryFile = path
    case "--language":
        guard let name = args.next(), let value = TranscriptionLanguage(rawValue: name) else { fail("--language auto|pt|en") }
        language = value
    case "--meeting":
        guard let path = args.next() else { fail("--meeting needs a file") }
        meeting = MeetingBench.Options(path: path)
    case "--asr":
        guard let v = args.next(), let mode = MeetingBench.ASRMode(rawValue: v), meeting != nil else { fail("--asr stream|batch|none, after --meeting") }
        meeting?.asr = mode
    case "--diarizer":
        guard let v = args.next(), let kind = MeetingBench.DiarizerKind(rawValue: v), meeting != nil else { fail("--diarizer sortformer|lseend|vbx|none, after --meeting") }
        meeting?.diarizer = kind
    case "--meeting-live":
        guard let path = args.next() else { fail("--meeting-live needs a file") }
        meetingLive = MeetingLiveRun.Options(path: path)
    case "--output":
        guard let v = args.next(), ["speaker", "headphones", "unknown"].contains(v), meetingLive != nil else { fail("--output speaker|headphones, after --meeting-live") }
        meetingLive?.output = v
    case "--realtime":
        meeting?.realtime = true
        meetingLive?.realtime = true
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

if !ocrFiles.isEmpty {
    exit(OCRFiles.run(ocrFiles))
}

if let (input, output) = exportPDF {
    // Um app sem Dock nem janela: o WebKit precisa do run loop do AppKit, nada mais (T2684).
    NSApplication.shared.setActivationPolicy(.prohibited)
    Task { @MainActor in
        do {
            let data = try await PDFExport.render(htmlFile: URL(fileURLWithPath: input))
            try data.write(to: URL(fileURLWithPath: output), options: .withoutOverwriting)
            exit(0)
        } catch {
            FileHandle.standardError.write(Data("kiwi-helper: export-pdf: \(error)\n".utf8))
            exit(1)
        }
    }
    NSApplication.shared.run()
}

if let meeting {
    Task { exit(await MeetingBench.run(meeting)) }
    CFRunLoopRun()
}

if let meetingLive {
    Task { exit(await MeetingLiveRun.run(meetingLive)) }
    CFRunLoopRun()
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

let meetingDirectory = socketPath.map { URL(fileURLWithPath: $0).deletingLastPathComponent().appendingPathComponent("meeting-buffer", isDirectory: true) }
let helper = Helper(connection: connection, dumpDirectory: dumpDirectory, headless: headless, meetingDirectory: meetingDirectory)
helper.run()
app.run()
