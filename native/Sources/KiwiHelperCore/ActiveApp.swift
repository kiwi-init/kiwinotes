/// The app in front, for `app.active` and `record.started.app` (ADR 0001): the cleanup's tone comes from it.
public struct ActiveApp: Equatable, Sendable {
    public let bundleId: String
    public let name: String
    public let pid: Int32

    public init(bundleId: String, name: String, pid: Int32) {
        self.bundleId = bundleId
        self.name = name
        self.pid = pid
    }

    public var fields: [String: Any] { ["bundleId": bundleId, "name": name, "pid": Int(pid)] }
}

/// Which front-app changes become `app.active`: not Kiwi itself (the helper, the app that started it, or any
/// process with Kiwi's bundle id, in case its windows live in another process), since opening Kiwi's window
/// doesn't change where the person dictates; and not the same app twice in a row.
public struct ActiveAppFilter: Sendable {
    /// Kiwi's bundle id (`app/electrobun.config.ts`); dev builds add a suffix to it.
    public static let kiwiBundleId = "app.kiwinotes.desktop"

    /// The helper's pid and its parent's (the Kiwi app that started it).
    public let ownPids: Set<Int32>
    public private(set) var last: ActiveApp?

    public init(ownPids: Set<Int32>) {
        self.ownPids = ownPids
    }

    public static func isKiwi(_ bundleId: String) -> Bool {
        bundleId == kiwiBundleId || bundleId.hasPrefix(kiwiBundleId + ".") || bundleId.hasPrefix(kiwiBundleId + "-")
    }

    /// The app to announce, or nil to stay quiet.
    public mutating func next(_ app: ActiveApp?) -> ActiveApp? {
        guard let app, !app.bundleId.isEmpty, !ownPids.contains(app.pid), !Self.isKiwi(app.bundleId),
              app != last else { return nil }
        last = app
        return app
    }
}
