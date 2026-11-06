import AppKit
import KiwiHelperCore

/// Cocoa's data API only: no spelling panel, automatic replacement, preferences or dictionary writes.
enum NativeSpelling {
    static func check(_ word: String, language: String?) -> SpellingResult {
        MainActor.assumeIsolated {
            let checker = NSSpellChecker.shared
            let available = checker.availableLanguages
            guard !available.isEmpty else { return .unavailable }
            let chosen: String?
            if let language {
                let normalized = language.replacingOccurrences(of: "-", with: "_").lowercased()
                let base = normalized.split(separator: "_").first.map(String.init)!
                guard let match = available.first(where: { $0.lowercased() == normalized })
                    ?? available.first(where: { $0.lowercased().split(separator: "_").first.map(String.init) == base }) else { return .unavailable }
                chosen = match
            } else { chosen = nil }
            let range = checker.checkSpelling(of: word, startingAt: 0, language: chosen, wrap: false, inSpellDocumentWithTag: 0, wordCount: nil)
            let misspelled = range.location != NSNotFound
            let guesses = misspelled ? checker.guesses(forWordRange: NSRange(location: 0, length: (word as NSString).length),
                                                       in: word, language: chosen, inSpellDocumentWithTag: 0) ?? [] : []
            return SpellingResult(available: true, misspelled: misspelled, suggestions: guesses)
        }
    }
}
