import Foundation

/// The language of the helper's on-screen texts (spec #28171, T28192): the pill, the meeting and dictionary cards and
/// the permission explanations. The app decides it (Ajustes › Geral) and sends `app.locale`, on connect and on each
/// change; until then, Portuguese, as the helper was before.
///
/// The texts live in `Localizable.xcstrings` (this target's resources), by key. A key missing in a language falls back
/// to Portuguese, and a missing resource bundle (a broken build) falls back to the key: the helper never stops for it.
///
/// Not every toolchain compiles the catalog: Swift 6.4 turns it into `pt.lproj`/`en.lproj`, but the CI's (Xcode 26.6,
/// Swift 6.3) only copies the `.xcstrings` into the bundle. Without the `.lproj`, the helper reads that JSON itself.
public enum HelperLocale {
    public static let supported = ["pt", "en"]
    public static let fallback = "pt"

    private static let lock = NSLock()
    nonisolated(unsafe) private static var current = fallback
    nonisolated(unsafe) private static var lprojs: [String: Bundle] = [:]

    /// The language now: `pt` or `en`.
    public static var code: String { lock.withLock { current } }

    /// Switches the language. An unknown one is refused (false) and the current stays.
    @discardableResult
    public static func set(_ code: String) -> Bool {
        guard supported.contains(code) else { return false }
        lock.withLock { current = code }
        return true
    }

    /// The text for `key` in the current language, with `args` in its `%@`/`%lld` slots.
    public static func text(_ key: String, _ args: CVarArg...) -> String {
        text(key, locale: code, args)
    }

    public static func text(_ key: String, locale: String, _ args: [CVarArg] = []) -> String {
        let format = lookup(key, locale) ?? lookup(key, fallback) ?? key
        return args.isEmpty ? format : String(format: format, locale: Locale(identifier: locale), arguments: args)
    }

    /// Whether the catalog has `key` in `locale` itself (no fallback): for the tests.
    public static func has(_ key: String, locale: String) -> Bool { lookup(key, locale) != nil }

    private static func lookup(_ key: String, _ locale: String) -> String? {
        if let bundle = lproj(locale) {
            let value = String(localized: String.LocalizationValue(key), table: "Localizable", bundle: bundle)
            return value == key ? nil : value
        }
        return rawCatalog?[key]?[locale]
    }

    /// The `.xcstrings` as it is, key → language → text, when the build copied it instead of compiling it.
    static let rawCatalog: [String: [String: String]]? = {
        guard let url = resources?.url(forResource: "Localizable", withExtension: "xcstrings") else { return nil }
        return try? parseCatalog(Data(contentsOf: url))
    }()

    /// Reads a string catalog: `strings.<key>.localizations.<lang>.stringUnit.value`.
    static func parseCatalog(_ data: Data) throws -> [String: [String: String]] {
        struct Unit: Decodable { let value: String }
        struct Localization: Decodable { let stringUnit: Unit? }
        struct Entry: Decodable { let localizations: [String: Localization]? }
        struct Catalog: Decodable { let strings: [String: Entry] }
        let catalog = try JSONDecoder().decode(Catalog.self, from: data)
        return catalog.strings.mapValues { entry in
            (entry.localizations ?? [:]).compactMapValues { $0.stringUnit?.value }
        }
    }

    private static func lproj(_ locale: String) -> Bundle? {
        lock.withLock {
            if let cached = lprojs[locale] { return cached }
            guard let path = resources?.path(forResource: locale, ofType: "lproj"), let bundle = Bundle(path: path) else { return nil }
            lprojs[locale] = bundle
            return bundle
        }
    }

    /// SwiftPM's resource bundle for this target. Looked up by hand, not by `Bundle.module`, whose accessor stops the
    /// process when it can't find the bundle. The app ships it next to the helper (`scripts/build-helper.ts`); the tests
    /// find it next to the `.xctest`.
    static let bundleName = "KiwiHelper_KiwiHelperCore.bundle"
    static let resources: Bundle? = {
        let finder = Bundle(for: HelperLocaleFinder.self)
        let dirs: [URL?] = [
            Bundle.main.executableURL?.resolvingSymlinksInPath().deletingLastPathComponent(),
            Bundle.main.resourceURL,
            Bundle.main.bundleURL,
            finder.resourceURL,
            finder.bundleURL.deletingLastPathComponent(),
        ]
        for case let dir? in dirs {
            if let bundle = Bundle(url: dir.appendingPathComponent(bundleName)) { return bundle }
        }
        return nil
    }()
}

private final class HelperLocaleFinder {}
