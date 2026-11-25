import XCTest
@testable import KiwiHelperCore

/// T27825: a fila da voz do gato. Nada aqui abre dispositivo de áudio: só o `SilentSpeech`.
final class SpeechOutputTests: XCTestCase {
    private func base64(_ samples: [Int16]) -> String {
        var data = Data()
        for s in samples { withUnsafeBytes(of: s.littleEndian) { data.append(contentsOf: $0) } }
        return data.base64EncodedString()
    }

    func testDecodesInt16LittleEndian() throws {
        let floats = try XCTUnwrap(SpeechPCM.floats(base64: base64([0, 16384, -32768, 32767])))
        XCTAssertEqual(floats.count, 4)
        XCTAssertEqual(floats[0], 0)
        XCTAssertEqual(floats[1], 0.5)
        XCTAssertEqual(floats[2], -1)
        XCTAssertEqual(floats[3], 32767 / 32768, accuracy: 1e-6)
    }

    func testRejectsBadPcm() {
        XCTAssertNil(SpeechPCM.floats(base64: ""))
        XCTAssertNil(SpeechPCM.floats(base64: "não é base64"))
        XCTAssertNil(SpeechPCM.floats(base64: Data([1, 2, 3]).base64EncodedString()), "um byte sobrando")
    }

    func testPendingRunsEachDoneOnceAndFlushInOrder() {
        let pending = SpeechPending()
        var ran: [Int] = []
        let a = pending.add { ran.append(1) }
        _ = pending.add { ran.append(2) }
        _ = pending.add { ran.append(3) }
        pending.finish(a)
        pending.finish(a)
        XCTAssertEqual(ran, [1])
        pending.flush()
        XCTAssertEqual(ran, [1, 2, 3])
        XCTAssertEqual(pending.count, 0)
        pending.finish(a)
        XCTAssertEqual(ran, [1, 2, 3], "o retorno atrasado de um pedaço limpo não roda de novo")
    }

    func testSilentPlaysInOrderForTheChunkTime() {
        let speech = SilentSpeech(queue: .main)
        var order: [Int] = []
        let done = expectation(description: "os dois pedaços")
        done.expectedFulfillmentCount = 2
        let start = Date()
        // 1920 amostras = 80 ms a 24 kHz: o 2º acaba depois de ~160 ms.
        speech.play([Float](repeating: 0, count: 1920)) { order.append(1); done.fulfill() }
        speech.play([Float](repeating: 0, count: 1920)) { order.append(2); done.fulfill() }
        wait(for: [done], timeout: 2)
        XCTAssertEqual(order, [1, 2])
        XCTAssertGreaterThanOrEqual(Date().timeIntervalSince(start), 0.15)
        XCTAssertEqual(speech.volume, 1)
    }

    func testSilentStopFlushesAtOnce() {
        let speech = SilentSpeech(queue: .main)
        var ran = 0
        speech.play([Float](repeating: 0, count: 24_000)) { ran += 1 }
        speech.play([Float](repeating: 0, count: 24_000)) { ran += 1 }
        speech.stop()
        XCTAssertEqual(ran, 2, "o stop roda os dois na hora, sem esperar o segundo de cada um")
        // O timer de cada pedaço ainda dispara, e não roda nada de novo.
        let later = expectation(description: "depois do tempo dos pedaços")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.1) { later.fulfill() }
        wait(for: [later], timeout: 3)
        XCTAssertEqual(ran, 2)
    }
}
