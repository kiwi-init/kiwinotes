import Foundation
import KiwiHelperCore

// Plays the Bun side of the IPC: listens on a socket, starts kiwi-helper with --socket,
// prints every line it sends, and forwards lines typed on stdin as commands.
//
//   swift run kiwi-ipc-probe [--helper <path to kiwi-helper>] [--socket <path>] [-- extra helper args]

var helperPath: String?
var socketPath = NSTemporaryDirectory() + "kiwi-probe-\(getpid()).sock"
var extra: [String] = []
var args = CommandLine.arguments.dropFirst().makeIterator()
while let arg = args.next() {
    switch arg {
    case "--helper": helperPath = args.next()
    case "--socket": socketPath = args.next() ?? socketPath
    case "--": while let rest = args.next() { extra.append(rest) }
    default:
        FileHandle.standardError.write(Data("kiwi-ipc-probe: unknown option \(arg)\n".utf8))
        exit(2)
    }
}
let binary = helperPath ?? URL(fileURLWithPath: CommandLine.arguments[0])
    .deletingLastPathComponent().appendingPathComponent("kiwi-helper").path

let listener: SocketListener
do {
    listener = try SocketListener(path: socketPath)
} catch {
    FileHandle.standardError.write(Data("kiwi-ipc-probe: \(error)\n".utf8))
    exit(1)
}

let process = Process()
process.executableURL = URL(fileURLWithPath: binary)
process.arguments = ["--socket", socketPath] + extra
do {
    try process.run()
} catch {
    FileHandle.standardError.write(Data("kiwi-ipc-probe: can't start \(binary): \(error)\n".utf8))
    exit(1)
}
FileHandle.standardError.write(Data("listening on \(socketPath), helper pid \(process.processIdentifier). Type NDJSON commands, e.g. {\"type\":\"ping\",\"id\":\"1\"}\n".utf8))

// Each line is printed with the ms since the probe started, to measure latencies by eye
// (hotkey.down → first audio.level, and the audio.level rate).
let probeStart = ProcessInfo.processInfo.systemUptime
func stamp() -> String {
    String(format: "%7.0f ms  ", (ProcessInfo.processInfo.systemUptime - probeStart) * 1000)
}

let connection = try listener.accept()
connection.onMessage = { message in
    let data = (try? JSONSerialization.data(withJSONObject: message.fields, options: [.sortedKeys, .withoutEscapingSlashes])) ?? Data()
    print(stamp() + String(decoding: data, as: UTF8.self))
    fflush(stdout)
}
connection.onBadLine = { print("bad line: \($0)") }
connection.onClose = {
    print("helper closed the connection")
    exit(0)
}
connection.start()

signal(SIGINT, SIG_IGN)
let sigint = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
sigint.setEventHandler {
    connection.close() // the helper sees EOF and exits on its own
    process.waitUntilExit()
    exit(0)
}
sigint.resume()

DispatchQueue.global().async {
    while let line = readLine() {
        guard !line.isEmpty else { continue }
        connection.send(Data((line + "\n").utf8))
    }
    connection.close()
}
dispatchMain()
