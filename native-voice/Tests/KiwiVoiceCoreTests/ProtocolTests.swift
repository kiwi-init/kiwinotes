import Foundation
import XCTest
@testable import KiwiVoiceCore

final class ProtocolTests: XCTestCase {
    func testDecodeLoadUsesTheCacheCapByDefault() throws {
        let c = try decodeCommand(#"{"type":"load","modelDir":"/tmp/modelo","refAudio":"/tmp/voz.wav","refText":"Oi, Ana."}"#)
        XCTAssertEqual(c, .load(modelDir: "/tmp/modelo", refAudio: "/tmp/voz.wav", refText: "Oi, Ana.", language: "portuguese", cacheMB: 512))
        let z = try decodeCommand(#"{"type":"load","modelDir":"m","refAudio":"r","refText":"t","cacheMB":0}"#)
        XCTAssertEqual(z, .load(modelDir: "m", refAudio: "r", refText: "t", language: "portuguese", cacheMB: 512))
    }

    func testDecodeSpeakCancelAndErrors() throws {
        XCTAssertEqual(try decodeCommand(#"{"type":"speak","id":"t1","text":"Bom dia."}"#), .speak(id: "t1", text: "Bom dia."))
        XCTAssertEqual(try decodeCommand(#"{"type":"cancel","id":"t1"}"#), .cancel(id: "t1"))
        XCTAssertEqual(try decodeCommand(#"{"type":"warmup"}"#), .warmup)
        XCTAssertThrowsError(try decodeCommand("não é json")) { XCTAssertEqual($0 as? VoiceProtocolError, .notJSON) }
        XCTAssertThrowsError(try decodeCommand(#"{"type":"speak","id":"t1"}"#)) { XCTAssertEqual($0 as? VoiceProtocolError, .missing("text")) }
        XCTAssertThrowsError(try decodeCommand(#"{"type":"tocar"}"#)) { XCTAssertEqual($0 as? VoiceProtocolError, .unknownType("tocar")) }
    }

    func testPcmIsInt16LittleEndianBase64() throws {
        let line = encodeEvent(.pcm(id: "t1", seq: 2, samples: [0, 1, -1, 32767]))
        let obj = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any])
        XCTAssertEqual(obj["type"] as? String, "pcm")
        XCTAssertEqual(obj["seq"] as? Int, 2)
        let bytes = [UInt8](try XCTUnwrap(Data(base64Encoded: obj["pcm"] as! String)))
        XCTAssertEqual(bytes, [0, 0, 1, 0, 0xFF, 0xFF, 0xFF, 0x7F])
        XCTAssertFalse(line.contains("\n"))
    }

    func testErrorWithoutIdHasNoIdKey() {
        XCTAssertEqual(encodeEvent(.error(id: nil, message: "x")), #"{"message":"x","type":"error"}"#)
        XCTAssertEqual(encodeEvent(.done(id: "t1")), #"{"id":"t1","type":"done"}"#)
    }

    func testToInt16Clamps() {
        XCTAssertEqual(toInt16([0, 1, -1, 2, -2, .nan, 0.5]), [0, 32767, -32767, 32767, -32767, 0, 16384])
    }

    func testQueueKeepsOrderAndRemoves() {
        var q = SpeakQueue()
        q.push(id: "a", text: "1"); q.push(id: "b", text: "2"); q.push(id: "c", text: "3")
        XCTAssertTrue(q.remove(id: "b"))
        XCTAssertFalse(q.remove(id: "b"))
        XCTAssertEqual(q.next()?.id, "a")
        XCTAssertEqual(q.next()?.id, "c")
        XCTAssertNil(q.next())
    }
}
