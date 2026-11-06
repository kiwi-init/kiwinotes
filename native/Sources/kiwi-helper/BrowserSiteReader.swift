import ApplicationServices
import KiwiHelperCore

/// L18: reads, by accessibility, the focused window's title and the page address of a browser in front, for the
/// cleanup's tone. Never asks for the permission (no dialog): without it, nothing is read. Short timeouts, since it
/// runs as the recording starts.
enum BrowserSiteReader {
    static func read(_ app: ActiveApp) -> (title: String?, host: String?) {
        guard BrowserSite.isBrowser(app.bundleId), AXIsProcessTrusted() else { return (nil, nil) }
        let element = AXUIElementCreateApplication(app.pid)
        AXUIElementSetMessagingTimeout(element, 0.15)
        let window: AXUIElement? = copy(element, kAXFocusedWindowAttribute)
        let title: String? = window.flatMap { copy($0, kAXTitleAttribute) }
        return (title, BrowserSite.host(of: pageAddress(element, window)))
    }

    /// Chromium and Safari expose the page's URL on the web area around the focused element; Safari also on the
    /// window's document.
    private static func pageAddress(_ app: AXUIElement, _ window: AXUIElement?) -> String? {
        var node: AXUIElement? = copy(app, kAXFocusedUIElementAttribute)
        for _ in 0..<30 {
            guard let current = node else { break }
            if let role: String = copy(current, kAXRoleAttribute), role == "AXWebArea" {
                if let url: URL = copy(current, kAXURLAttribute) { return url.absoluteString }
                if let text: String = copy(current, kAXURLAttribute) { return text }
            }
            node = copy(current, kAXParentAttribute)
        }
        if let window, let document: String = copy(window, kAXDocumentAttribute) { return document }
        return nil
    }

    private static func copy<T>(_ element: AXUIElement, _ attribute: String) -> T? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success, let value else { return nil }
        if T.self == AXUIElement.self {
            guard CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
            return (value as! AXUIElement) as? T
        }
        return value as? T
    }
}
