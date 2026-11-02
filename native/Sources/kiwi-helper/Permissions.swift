import AVFoundation
import AppKit
import ApplicationServices
import CoreGraphics

/// The three permissions dictation needs. Names match the IPC fields.
enum Permission: String, CaseIterable {
    case microphone
    case accessibility
    case inputMonitoring

    var status: String {
        switch self {
        case .microphone:
            switch AVCaptureDevice.authorizationStatus(for: .audio) {
            case .authorized: return "granted"
            case .denied: return "denied"
            case .restricted: return "restricted"
            case .notDetermined: return "undetermined"
            @unknown default: return "unknown"
            }
        case .accessibility:
            return AXIsProcessTrusted() ? "granted" : "denied"
        case .inputMonitoring:
            return CGPreflightListenEventAccess() ? "granted" : "denied"
        }
    }

    /// Shown in the app's onboarding next to the "open Settings" button.
    var why: String {
        switch self {
        case .microphone:
            return "Para ouvir o que você dita. Só grava enquanto o atalho está ativo, e o áudio não sai do Mac."
        case .accessibility:
            return "Para colar o texto no app em que você está digitando."
        case .inputMonitoring:
            return "Para perceber o atalho de ditado (Fn ou ⌥ direito) em qualquer app. O Kiwi Notes não lê o que você digita."
        }
    }

    var settingsURL: URL {
        let anchor: String
        switch self {
        case .microphone: anchor = "Privacy_Microphone"
        case .accessibility: anchor = "Privacy_Accessibility"
        case .inputMonitoring: anchor = "Privacy_ListenEvent"
        }
        return URL(string: "x-apple.systempreferences:com.apple.preference.security?\(anchor)")!
    }

    /// Shows the system prompt when macOS still allows one; otherwise opens the right pane of System Settings.
    func request(completion: @escaping (String) -> Void) {
        switch self {
        case .microphone:
            if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
                AVCaptureDevice.requestAccess(for: .audio) { _ in
                    DispatchQueue.main.async { completion(self.status) }
                }
                return
            }
        case .accessibility:
            let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
            if AXIsProcessTrustedWithOptions([key: true] as CFDictionary) { return completion(status) }
        case .inputMonitoring:
            if CGRequestListenEventAccess() { return completion(status) }
        }
        if status != "granted" { NSWorkspace.shared.open(settingsURL) }
        completion(status)
    }

    static func snapshot() -> [String: String] {
        Dictionary(uniqueKeysWithValues: allCases.map { ($0.rawValue, $0.status) })
    }

    static func explanations() -> [String: String] {
        Dictionary(uniqueKeysWithValues: allCases.map { ($0.rawValue, $0.why) })
    }
}
