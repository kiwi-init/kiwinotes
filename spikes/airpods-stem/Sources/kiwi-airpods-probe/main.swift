// Protótipo da T3245: o Mac recebe o "segurar" da haste do AirPods? Quem roda é o jow, com o AirPods dele conectado:
// pede a permissão de Bluetooth (para o Terminal) na primeira vez. Não grava nada e não liga o microfone: só escuta a
// haste e escreve "começaria"/"pararia". No fim, devolve o 0x39 (Raw Gestures) ao valor de antes.

import AirPodsStem
import Foundation
import IOBluetooth

let usage = """
    kiwi-airpods-probe: escuta o segurar da haste do AirPods (T3245). Não grava e não liga o microfone.

      --device TEXTO   o AirPods conectado cujo nome tem TEXTO (padrão: "AirPods")
      --seconds N      quanto tempo escuta (padrão: 120); Ctrl-C para antes
      --raw            escreve cada pacote em hex (pode ter o número de série do fone: não cole no canal)
      --help           isto, sem tocar no Bluetooth

    Durante o teste: segure a haste (começa), solte, segure de novo (para). Faça também um toque e um toque duplo.
    """

struct Options {
    var device = "AirPods"
    var seconds = 120.0
    var raw = false
}

func parseOptions(_ args: [String]) -> Options? {
    var o = Options()
    var i = 0
    while i < args.count {
        switch args[i] {
        case "--device" where i + 1 < args.count: o.device = args[i + 1]; i += 1
        case "--seconds" where i + 1 < args.count:
            guard let s = Double(args[i + 1]), s > 0 else { return nil }
            o.seconds = s; i += 1
        case "--raw": o.raw = true
        default: return nil
        }
        i += 1
    }
    return o
}

let args = Array(CommandLine.arguments.dropFirst())
if args.contains("--help") || args.contains("-h") {
    print(usage)
    exit(0)
}
guard let options = parseOptions(args) else {
    FileHandle.standardError.write(Data((usage + "\n").utf8))
    exit(64)
}

func hex(_ r: IOReturn) -> String { String(format: "0x%08x", UInt32(bitPattern: r)) }
func hex(_ b: [UInt8]) -> String { b.map { String(format: "%02x", $0) }.joined(separator: " ") }
let clockStart = ProcessInfo.processInfo.systemUptime
func now() -> Double { ProcessInfo.processInfo.systemUptime }
func say(_ s: String) { print(String(format: "[%6.1fs] ", now() - clockStart) + s); fflush(stdout) }

final class Probe: NSObject, IOBluetoothL2CAPChannelDelegate {
    let options: Options
    var channel: IOBluetoothL2CAPChannel?
    var toggle = StemToggle()
    var handshakeAck = false
    var gesturesBefore: UInt8?
    var gesturesSet = false
    var gesturesAck: UInt8?
    var stems: [StemPress: Int] = [:]
    var others: [String: Int] = [:]
    var finishing = false

    init(options: Options) { self.options = options }

    func send(_ bytes: [UInt8], _ what: String) {
        guard let channel else { return }
        var b = bytes
        let r = b.withUnsafeMutableBytes { channel.writeSync($0.baseAddress, length: UInt16($0.count)) }
        say(r == kIOReturnSuccess ? "→ \(what)" : "→ \(what): falhou (\(hex(r)))")
    }

    func l2capChannelData(_ l2capChannel: IOBluetoothL2CAPChannel!, data dataPointer: UnsafeMutableRawPointer!, length dataLength: Int) {
        let bytes = Array(UnsafeRawBufferPointer(start: dataPointer, count: dataLength))
        if options.raw { say("← \(hex(bytes))") }
        switch AAP.parse(bytes) {
        case .handshakeAck:
            if !handshakeAck { say("← o fone respondeu ao handshake") }
            handshakeAck = true
        case .stem(let press, let bud):
            stems[press, default: 0] += 1
            say("← HASTE: \(press)\(bud.map { " (\($0))" } ?? "")")
            switch toggle.feed(press, at: now()) {
            case .start?: say("   ▶ aqui o Kiwi COMEÇARIA a ditar")
            case .stop?: say("   ■ aqui o Kiwi PARARIA e colaria")
            case nil: if press == .long { say("   (o mesmo gesto, ignorado)") }
            }
        case .control(let id, let value) where id == AAP.rawGestures:
            if gesturesSet { gesturesAck = value } else { gesturesBefore = value }
            say("← 0x39 (Raw Gestures) = \(String(format: "0x%02x", value))")
        case .control(let id, _):
            others[String(format: "control 0x%02x", id), default: 0] += 1
        case .other(let opcode, _):
            others[opcode.map { String(format: "opcode 0x%02x", $0) } ?? "sem cabeçalho", default: 0] += 1
        }
    }

    func l2capChannelClosed(_ l2capChannel: IOBluetoothL2CAPChannel!) {
        say("o canal fechou (o fone desconectou, ou o macOS fechou)")
        channel = nil
        finish(code: 0)
    }

    /// Abre a sessão, pede as notificações e liga o "segurar" no 0x39, sem desligar o que já estava ligado.
    func start() {
        send(AAP.handshake, "handshake")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [self] in
            send(AAP.requestNotifications, "pedir as notificações")
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [self] in
            if !handshakeAck { say("o fone não respondeu ao handshake (segue assim mesmo)") }
            let before = gesturesBefore ?? 0
            gesturesSet = true
            send(AAP.control(AAP.rawGestures, before | StemPress.long.gestureBit), "ligar o segurar no 0x39")
            say("PRONTO: segure a haste, solte, segure de novo. Faça também um toque e um toque duplo.")
            say("Repare: o segurar ainda troca o modo de ruído (ou chama a Siri), além de aparecer aqui?")
        }
    }

    /// Devolve o 0x39 ao que era, fecha o canal e escreve o resultado.
    func finish(code: Int32) {
        guard !finishing else { return }
        finishing = true
        if gesturesSet, channel != nil {
            send(AAP.control(AAP.rawGestures, gesturesBefore ?? 0), "devolver o 0x39 ao que era")
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [self] in
            channel?.close()
            report()
            exit(code)
        }
    }

    func report() {
        let count = { (p: StemPress) in self.stems[p] ?? 0 }
        print("""

            ===== RESULTADO (pode colar no canal) =====
            canal AAP (PSM 0x1001): aberto
            resposta ao handshake: \(handshakeAck ? "sim" : "não")
            0x39 antes: \(gesturesBefore.map { String(format: "0x%02x", $0) } ?? "não veio") · depois de ligar: \(gesturesAck.map { String(format: "0x%02x", $0) } ?? "não veio")
            haste: segurar \(count(.long)) · toque \(count(.single)) · duplo \(count(.double)) · triplo \(count(.triple))
            outros pacotes: \(others.isEmpty ? "nenhum" : others.sorted { $0.key < $1.key }.map { "\($0.key) ×\($0.value)" }.joined(separator: ", "))
            o Mac recebe o segurar: \(count(.long) > 0 ? "SIM" : "NÃO")
            ===========================================
            """)
        fflush(stdout)
    }
}

// O AirPods conectado.
let paired = (IOBluetoothDevice.pairedDevices() as? [IOBluetoothDevice]) ?? []
let connected = paired.filter { $0.isConnected() }
guard let device = connected.first(where: { ($0.name ?? "").localizedCaseInsensitiveContains(options.device) }) else {
    say("nenhum dispositivo conectado com \"\(options.device)\" no nome.")
    say(connected.isEmpty
        ? "nenhum dispositivo Bluetooth conectado (ou o Terminal ainda não tem a permissão de Bluetooth)."
        : "conectados: \(connected.map { $0.name ?? "?" }.joined(separator: ", ")). Use --device com parte do nome.")
    exit(2)
}
say("fone: \(device.name ?? "?")")

let probe = Probe(options: options)
var channel: IOBluetoothL2CAPChannel?
let opened = device.openL2CAPChannelSync(&channel, withPSM: BluetoothL2CAPPSM(AAP.psm), delegate: probe)
guard opened == kIOReturnSuccess, let channel else {
    say("o macOS não deixou abrir o canal AAP (\(hex(opened))).")
    print("""

        ===== RESULTADO (pode colar no canal) =====
        canal AAP (PSM 0x1001): não abriu (\(hex(opened)))
        o Mac recebe o segurar: NÃO (sem canal)
        ===========================================
        """)
    exit(3)
}
probe.channel = channel
say("canal AAP aberto")

// Ctrl-C e o fim do tempo passam pelo finish, que devolve o 0x39.
signal(SIGINT, SIG_IGN)
signal(SIGTERM, SIG_IGN)
let signals = [SIGINT, SIGTERM].map { sig -> DispatchSourceSignal in
    let s = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    s.setEventHandler { probe.finish(code: 0) }
    s.resume()
    return s
}
DispatchQueue.main.asyncAfter(deadline: .now() + options.seconds) {
    say("tempo esgotado")
    probe.finish(code: 0)
}
probe.start()
withExtendedLifetime(signals) { RunLoop.main.run() }
