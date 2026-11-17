// Portado de OpenWhispr/resources/macos-mic-listener.swift @ ed28e3cc22a4f831abd5cf7c31f4ea275fb76d3c (MIT).
// Mudanças: só o snapshot (`prepareProcessSnapshot`), puro e com leitores injetados, para o `swift test`; ele
// também devolve o bundle id de cada processo que usa o mic, que é como o Kiwi sabe qual app pegou o mic.
// O resto (os listeners do CoreAudio) está em kiwi-helper/MicListener.swift.

/// One read of CoreAudio's process objects: which processes exist and which are taking mic input.
public enum MicUsage {
    /// CoreSpeech also processes ordinary playback, so it is not evidence of a meeting.
    public static let ignoredBundleIds: Set<String> = ["com.apple.CoreSpeech"]

    /// A process can vanish between enumeration and the per-object property queries, so a failing object is skipped
    /// (treated as no longer capturing). Returns nil only when a non-empty process list yields no readable object at
    /// all: a systemic failure where the state can't be trusted.
    public static func snapshot(
        _ objects: [UInt32],
        readPid: (UInt32) -> Int32?,
        readInputRunning: (UInt32) -> Bool?,
        readBundleId: (UInt32) -> String?
    ) -> (pids: [UInt32: Int32], active: Set<MicUser>)? {
        var pids: [UInt32: Int32] = [:]
        var active: Set<MicUser> = []
        for object in objects {
            guard let pid = readPid(object), pid > 0, let running = readInputRunning(object) else { continue }
            pids[object] = pid
            guard running else { continue }
            let bundleId = readBundleId(object) ?? ""
            if !ignoredBundleIds.contains(bundleId) { active.insert(MicUser(pid: pid, bundleId: bundleId)) }
        }
        if !objects.isEmpty, pids.isEmpty { return nil }
        return (pids, active)
    }
}
