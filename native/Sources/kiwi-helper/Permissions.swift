import AVFoundation
import AppKit
import ApplicationServices
import CoreGraphics
import KiwiHelperCore

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
            // A state from a future macOS: treat it as not asked yet, the one PermissionState that offers a prompt.
            @unknown default: return "undetermined"
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

    /// Whether this app already showed the system prompt. macOS shows each prompt once; after that the call is
    /// silent, so the next ask has to open Settings. The mic's state says it directly; the other two report
    /// "denied" before and after the prompt alike, so the helper remembers.
    private var askedBefore: Bool {
        switch self {
        case .microphone: return AVCaptureDevice.authorizationStatus(for: .audio) != .notDetermined
        default: return UserDefaults.standard.bool(forKey: "asked.\(rawValue)")
        }
    }

    /// One window at a time: the system prompt the first time, System Settings after that (PermissionAsk).
    func request(completion: @escaping (String) -> Void) {
        switch PermissionAsk.next(state: status, askedBefore: askedBefore) {
        case .none:
            completion(status)
        case .openSettings:
            NSWorkspace.shared.open(settingsURL)
            completion(status)
        case .systemPrompt:
            UserDefaults.standard.set(true, forKey: "asked.\(rawValue)")
            switch self {
            case .microphone:
                AVCaptureDevice.requestAccess(for: .audio) { _ in
                    DispatchQueue.main.async { completion(self.status) }
                }
            case .accessibility:
                let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
                _ = AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
                completion(status)
            case .inputMonitoring:
                _ = CGRequestListenEventAccess()
                completion(status)
            }
        }
    }

    static func snapshot() -> [String: String] {
        Dictionary(uniqueKeysWithValues: allCases.map { ($0.rawValue, $0.status) })
    }

    static func explanations() -> [String: String] {
        Dictionary(uniqueKeysWithValues: allCases.map { ($0.rawValue, $0.why) })
    }
}
