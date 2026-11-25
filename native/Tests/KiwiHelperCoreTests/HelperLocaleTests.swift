import Foundation
import XCTest
@testable import KiwiHelperCore

/// The helper in the app's language (spec #28171, T28192).
final class HelperLocaleTests: XCTestCase {
    override func tearDown() {
        HelperLocale.set("pt")
        super.tearDown()
    }

    /// The keys of the source catalog, read from the file itself.
    private func catalogKeys() throws -> [String] {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Sources/KiwiHelperCore/Localizable.xcstrings")
        let json = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
        let strings = try XCTUnwrap(json?["strings"] as? [String: Any])
        return strings.keys.sorted()
    }

    func testTheBuiltBundleHasEveryKeyInBothLanguages() throws {
        XCTAssertNotNil(HelperLocale.resources, "the resource bundle should sit next to the tests")
        let keys = try catalogKeys()
        XCTAssertGreaterThan(keys.count, 20)
        for key in keys {
            for locale in HelperLocale.supported {
                XCTAssertTrue(HelperLocale.has(key, locale: locale), "\(key) missing in \(locale)")
            }
            XCTAssertNotEqual(HelperLocale.text(key, locale: "pt"), HelperLocale.text(key, locale: "en"), "\(key) is not translated")
        }
    }

    func testPortugueseIsTheDefaultAndEnglishFollowsTheApp() {
        XCTAssertEqual(HelperLocale.code, "pt")
        XCTAssertEqual(OverlayText.error("no_input_device"), "Nenhum microfone encontrado")
        XCTAssertEqual(MeetingText.suggestTitle, "Gravar esta reunião?")

        XCTAssertTrue(HelperLocale.set("en"))
        XCTAssertEqual(OverlayText.error("no_input_device"), "No microphone found")
        XCTAssertEqual(OverlayText.error("whatever"), "Something went wrong")
        XCTAssertEqual(OverlayText.cancel, "Cancel dictation")
        XCTAssertEqual(MeetingText.suggestTitle, "Record this meeting?")
        XCTAssertEqual(MeetingText.recording("0:42"), "Recording the meeting, 0:42")
        XCTAssertEqual(MicBusy.message(app: "Chrome"), "Mic in use by Chrome")
    }

    func testAnUnknownLanguageIsRefused() {
        XCTAssertTrue(HelperLocale.set("en"))
        XCTAssertFalse(HelperLocale.set("fr"))
        XCTAssertEqual(HelperLocale.code, "en")
    }

    func testTheArgumentsGoInBothOrders() {
        let app = MeetingApp(bundleId: "com.example.call", name: "Chamada")
        XCTAssertEqual(MeetingText.released(app, minutes: 3), "Chamada soltou o microfone há 3 min")
        HelperLocale.set("en")
        XCTAssertEqual(MeetingText.released(app, minutes: 3), "Chamada released the mic 3 min ago")
        XCTAssertEqual(MeetingText.from(app), "Chamada is using the microphone")
    }

    /// The pill has one line of 38 characters (ADR 0005): every error fits in both languages.
    func testEveryPillErrorFitsTheLine() throws {
        let codes = ["no_input_device", "microphone_denied", "microphone_undetermined", "device_changed", "no_audio", "mic_busy", "engine_start_failed", "whatever"]
        for locale in HelperLocale.supported {
            HelperLocale.set(locale)
            for code in codes { XCTAssertLessThanOrEqual(OverlayText.error(code).count, 38, "\(locale) \(code)") }
            XCTAssertLessThanOrEqual(MicBusy.message(app: String(repeating: "x", count: 60)).count, 38)
        }
    }

    func testAMissingKeyFallsBackToTheKey() {
        XCTAssertEqual(HelperLocale.text("no.such.key", locale: "en"), "no.such.key")
    }
}
