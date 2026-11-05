import AVFoundation
import AppKit
import ApplicationServices
import CoreGraphics
import KiwiHelperCore
import Security

/// Permissions for dictation and meeting capture. Names match the IPC fields.
enum Permission: String, CaseIterable {
    case microphone
    case accessibility
    case inputMonitoring
    case systemAudio

    var status: String {
        switch self {
        case .systemAudio:
            // No public non-prompting preflight for process taps. Never infer a grant from silence or a successful
            // start: the OS can supply zeroes when denied. Consent is asked only by an explicit meeting start.
            if #available(macOS 14.2, *) { return "undetermined" }
            return "restricted"
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
        case .systemAudio:
            return "Para transcrever o áudio da reunião no Mac, só quando você pede. O áudio é apagado depois de transcrito."
        case .microphone:
            return "Para ouvir o ditado ou sua voz nas reuniões que você pedir para gravar. O áudio não sai do Mac."
        case .accessibility:
            return "Para colar o texto no app em que você está digitando."
        case .inputMonitoring:
            return "Para perceber o atalho de ditado (Fn ou ⌥ direito) em qualquer app. O Kiwi Notes não lê o que você digita."
        }
    }

    var settingsURL: URL {
        let anchor: String
        switch self {
        case .systemAudio: anchor = "Privacy_ScreenCapture"
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

    /// What `PermissionAsk` says, in order: reset, prompt, Settings. On its own, one window at a time; a person's click
    /// (`reset`, only from the app's menu) always ends in something visible (T658, T825).
    func request(reset: Bool = false, completion: @escaping (String) -> Void) {
        // Only a person's explicit click opens Settings. First consent comes from the process-tap aggregate,
        // never from requesting permission to record the screen.
        if self == .systemAudio {
            NSWorkspace.shared.open(settingsURL)
            return completion(status)
        }
        // Who macOS charges is looked up only for a click: the decision (Kiwi Notes only) is in PermissionAsk.
        let responsible = reset ? Responsible.current()?.bundleId : nil
        let ask = PermissionAsk.next(permission: rawValue, state: status, askedBefore: askedBefore, reset: reset,
                                     responsibleBundleId: responsible)
        // A reset that fails still leaves the prompt and Settings to show.
        if ask.reset { _ = resetEntry() }
        guard ask.prompt else {
            if ask.settings != .never { NSWorkspace.shared.open(settingsURL) }
            return completion(status)
        }
        let started = Date()
        prompt { state in
            switch ask.settings {
            case .never:
                completion(state)
            case .after:
                DispatchQueue.main.asyncAfter(deadline: .now() + PermissionAsk.settingsDelay) {
                    NSWorkspace.shared.open(self.settingsURL)
                    completion(self.status)
                }
            case .ifNoPrompt:
                if PermissionAsk.openSettings(granted: state == "granted", elapsed: Date().timeIntervalSince(started)) {
                    NSWorkspace.shared.open(self.settingsURL)
                }
                completion(state)
            }
        }
    }

    /// The system prompt. The microphone's answers when the person clicks; the other two return at once.
    private func prompt(completion: @escaping (String) -> Void) {
        UserDefaults.standard.set(true, forKey: "asked.\(rawValue)")
        switch self {
        case .systemAudio:
            completion(status)
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

    /// `tccutil reset <service> app.kiwinotes.desktop`: Kiwi Notes' own entry, never another app's (review #693).
    private func resetEntry() -> Bool {
        guard let service = TCCService.name(for: rawValue), Responsible.current()?.bundleId == KiwiApp.bundleId else {
            return false
        }
        let bundleId = KiwiApp.bundleId
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
