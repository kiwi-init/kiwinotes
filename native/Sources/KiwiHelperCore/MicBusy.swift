import Foundation

/// When the mic gives nothing because another app holds it (#5154: the Meet with the Mac's mic), the person is told
/// which app, instead of a generic "no audio". Pure, for `swift test`; the helper reads who uses the mic.
public enum MicBusy {
    /// The codes a busy mic can end in: no buffer at all, or an engine that wouldn't start.
    static let busyCodes: Set<String> = ["no_audio", "engine_start_failed"]

    /// `mic_busy` and the first other app, when one holds the mic and the recording failed for lack of audio;
    /// otherwise the code as it was and no app.
    public static func classify(_ code: String, otherApps: [String]) -> (code: String, app: String?) {
        guard busyCodes.contains(code), let app = otherApps.first else { return (code, nil) }
        return ("mic_busy", app)
    }

    /// The pill's line (ADR 0005: up to 38 characters).
    public static func message(app: String) -> String {
        let text = "Mic ocupado por \(app)"
        return text.count <= 38 ? text : String(text.prefix(37)) + "…"
    }
}

extension CaptureDiagnostic {
    /// One log line, with the device side only (#5154): never audio or text. `inUseBy`: the other apps taking input
    /// now; `runningSomewhere`: Core Audio says the device runs in some process.
    public func logLine(device: String?, inUseBy: [String], runningSomewhere: Bool?) -> String {
        var parts: [String]
        switch self {
        case let .starting(prepared, hardware):
            parts = ["start", "tap \(prepared.map(\.description) ?? "?")", "device now \(hardware.map(\.description) ?? "?")"]
        case let .formatChanged(from, to):
            parts = ["format changed \(from) → \(to)"]
        case let .startFailed(error, retrying):
            parts = ["engine.start failed: \(error)", retrying ? "retrying with a new engine" : "giving up"]
        case let .ended(reason, buffers, firstBufferMs):
            parts = ["end \(reason)", "\(buffers) buffers", "first \(firstBufferMs.map { "\($0) ms" } ?? "never")"]
        }
        if let device { parts.append("device \(device)") }
        if let runningSomewhere { parts.append(runningSomewhere ? "in use somewhere" : "not in use elsewhere") }
        parts.append(inUseBy.isEmpty ? "no other app on the mic" : "also on the mic: \(inUseBy.joined(separator: ", "))")
        return "diag: " + parts.joined(separator: " · ")
    }
}
