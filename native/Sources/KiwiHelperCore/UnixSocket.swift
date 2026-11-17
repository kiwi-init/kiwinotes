import Foundation

public enum UnixSocketError: Error, Equatable {
    case pathTooLong
    case system(String, Int32)
}

func makeAddress(_ path: String) throws -> sockaddr_un {
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    let bytes = Array(path.utf8)
    let capacity = MemoryLayout.size(ofValue: address.sun_path)
    guard bytes.count < capacity else { throw UnixSocketError.pathTooLong }
    withUnsafeMutableBytes(of: &address.sun_path) { raw in
        raw.copyBytes(from: bytes)
        raw[bytes.count] = 0
    }
    address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    return address
}

/// One NDJSON connection over a unix socket. Messages arrive on a background thread.
public final class SocketConnection: @unchecked Sendable {
    public let fd: Int32
    /// Same as `fd` for a socket; stdout when running over stdio.
    public let writeFD: Int32
    private let writeQueue = DispatchQueue(label: "kiwi.ipc.write")
    private let lock = NSLock()
    private var closed = false

    public var onMessage: ((InboundMessage) -> Void)?
    public var onBadLine: ((Error) -> Void)?
    public var onClose: (() -> Void)?

    public init(fd: Int32, writeFD: Int32? = nil) {
        self.fd = fd
        self.writeFD = writeFD ?? fd
        var on: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
    }

    /// Connects to a listening socket (the Bun side).
    public static func connect(path: String) throws -> SocketConnection {
        var address = try makeAddress(path)
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw UnixSocketError.system("socket", errno) }
        let rc = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard rc == 0 else {
            let code = errno
            Darwin.close(fd)
            throw UnixSocketError.system("connect", code)
        }
        return SocketConnection(fd: fd)
    }

    public func start() {
        let thread = Thread { [self] in readLoop() }
        thread.name = "kiwi.ipc.read"
        thread.start()
    }

    private func readLoop() {
        var framer = LineFramer()
        var buffer = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
            let n = buffer.withUnsafeMutableBytes { read(fd, $0.baseAddress, $0.count) }
            if n < 0 && errno == EINTR { continue }
            if n <= 0 { break }
            for line in framer.push(Data(buffer[0..<n])) {
                switch line {
                case .success(let data):
                    do { onMessage?(try InboundMessage.decode(data)) } catch { onBadLine?(error) }
                case .failure(let error):
                    onBadLine?(error)
                }
            }
        }
        close()
    }

    public func send(_ data: Data) {
        writeQueue.async { [self] in
            guard !isClosed else { return }
            data.withUnsafeBytes { raw in
                var offset = 0
                while offset < raw.count {
                    let n = write(writeFD, raw.baseAddress! + offset, raw.count - offset)
                    if n < 0 && errno == EINTR { continue }
                    if n <= 0 { return }
                    offset += n
                }
            }
        }
    }

    private var isClosed: Bool {
        lock.lock(); defer { lock.unlock() }
        return closed
    }

    public func close() {
        lock.lock()
        let wasClosed = closed
        closed = true
        lock.unlock()
        guard !wasClosed else { return }
        if writeFD == fd {
            shutdown(fd, SHUT_RDWR)
            Darwin.close(fd)
        }
        onClose?()
    }
}

/// Listening side, used by the probe and the tests (in the app, Bun listens).
public final class SocketListener {
    public let fd: Int32
    public let path: String

    public init(path: String) throws {
        self.path = path
        unlink(path)
        var address = try makeAddress(path)
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw UnixSocketError.system("socket", errno) }
        let rc = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard rc == 0 else {
            let code = errno
            Darwin.close(fd)
            throw UnixSocketError.system("bind", code)
        }
        chmod(path, 0o600)
        guard listen(fd, 1) == 0 else {
            let code = errno
            Darwin.close(fd)
            throw UnixSocketError.system("listen", code)
        }
        self.fd = fd
    }

    public func accept() throws -> SocketConnection {
        let client = Darwin.accept(fd, nil, nil)
        guard client >= 0 else { throw UnixSocketError.system("accept", errno) }
        return SocketConnection(fd: client)
    }

    deinit {
        Darwin.close(fd)
        unlink(path)
    }
}
