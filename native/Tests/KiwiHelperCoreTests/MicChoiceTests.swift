import XCTest
@testable import KiwiHelperCore

/// Which mic the dictation records from (T3229, spec #3202). No real device: just the choice over a list.
final class MicChoiceTests: XCTestCase {
    private let mac = AudioDeviceInfo(id: 1, uid: "BuiltInMicrophoneDevice", name: "Microfone do MacBook", transport: .builtIn, hasInput: true, hasOutput: false)
    private let speakers = AudioDeviceInfo(id: 2, uid: "BuiltInSpeakerDevice", name: "Alto-falantes do MacBook", transport: .builtIn, hasInput: false, hasOutput: true)
    private let airpods = AudioDeviceInfo(id: 3, uid: "AA-BB:input", name: "AirPods", transport: .bluetooth, hasInput: true, hasOutput: true)
    private let usb = AudioDeviceInfo(id: 4, uid: "USB-Mic", name: "Yeti", transport: .usb, hasInput: true, hasOutput: false)
    private let zoom = AudioDeviceInfo(id: 5, uid: "ZoomAudioDevice", name: "ZoomAudioDevice", transport: .virtual, hasInput: true, hasOutput: true)

    func testTheValueRoundTrips() {
        XCTAssertEqual(MicChoice("auto"), .auto)
        XCTAssertEqual(MicChoice("builtin"), .mac)
        XCTAssertEqual(MicChoice("system"), .system)
        XCTAssertEqual(MicChoice("uid:USB-Mic"), .device(uid: "USB-Mic"))
        for bad in ["", "mac", "uid:", "USB-Mic"] { XCTAssertNil(MicChoice(bad), bad) }
        for c in [MicChoice.auto, .mac, .system, .device(uid: "X")] { XCTAssertEqual(MicChoice(c.value), c) }
    }

    func testAutoWithAirPodsRecordsFromTheMac() {
        // #3202: AirPods are the default input and output. The dictation must not open the AirPods' mic.
        let pick = MicPicker.pick(.auto, devices: [mac, speakers, airpods, zoom], defaultInput: airpods.id, defaultOutput: airpods.id)
        XCTAssertEqual(pick.device, mac)
        XCTAssertFalse(pick.fellBack)
    }

    func testAutoWithoutABuiltInMicUsesUSBButNeverAVirtualOne() {
        let pick = MicPicker.pick(.auto, devices: [zoom, airpods, usb], defaultInput: airpods.id, defaultOutput: airpods.id)
        XCTAssertEqual(pick.device, usb)
        // A Mac mini with only AirPods (and a virtual device): no other real mic, so the default stays.
        XCTAssertNil(MicPicker.pick(.auto, devices: [zoom, airpods], defaultInput: airpods.id, defaultOutput: airpods.id).device)
    }

    func testAutoLeavesTheDefaultAloneWhenTheOutputIsntBluetooth() {
        XCTAssertNil(MicPicker.pick(.auto, devices: [mac, speakers, airpods], defaultInput: mac.id, defaultOutput: speakers.id).device)
        // AirPods mic with the Mac's speakers: the output isn't ducked by a call, so no change either.
        XCTAssertNil(MicPicker.pick(.auto, devices: [mac, speakers, airpods], defaultInput: airpods.id, defaultOutput: speakers.id).device)
    }

    func testAutoKeepsAWiredDefaultInputTheyChose() {
        // AirPods for sound, the USB mic picked as the default input in System Settings: that is already right.
        XCTAssertNil(MicPicker.pick(.auto, devices: [mac, airpods, usb], defaultInput: usb.id, defaultOutput: airpods.id).device)
    }

    func testMacAndSystem() {
        XCTAssertEqual(MicPicker.pick(.mac, devices: [mac, airpods], defaultInput: airpods.id, defaultOutput: speakers.id).device, mac)
        XCTAssertNil(MicPicker.pick(.mac, devices: [airpods], defaultInput: airpods.id, defaultOutput: airpods.id).device)
        // "Padrão do sistema" is how it was before: the AirPods' own mic.
        XCTAssertNil(MicPicker.pick(.system, devices: [mac, airpods], defaultInput: airpods.id, defaultOutput: airpods.id).device)
    }

    func testAChosenDeviceThatIsGoneFallsBackToAuto() {
        let chosen = MicPicker.pick(.device(uid: "USB-Mic"), devices: [mac, airpods, usb], defaultInput: airpods.id, defaultOutput: airpods.id)
        XCTAssertEqual(chosen.device, usb)
        XCTAssertFalse(chosen.fellBack)
        let gone = MicPicker.pick(.device(uid: "USB-Mic"), devices: [mac, airpods], defaultInput: airpods.id, defaultOutput: airpods.id)
        XCTAssertEqual(gone.device, mac)
        XCTAssertTrue(gone.fellBack)
        // A UID that names an output-only device isn't a mic.
        XCTAssertTrue(MicPicker.pick(.device(uid: speakers.uid), devices: [mac, speakers], defaultInput: mac.id, defaultOutput: speakers.id).fellBack)
    }

    func testWithTheLidClosedTheBuiltInMicIsNeverPicked() {
        // AirPods with the MacBook closed on an external monitor (#3300): the built-in mic only records silence.
        let closed = { (choice: MicChoice, devices: [AudioDeviceInfo]) in
            MicPicker.pick(choice, devices: devices, defaultInput: self.airpods.id, defaultOutput: self.airpods.id, lidClosed: true)
        }
        XCTAssertEqual(closed(.auto, [mac, airpods, usb]).device, usb)
        let noUSB = closed(.auto, [mac, airpods])
        XCTAssertNil(noUSB.device)
        XCTAssertTrue(noUSB.reason.contains("lid closed"))
        let builtin = closed(.mac, [mac, airpods])
        XCTAssertNil(builtin.device)
        XCTAssertTrue(builtin.reason.contains("lid closed"))
        // The built-in mic chosen by its UID falls back too.
        let byUID = closed(.device(uid: mac.uid), [mac, airpods, usb])
        XCTAssertEqual(byUID.device, usb)
        XCTAssertTrue(byUID.fellBack)
        // Lid open: as before.
        XCTAssertEqual(MicPicker.pick(.auto, devices: [mac, airpods, usb], defaultInput: airpods.id, defaultOutput: airpods.id, lidClosed: false).device, mac)
    }
}
