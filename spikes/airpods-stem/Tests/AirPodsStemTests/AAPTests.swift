import XCTest

@testable import AirPodsStem

final class AAPTests: XCTestCase {
    func testPacketsTheProbeSends() {
        // Os bytes do LibrePods (`linux/airpods_packets.h`, `docs/control_commands.md`).
        XCTAssertEqual(AAP.handshake.count, 16)
        XCTAssertEqual(AAP.requestNotifications, [0x04, 0x00, 0x04, 0x00, 0x0F, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])
        XCTAssertEqual(AAP.control(AAP.rawGestures, 0x08), [0x04, 0x00, 0x04, 0x00, 0x09, 0x00, 0x39, 0x08, 0x00, 0x00, 0x00])
        XCTAssertEqual(StemPress.long.gestureBit | StemPress.single.gestureBit, 0x09)
    }

    func testParsesStemPresses() {
        XCTAssertEqual(AAP.parse([0x04, 0x00, 0x04, 0x00, 0x19, 0x00, 0x08, 0x01]), .stem(.long, .left))
        XCTAssertEqual(AAP.parse([0x04, 0x00, 0x04, 0x00, 0x19, 0x00, 0x05, 0x02]), .stem(.single, .right))
        // Sem o lado, ainda é um evento; um tipo que não conhecemos não é.
        XCTAssertEqual(AAP.parse([0x04, 0x00, 0x04, 0x00, 0x19, 0x00, 0x06]), .stem(.double, nil))
        XCTAssertEqual(AAP.parse([0x04, 0x00, 0x04, 0x00, 0x19, 0x00, 0x42, 0x01]), .other(opcode: 0x19, length: 8))
    }

    func testParsesTheRest() {
        XCTAssertEqual(AAP.parse([0x01, 0x00, 0x04, 0x00, 0x00]), .handshakeAck)
        XCTAssertEqual(AAP.parse(AAP.control(AAP.rawGestures, 0x0F)), .control(id: 0x39, value: 0x0F))
        // O resto vira só opcode e tamanho.
        XCTAssertEqual(AAP.parse([0x04, 0x00, 0x04, 0x00, 0x1D, 0x00, 0xAA, 0xBB]), .other(opcode: 0x1D, length: 8))
        XCTAssertEqual(AAP.parse([0x04, 0x00]), .other(opcode: nil, length: 2))
        XCTAssertEqual(AAP.parse([0x04, 0x00, 0x04, 0x00, 0x09, 0x00, 0x39]), .other(opcode: 0x09, length: 7))
    }

    func testHoldStartsAndHoldAgainStops() {
        var t = StemToggle(debounce: 0.8)
        XCTAssertEqual(t.feed(.long, at: 10), .start)
        XCTAssertTrue(t.dictating)
        // Toque e toque duplo não mexem.
        XCTAssertNil(t.feed(.single, at: 11))
        XCTAssertNil(t.feed(.double, at: 12))
        XCTAssertEqual(t.feed(.long, at: 15), .stop)
        XCTAssertFalse(t.dictating)
        XCTAssertEqual(t.feed(.long, at: 20), .start)
    }

    func testASecondHoldRightAfterIsTheSameGesture() {
        // Os dois lados, ou o fone repetindo: um gesto só.
        var t = StemToggle(debounce: 0.8)
        XCTAssertEqual(t.feed(.long, at: 10), .start)
        XCTAssertNil(t.feed(.long, at: 10.3))
        XCTAssertTrue(t.dictating)
        XCTAssertEqual(t.feed(.long, at: 12), .stop)
    }
}
