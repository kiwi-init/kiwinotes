import XCTest
@testable import KiwiHelperCore

final class OverlayModelTests: XCTestCase {
    func testListeningFillsBarsFromTheRight() {
        var m = OverlayModel(barCount: 4)
        m.set(.listening, at: 0)
        m.push(level: 1)
        XCTAssertEqual(m.bars.last ?? 0, 1, accuracy: 1e-6)
        XCTAssertEqual(m.bars.first ?? 1, 0)
        m.push(level: 0)
        XCTAssertEqual(m.bars.last ?? 0, 0.12, accuracy: 1e-6, "silence keeps a small floor")
        XCTAssertEqual(m.bars[2], 1, accuracy: 1e-6, "older levels move left")
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

    func testMessageOnlyForErrors() {
        var m = OverlayModel()
        m.set(.done, message: "ignored", at: 0)
        XCTAssertNil(m.message)
    }

    func testFrameSitsUnderTheNotch() {
        // 14" MacBook Pro: 1512×982 points, notch/menu bar 38 pt.
        let screen = CGRect(x: 0, y: 0, width: 1512, height: 982)
        let visible = CGRect(x: 0, y: 0, width: 1512, height: 944)
        let f = OverlayLayout.frame(screen: screen, visible: visible, safeTop: 38, size: CGSize(width: 320, height: 64))
        XCTAssertEqual(f, CGRect(x: 596, y: 982 - 38 - 8 - 64, width: 320, height: 64))
    }

    func testFrameWithHiddenMenuBarStillAvoidsTheNotch() {
        let screen = CGRect(x: 0, y: 0, width: 1512, height: 982)
        let f = OverlayLayout.frame(screen: screen, visible: screen, safeTop: 38, size: CGSize(width: 100, height: 40))
        XCTAssertEqual(f.maxY, 982 - 38 - 8)
    }

    func testFrameOnASecondScreenWithoutNotch() {
        // External display to the right, menu bar 25 pt.
        let screen = CGRect(x: 1512, y: -200, width: 2560, height: 1440)
        let visible = CGRect(x: 1512, y: -200, width: 2560, height: 1415)
        let f = OverlayLayout.frame(screen: screen, visible: visible, safeTop: 0, size: CGSize(width: 320, height: 64))
        XCTAssertEqual(f.midX, screen.midX)
        XCTAssertEqual(f.maxY, 1240 - 25 - 8)
    }

    func testErrorTextForKnownCodes() {
        XCTAssertEqual(OverlayText.error("no_input_device"), "Nenhum microfone encontrado")
        XCTAssertEqual(OverlayText.error("microphone_undetermined"), "Permita o microfone e tente de novo")
        XCTAssertEqual(OverlayText.error("device_changed"), "O microfone mudou")
        XCTAssertEqual(OverlayText.error("whatever"), "Algo deu errado")
    }
}
