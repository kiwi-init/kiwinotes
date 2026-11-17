import ApplicationServices
import Foundation
import KiwiHelperCore

/// L18: reads, by accessibility, the focused window's title and the page address of a browser in front, for the
/// cleanup's tone. Never asks for the permission (no dialog): without it, nothing is read. The whole read has a budget
/// (`budget`): every element read gets the time left as its own timeout, so a busy or frozen browser costs at most
/// that. It runs off the mic's path anyway (`Helper.reportSite`).
enum BrowserSiteReader {
    static let budget: TimeInterval = 0.15

    static func read(_ app: ActiveApp) -> (title: String?, host: String?) {
        guard BrowserSite.isBrowser(app.bundleId), AXIsProcessTrusted() else { return (nil, nil) }
        var clock = Budget(until: ProcessInfo.processInfo.systemUptime + budget)
        let element = AXUIElementCreateApplication(app.pid)
        let window: AXUIElement? = clock.copy(element, kAXFocusedWindowAttribute)
        let title: String? = window.flatMap { clock.copy($0, kAXTitleAttribute) }
        return (title, BrowserSite.host(of: pageAddress(element, window, &clock)))
    }

    /// Chromium and Safari expose the page's URL on the web area around the focused element; Safari also on the
    /// window's document.
    private static func pageAddress(_ app: AXUIElement, _ window: AXUIElement?, _ clock: inout Budget) -> String? {
        var node: AXUIElement? = clock.copy(app, kAXFocusedUIElementAttribute)
        for _ in 0..<30 {
            guard let current = node, !clock.spent else { break }
            if let role: String = clock.copy(current, kAXRoleAttribute), role == "AXWebArea" {
                if let url: URL = clock.copy(current, kAXURLAttribute) { return url.absoluteString }
                if let text: String = clock.copy(current, kAXURLAttribute) { return text }
            }
            node = clock.copy(current, kAXParentAttribute)
        }
        if let window, let document: String = clock.copy(window, kAXDocumentAttribute) { return document }
        return nil
    }

    /// What's left of the read's time: each element gets it as its messaging timeout before being asked.
    private struct Budget {
        let until: TimeInterval

        var spent: Bool { ProcessInfo.processInfo.systemUptime >= until }

        mutating func copy<T>(_ element: AXUIElement, _ attribute: String) -> T? {
            let left = until - ProcessInfo.processInfo.systemUptime
            guard left > 0 else { return nil }
            AXUIElementSetMessagingTimeout(element, Float(left))
            var value: CFTypeRef?
            guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success, let value else { return nil }
            if T.self == AXUIElement.self {
                guard CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
                return (value as! AXUIElement) as? T
            }
            return value as? T
        }
    }
}
