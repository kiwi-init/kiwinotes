import XCTest
@testable import KiwiHelperCore

final class IPCTests: XCTestCase {
    func testEncodeIsOneLineWithVersion() throws {
        let data = try IPC.encode("audio.level", ["level": 0.5])
        XCTAssertEqual(data.last, 0x0A)
        XCTAssertEqual(data.filter { $0 == 0x0A }.count, 1)
        let object = try JSONSerialization.jsonObject(with: data.dropLast()) as! [String: Any]
        XCTAssertEqual(object["v"] as? Int, 1)
        XCTAssertEqual(object["type"] as? String, "audio.level")
        XCTAssertEqual(object["level"] as? Double, 0.5)
    }

    func testResultCarriesIdAndError() throws {
        let data = try IPC.result(id: "7", ok: false, error: "not_implemented")
        let m = try InboundMessage.decode(data.dropLast())
        XCTAssertEqual(m.type, "result")
        XCTAssertEqual(m.id, "7")
        XCTAssertEqual(m.fields["ok"] as? Bool, false)
        XCTAssertEqual(m.string("error"), "not_implemented")
    }

    func testEncodeRejectsHugeLines() {
        let big = String(repeating: "a", count: IPC.maxLineBytes)
        XCTAssertThrowsError(try IPC.encode("log", ["message": big])) { XCTAssertEqual($0 as? IPCError, .lineTooLong) }
    }

    func testDecodeValidation() throws {
        XCTAssertThrowsError(try InboundMessage.decode(Data("[1]".utf8))) { XCTAssertEqual($0 as? IPCError, .notAnObject) }
        XCTAssertThrowsError(try InboundMessage.decode(Data(#"{"v":1}"#.utf8))) { XCTAssertEqual($0 as? IPCError, .missingType) }
        XCTAssertThrowsError(try InboundMessage.decode(Data(#"{"v":2,"type":"ping"}"#.utf8))) {
            XCTAssertEqual($0 as? IPCError, .unsupportedVersion(2))
        }
        let m = try InboundMessage.decode(Data(#"{"type":"config.set","id":"a","holdThresholdMs":300}"#.utf8))
        XCTAssertEqual(m.double("holdThresholdMs"), 300)
    }

    func testFramerSplitsAcrossChunks() {
        var f = LineFramer()
        XCTAssertTrue(f.push(Data(#"{"type":"a"}"#.utf8)).isEmpty)
        let out = f.push(Data("\n{\"type\":\"b\"}\r\n\n{\"ty".utf8))
        XCTAssertEqual(out.compactMap { try? $0.get() }.map { String(decoding: $0, as: UTF8.self) },
                       [#"{"type":"a"}"#, #"{"type":"b"}"#])
        let rest = f.push(Data("pe\":\"c\"}\n".utf8))
        XCTAssertEqual(rest.compactMap { try? $0.get() }.count, 1)
    }

    func testFramerDropsOverlongLineAndRecovers() {
        var f = LineFramer(maxLineBytes: 8)
        XCTAssertTrue(f.push(Data("0123456789".utf8)).isEmpty, "still waiting for the newline")
        let out = f.push(Data("abc\nok\n".utf8))
        XCTAssertEqual(out.count, 2)
        if case .failure(let e) = out[0] { XCTAssertEqual(e, .lineTooLong) } else { XCTFail("expected lineTooLong") }
        XCTAssertEqual(try out[1].get(), Data("ok".utf8))
    }

    func testSocketRoundTrip() throws {
        let path = NSTemporaryDirectory() + "kiwi-test-\(getpid()).sock"
        let listener = try SocketListener(path: path)
        var mode = stat()
        XCTAssertEqual(stat(path, &mode), 0)
        XCTAssertEqual(mode.st_mode & 0o777, 0o600)

        let client = try SocketConnection.connect(path: path)
        let server = try listener.accept()
        let got = expectation(description: "server got ping")
        let back = expectation(description: "client got result")
        let closed = expectation(description: "client saw close")
        server.onMessage = { m in
            XCTAssertEqual(m.type, "ping")
            got.fulfill()
            server.send(try! IPC.result(id: m.id!, ok: true))
        }
        client.onMessage = { m in
            XCTAssertEqual(m.type, "result")
            XCTAssertEqual(m.id, "1")
            back.fulfill()
            server.close()
        }
        client.onClose = { closed.fulfill() }
        server.start()
        client.start()
        client.send(try IPC.encode("ping", id: "1"))
        wait(for: [got, back, closed], timeout: 5)
    }

    func testPathTooLong() {
        XCTAssertThrowsError(try SocketConnection.connect(path: "/" + String(repeating: "x", count: 200))) {
            XCTAssertEqual($0 as? UnixSocketError, .pathTooLong)
        }
    }
}
