import Foundation

/// An app whose use of the microphone means a meeting (R2, #195): "Gravar esta reunião?" names it.
public struct MeetingApp: Equatable, Hashable, Sendable {
    /// The bundle id from the list: a process counts when its own id is this one or starts with it and a dot,
    /// so the browsers' and Teams' helper processes (`com.google.Chrome.helper`) count as the app.
    public let bundleId: String
    public let name: String

    public init(bundleId: String, name: String) {
        self.bundleId = bundleId
        self.name = name
    }

    public var fields: [String: Any] { ["bundleId": bundleId, "name": name] }
}

/// A process that is taking input from a microphone right now (CoreAudio's process objects, macOS 14.2+).
public struct MicUser: Equatable, Hashable, Sendable {
    public let pid: Int32
    public let bundleId: String

    public init(pid: Int32, bundleId: String) {
        self.pid = pid
        self.bundleId = bundleId
    }
}

/// Which apps count as a meeting. The defaults are the spec's (#4823 R2): Teams, Zoom, Webex, Slack and FaceTime,
/// and the browsers where Meet runs. The app can replace the list (`config.set meetingApps`, the settings of R6).
public struct MeetingApps: Sendable {
    public static let defaults: [MeetingApp] = [
        MeetingApp(bundleId: "com.microsoft.teams2", name: "Teams"),
        MeetingApp(bundleId: "com.microsoft.teams", name: "Teams"),
        MeetingApp(bundleId: "us.zoom.xos", name: "Zoom"),
        MeetingApp(bundleId: "Cisco-Systems.Spark", name: "Webex"),
        MeetingApp(bundleId: "com.webex.meetingmanager", name: "Webex"),
        MeetingApp(bundleId: "com.tinyspeck.slackmacgap", name: "Slack"),
        MeetingApp(bundleId: "com.apple.FaceTime", name: "FaceTime"),
        // FaceTime's audio runs in this daemon, not in the FaceTime app.
        MeetingApp(bundleId: "com.apple.avconferenced", name: "FaceTime"),
        MeetingApp(bundleId: "com.google.Chrome", name: "Chrome"),
        MeetingApp(bundleId: "company.thebrowser.Browser", name: "Arc"),
        MeetingApp(bundleId: "com.microsoft.edgemac", name: "Edge"),
        MeetingApp(bundleId: "com.brave.Browser", name: "Brave"),
        MeetingApp(bundleId: "org.mozilla.firefox", name: "Firefox"),
        MeetingApp(bundleId: "com.apple.Safari", name: "Safari"),
        // Safari takes the mic in WebKit's GPU process. Kiwi's own window is WebKit too, but it never takes the mic
        // (the helper does), so this only shows Safari, or another app's web view in a call.
        MeetingApp(bundleId: "com.apple.WebKit.GPU", name: "Safari"),
    ]

    public let apps: [MeetingApp]

    public init(_ apps: [MeetingApp] = MeetingApps.defaults) {
        self.apps = apps
    }

    /// The meeting app a process belongs to, or nil. The longest match wins (`com.microsoft.teams2` over
    /// `com.microsoft.teams`).
    public func match(_ bundleId: String) -> MeetingApp? {
        guard !bundleId.isEmpty else { return nil }
        let id = bundleId.lowercased()
        return apps
            .filter { app in
                let own = app.bundleId.lowercased()
                return id == own || id.hasPrefix(own + ".")
            }
            .max { $0.bundleId.count < $1.bundleId.count }
    }

    /// `config.set meetingApps`: a list of `{bundleId, name}`. Nil when it doesn't parse.
    public static func parse(_ value: Any) -> MeetingApps? {
        guard let list = value as? [Any] else { return nil }
        var apps: [MeetingApp] = []
        for item in list {
            guard let fields = item as? [String: Any],
                  let bundleId = (fields["bundleId"] as? String)?.trimmingCharacters(in: .whitespaces), !bundleId.isEmpty,
                  let name = (fields["name"] as? String)?.trimmingCharacters(in: .whitespaces), !name.isEmpty
            else { return nil }
            apps.append(MeetingApp(bundleId: bundleId, name: name))
        }
        return MeetingApps(apps)
    }
}
