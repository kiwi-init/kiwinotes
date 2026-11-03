import AVFoundation
import AppKit
import ApplicationServices
import CoreGraphics
import KiwiHelperCore
import Security

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
    /// `reset` comes only from a person's click in the app: it forgets this app's entry and prompts again (T658).
    func request(reset: Bool = false, completion: @escaping (String) -> Void) {
        switch PermissionAsk.next(state: status, askedBefore: askedBefore, reset: reset) {
        case .none:
            completion(status)
        case .openSettings:
            NSWorkspace.shared.open(settingsURL)
            completion(status)
        case .systemPrompt:
            prompt(completion: completion)
        case .resetAndPrompt:
            guard resetEntry() else {
                NSWorkspace.shared.open(settingsURL)
                return completion(status)
            }
            prompt(completion: completion)
        }
    }

    private func prompt(completion: @escaping (String) -> Void) {
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

    /// `tccutil reset <service> <bundle id>` for the app macOS charges (only this app's entry, nothing else).
    private func resetEntry() -> Bool {
        guard let service = TCCService.name(for: rawValue), let bundleId = Responsible.current()?.bundleId else {
            return false
        }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/tccutil")
        process.arguments = ["reset", service, bundleId]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            return false
        }
        return process.terminationStatus == 0
    }

    static func snapshot() -> [String: String] {
        Dictionary(uniqueKeysWithValues: allCases.map { ($0.rawValue, $0.status) })
    }

    static func explanations() -> [String: String] {
        Dictionary(uniqueKeysWithValues: allCases.map { ($0.rawValue, $0.why) })
    }
}

/// The process macOS charges for the helper's permissions (TCC's "responsible process"): the app's launcher when the
/// app started us, a terminal when the probe did. Logged at start, so a switch that's on but doesn't count (T658)
/// shows which identity macOS checked against.
struct Responsible {
    let pid: pid_t
    let path: String
    let bundlePath: String?
    let bundleId: String?
    /// The code signature: identifier, cdhash, and whether the Info.plist is bound (an ad hoc bundle often isn't).
    let identifier: String?
    let cdhash: String?
    let infoPlistBound: Bool
    let adhoc: Bool

    private typealias ResponsibleFor = @convention(c) (pid_t) -> pid_t

    static func current() -> Responsible? {
        // Not public API, so looked up at runtime; without it there's nothing to log.
        guard let sym = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_get_pid_responsible_for_pid") else {
            return nil
        }
        let pid = unsafeBitCast(sym, to: ResponsibleFor.self)(getpid())
        var buffer = [CChar](repeating: 0, count: 4 * Int(MAXPATHLEN))
        guard pid > 0, proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return nil }
        let path = String(cString: buffer)
        let bundlePath = ResponsibleApp.bundlePath(executable: path)
        var info: [String: Any] = [:]
        var code: SecStaticCode?
        if SecStaticCodeCreateWithPath(URL(fileURLWithPath: bundlePath ?? path) as CFURL, [], &code) == errSecSuccess,
           let code {
            var dict: CFDictionary?
            if SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &dict) == errSecSuccess {
                info = (dict as? [String: Any]) ?? [:]
            }
        }
        let flags = (info[kSecCodeInfoFlags as String] as? UInt32) ?? 0
        return Responsible(
            pid: pid,
            path: path,
            bundlePath: bundlePath,
            bundleId: bundlePath.flatMap { Bundle(path: $0)?.bundleIdentifier },
            identifier: info[kSecCodeInfoIdentifier as String] as? String,
            cdhash: (info[kSecCodeInfoUnique as String] as? Data).map { $0.map { String(format: "%02x", $0) }.joined() },
            infoPlistBound: info[kSecCodeInfoPList as String] != nil,
            adhoc: flags & SecCodeSignatureFlags.adhoc.rawValue != 0
        )
    }

    var summary: String {
        "responsible pid \(pid) \(bundlePath ?? path): bundle id \(bundleId ?? "-"), signature identifier "
            + "\(identifier ?? "-"), cdhash \(cdhash.map { String($0.prefix(12)) } ?? "-"), "
            + "\(adhoc ? "ad hoc" : "signed"), Info.plist \(infoPlistBound ? "bound" : "not bound")"
    }
}
