import XCTest
@testable import KiwiHelperCore

final class OverlayModelTests: XCTestCase {
    func testWaveformIsSymmetricWithTheNewestLevelInTheMiddle() {
        var m = OverlayModel(barCount: 5)
        m.set(.listening, at: 0)
        m.push(level: 1)
        XCTAssertEqual(m.bars[2], 1, accuracy: 1e-6, "the newest level is the middle bar")
        XCTAssertEqual(m.bars[0], 0)
        XCTAssertEqual(m.bars[4], 0)
        m.push(level: 0)
        XCTAssertEqual(m.bars[2], 0.12, accuracy: 1e-6, "silence keeps a small floor")
        let near = 1 - OverlayModel.edgeTaper / 2
        XCTAssertEqual(m.bars[1], near, accuracy: 1e-6, "older levels move out, a little shorter")
        XCTAssertEqual(m.bars[1], m.bars[3], "mirrored")
        m.push(level: 0)
        XCTAssertEqual(m.bars[0], 1 - OverlayModel.edgeTaper, accuracy: 1e-6)
        XCTAssertEqual(m.bars[0], m.bars[4])
    }

    func testEvenBarCountsMirrorToo() {
        var m = OverlayModel(barCount: 4)
        m.set(.listening, at: 0)
        m.push(level: 1)
        XCTAssertEqual(m.bars[1], m.bars[2])
        XCTAssertEqual(m.bars[1], 1, accuracy: 1e-6)
        XCTAssertEqual(m.bars[0], m.bars[3])
    }

    func testQuietSpeechIsLifted() {
        XCTAssertGreaterThan(OverlayModel.shape(0.04), 0.12 + 0.88 * 0.04 + 0.1)
        XCTAssertEqual(OverlayModel.shape(5), 1, "levels are clamped")
    }

    func testLevelsOutsideListeningAreIgnored() {
        var m = OverlayModel(barCount: 3)
        m.push(level: 1)
        XCTAssertEqual(m.bars, [0, 0, 0])
        m.set(.listening, at: 0)
        m.push(level: 1)
        m.set(.processing, at: 1)
        let frozen = m.bars
        m.push(level: 0.5)
        XCTAssertEqual(m.bars, frozen, "a late audio.level doesn't move a processing pill")
    }

    func testNewRecordingStartsWithFlatBars() {
        var m = OverlayModel(barCount: 2)
        m.set(.listening, at: 0)
        m.push(level: 1)
        m.set(.hidden, at: 1)
        m.set(.listening, at: 2)
        XCTAssertEqual(m.bars, [0, 0])
    }

    func testDoneAndErrorHideByThemselves() {
        var m = OverlayModel()
        m.set(.done, at: 10)
        XCTAssertFalse(m.tick(now: 10.5))
        XCTAssertTrue(m.tick(now: 10 + OverlayModel.doneLinger))
        XCTAssertEqual(m.phase, .hidden)

        m.set(.error, message: "Sem permissão do microfone", at: 20)
        XCTAssertEqual(m.message, "Sem permissão do microfone")
        XCTAssertFalse(m.tick(now: 21))
        XCTAssertTrue(m.tick(now: 20 + OverlayModel.errorLinger))
        XCTAssertNil(m.message)
    }

    func testProcessingTimesOutWhenTheAppGoesQuiet() {
        var m = OverlayModel()
        m.set(.processing, at: 0)
        XCTAssertFalse(m.tick(now: 5))
        XCTAssertTrue(m.tick(now: OverlayModel.processingTimeout))
    }

    func testListeningNeverHidesByItself() {
        var m = OverlayModel()
        m.set(.listening, at: 0)
        XCTAssertNil(m.hideAt)
        XCTAssertFalse(m.tick(now: 3600), "a long toggle dictation keeps the pill")
    }

    func testLongMessagesAreCut() {
        var m = OverlayModel()
        m.set(.error, message: "  O microfone externo foi desconectado no meio da gravação  ", at: 0)
        XCTAssertLessThanOrEqual(m.message?.count ?? 99, OverlayModel.maxMessageLength)
        XCTAssertTrue(m.message?.hasSuffix("…") == true)
        m.set(.error, message: "Curta", at: 0)
        XCTAssertEqual(m.message, "Curta")
    }

    func testMessageOnlyForErrorAndDone() {
        var m = OverlayModel()
        m.set(.processing, message: "ignored", at: 0)
        XCTAssertNil(m.message)
        m.set(.listening, message: "ignored", at: 0)
        XCTAssertNil(m.message)
    }

    /// #224: with secure input, `done` says the text also stayed on the clipboard, and stays long enough to read.
    func testDoneWithAMessageStaysAsLongAsAnError() {
        var m = OverlayModel()
        m.set(.done, message: "O texto também ficou no clipboard", at: 0)
        XCTAssertEqual(m.message, "O texto também ficou no clipboard")
        XCTAssertFalse(m.tick(now: OverlayModel.doneLinger))
        XCTAssertTrue(m.tick(now: OverlayModel.errorLinger))
        // Without one (or a blank one), it is the short check mark.
        m.set(.done, message: "  ", at: 10)
        XCTAssertNil(m.message)
        XCTAssertTrue(m.tick(now: 10 + OverlayModel.doneLinger))
    }

    func testFrameSitsAboveTheDock() {
        // 14" MacBook Pro: 1512×982 points, Dock at the bottom 70 pt tall, menu bar 38 pt.
        let screen = CGRect(x: 0, y: 0, width: 1512, height: 982)
        let visible = CGRect(x: 0, y: 70, width: 1512, height: 874)
        let f = OverlayLayout.frame(screen: screen, visible: visible, size: CGSize(width: 360, height: 64), pillBottom: 14)
        XCTAssertEqual(f, CGRect(x: 576, y: 70 + 12 - 14, width: 360, height: 64))
        XCTAssertEqual(f.minY + 14, visible.minY + OverlayLayout.margin, "the pill's bottom edge is a margin above the Dock")
    }

    func testFrameWithTheDockHiddenOrOnASide() {
        let screen = CGRect(x: 0, y: 0, width: 1512, height: 982)
        let visible = CGRect(x: 80, y: 0, width: 1432, height: 944) // Dock on the left
        let f = OverlayLayout.frame(screen: screen, visible: visible, size: CGSize(width: 100, height: 40), pillBottom: 10)
        XCTAssertEqual(f.midX, screen.midX, "centered on the screen, not on what the Dock leaves")
        XCTAssertEqual(f.minY + 10, OverlayLayout.margin)
    }

    func testFrameOnASecondScreen() {
        // External display to the right and lower, Dock not on it.
        let screen = CGRect(x: 1512, y: -200, width: 2560, height: 1440)
        let visible = CGRect(x: 1512, y: -200, width: 2560, height: 1415)
        let f = OverlayLayout.frame(screen: screen, visible: visible, size: CGSize(width: 360, height: 64), pillBottom: 14)
        XCTAssertEqual(f.midX, screen.midX)
        XCTAssertEqual(f.minY, -200 + 12 - 14)
    }

    func testErrorTextForKnownCodes() {
        XCTAssertEqual(OverlayText.error("no_input_device"), "Nenhum microfone encontrado")
        XCTAssertEqual(OverlayText.error("microphone_undetermined"), "Permita o microfone e tente de novo")
        XCTAssertEqual(OverlayText.error("device_changed"), "O microfone mudou")
        XCTAssertEqual(OverlayText.error("whatever"), "Algo deu errado")
    }
}
