import AppKit
import KiwiHelperCore

/// Watches which app is in front (NSWorkspace, no permission needed) for `app.active`.
final class FrontApp {
    var onChange: ((ActiveApp) -> Void)?
    private var filter = ActiveAppFilter(ownPids: [getpid(), getppid()])
    private var observer: NSObjectProtocol?

    /// The app in front right now, Kiwi included (`record.started.app`).
    static var current: ActiveApp? {
        NSWorkspace.shared.frontmostApplication.flatMap(Self.describe)
    }

    /// Announces the current app (unless it's Kiwi), then every change.
    func start() {
        report(Self.current)
        observer = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { [weak self] note in
            let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            self?.report(app.flatMap(Self.describe))
        }
    }

    private func report(_ app: ActiveApp?) {
        if let app = filter.next(app) { onChange?(app) }
    }

    private static func describe(_ app: NSRunningApplication) -> ActiveApp? {
        guard let bundleId = app.bundleIdentifier else { return nil }
        return ActiveApp(bundleId: bundleId, name: app.localizedName ?? bundleId, pid: app.processIdentifier)
    }
}
