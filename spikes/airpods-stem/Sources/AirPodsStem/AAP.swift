// O protocolo do AirPods (AAP) só no que o protótipo da T3245 usa: abrir a sessão, pedir os eventos da haste e ler o
// "segurar". Os bytes vêm da documentação do LibrePods (github.com/kavishdevar/librepods: `docs/control_commands.md`,
// `linux/airpods_packets.h`, `AACPManager.kt`), sem código copiado. Nada aqui toca o Bluetooth: é só bytes.

/// Os pacotes que o protótipo manda e o que ele entende dos que chegam.
public enum AAP {
    /// O canal L2CAP do AAP.
    public static let psm: UInt16 = 0x1001

    /// Abre a sessão. O fone responde com `01 00 04 00 …`.
    public static let handshake: [UInt8] = [0x00, 0x00, 0x04, 0x00, 0x01, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
    /// Pede todas as notificações (opcode 0x0F, máscara cheia).
    public static let requestNotifications: [UInt8] = [0x04, 0x00, 0x04, 0x00, 0x0F, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]

    /// O control command 0x39, "Raw Gestures config": uma máscara do que o fone manda como evento de haste.
    public static let rawGestures: UInt8 = 0x39

    /// Um control command (opcode 0x09): `04 00 04 00 09 00 [id] [d1] [d2] 00 00`.
    public static func control(_ id: UInt8, _ data1: UInt8, _ data2: UInt8 = 0) -> [UInt8] {
        [0x04, 0x00, 0x04, 0x00, 0x09, 0x00, id, data1, data2, 0x00, 0x00]
    }

    /// O que mandar no 0x39 para o "segurar" chegar: o valor de antes com o bit do segurar. Nil quando não se sabe o
    /// valor de antes (mandar um chute apagaria o que já estava ligado no fone, review da T3245) ou quando ele já está
    /// ligado (nada a mudar, nada a devolver).
    public static func gesturesToSend(before: UInt8?) -> UInt8? {
        guard let before, before & StemPress.long.gestureBit == 0 else { return nil }
        return before | StemPress.long.gestureBit
    }

    public enum Packet: Equatable, Sendable {
        case handshakeAck
        /// Um evento da haste (opcode 0x19): o tipo e o lado, se o fone disse.
        case stem(StemPress, Bud?)
        /// O valor de um control command, que o fone manda ao mudar ou quando pedem as notificações.
        case control(id: UInt8, value: UInt8)
        /// Outro pacote: só o opcode e o tamanho, para o log não guardar o resto (pode ter número de série).
        case other(opcode: UInt16?, length: Int)
    }

    public static func parse(_ b: [UInt8]) -> Packet {
        if b.count >= 4, b[0] == 0x01, b[1] == 0x00, b[2] == 0x04, b[3] == 0x00 { return .handshakeAck }
        guard b.count >= 6, b[0] == 0x04, b[1] == 0x00, b[2] == 0x04, b[3] == 0x00 else { return .other(opcode: nil, length: b.count) }
        let opcode = UInt16(b[4]) | UInt16(b[5]) << 8
        switch opcode {
        case 0x19 where b.count >= 7:
            guard let press = StemPress(rawValue: b[6]) else { return .other(opcode: opcode, length: b.count) }
            return .stem(press, b.count >= 8 ? Bud(rawValue: b[7]) : nil)
        case 0x09 where b.count >= 8:
            return .control(id: b[6], value: b[7])
        default:
            return .other(opcode: opcode, length: b.count)
        }
    }
}

/// O tipo de evento da haste. Não existe "soltou": o longo chega uma vez, quando o tempo de segurar passa.
public enum StemPress: UInt8, Sendable, CustomStringConvertible {
    case single = 0x05, double = 0x06, triple = 0x07, long = 0x08

    /// O bit dele na máscara do 0x39.
    public var gestureBit: UInt8 {
        switch self {
        case .single: 0x01
        case .double: 0x02
        case .triple: 0x04
        case .long: 0x08
        }
    }

    public var description: String {
        switch self {
        case .single: "toque"
        case .double: "toque duplo"
        case .triple: "toque triplo"
        case .long: "segurar"
        }
    }
}

public enum Bud: UInt8, Sendable, CustomStringConvertible {
    case left = 0x01, right = 0x02
    public var description: String { self == .left ? "esquerdo" : "direito" }
}

/// Segurar começa, segurar de novo para (a escolha A do jow, #3335). Um segundo "segurar" logo depois do primeiro (os
/// dois lados, ou o fone repetindo) não conta: sem isso, começava e parava no mesmo gesto.
public struct StemToggle: Sendable {
    public enum Action: Equatable, Sendable { case start, stop }

    public private(set) var dictating = false
    private var lastLong: Double?
    /// Segundos em que um segundo "segurar" é o mesmo gesto.
    public let debounce: Double

    public init(debounce: Double = 0.8) { self.debounce = debounce }

    /// `at`: um relógio em segundos (o uptime). Só o "segurar" mexe no estado; toque e toque duplo ficam como estão.
    public mutating func feed(_ press: StemPress, at now: Double) -> Action? {
        guard press == .long else { return nil }
        if let lastLong, now - lastLong < debounce { return nil }
        lastLong = now
        dictating.toggle()
        return dictating ? .start : .stop
    }
}
