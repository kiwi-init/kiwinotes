import Foundation

/// L18: in a browser, the site decides the cleanup's tone (Gmail is email), so `record.started.app` carries the
/// focused window's title and the page's host. Only for the browsers listed here (the same list as the app's
/// `site-tone.ts`): no other app's window title leaves the helper. Only the host goes, never the page's path.
public enum BrowserSite {
    public static let bundleIds: Set<String> = [
        "com.apple.Safari",
        "com.apple.SafariTechnologyPreview",
        "com.google.Chrome",
        "com.google.Chrome.beta",
        "com.google.Chrome.canary",
        "org.chromium.Chromium",
        "org.mozilla.firefox",
        "org.mozilla.firefoxdeveloperedition",
        "com.microsoft.edgemac",
        "company.thebrowser.Browser",
        "company.thebrowser.dia",
        "com.brave.Browser",
        "com.operasoftware.Opera",
        "com.vivaldi.Vivaldi",
        "app.zen-browser.zen",
        "com.kagi.kagimacOS",
        "ai.perplexity.comet",
        "org.mozilla.librewolf",
    ]

    public static func isBrowser(_ bundleId: String) -> Bool { bundleIds.contains(bundleId) }

    /// The host of a page's address, lowercased, or nil for anything that isn't a web page.
    public static func host(of address: String?) -> String? {
        guard let address, let url = URL(string: address.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host, !host.isEmpty else { return nil }
        return host.lowercased()
    }

    /// The `app` of `record.started`: the title and host only for a browser, and only when there is one.
    public static func appFields(bundleId: String, name: String, title: String?, host: String?) -> [String: String] {
        var fields = ["bundleId": bundleId, "name": name]
        guard isBrowser(bundleId) else { return fields }
        if let title = title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty {
            fields["title"] = String(title.prefix(300))
        }
        if let host, !host.isEmpty { fields["urlHost"] = host }
        return fields
    }
}
