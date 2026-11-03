import AppKit
import Foundation
import KiwiHelperCore

let usage = """
usage: kiwi-helper --socket <path> [--dump-wav <dir>]
       kiwi-helper --stdio [--dump-wav <dir>]

  --socket <path>   connect to the app's unix socket (the app listens; NDJSON v1, see docs/adr/0001-ipc.md)
  --stdio           talk NDJSON over stdin/stdout instead, for manual testing
  --dump-wav <dir>  also save each recording as 16 kHz WAV there (for the STT benchmark; never inside the repo)
  --overlay-snapshot <dir>  render the dictation pill in each state as PNGs there, then exit
"""

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("kiwi-helper: \(message)\n".utf8))
    exit(2)
}

var socketPath: String?
var useStdio = false
var dumpDirectory: URL?
var args = CommandLine.arguments.dropFirst().makeIterator()
while let arg = args.next() {
    switch arg {
    case "--socket":
        guard let path = args.next() else { fail("--socket needs a path") }
        socketPath = path
    case "--stdio": useStdio = true
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
    case "-h", "--help":
        print(usage)
        exit(0)
    default:
        fail("unknown option \(arg)\n\(usage)")
    }
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
app.setActivationPolicy(.accessory)

let helper = Helper(connection: connection, dumpDirectory: dumpDirectory)
helper.run()
app.run()
