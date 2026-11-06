import Foundation

public struct SpellingResult: Equatable, Sendable {
    public let available: Bool
    public let misspelled: Bool
    public let suggestions: [String]
    public init(available: Bool, misspelled: Bool, suggestions: [String]) {
        self.available = available; self.misspelled = misspelled; self.suggestions = suggestions
    }
    public static let unavailable = SpellingResult(available: false, misspelled: false, suggestions: [])
    public var fields: [String: Any] { ["available": available, "misspelled": misspelled, "suggestions": suggestions] }
}

/// Bounded local requests. The injected checker keeps unit tests independent of the Mac's dictionaries.
public enum LocalSpelling {
    public static func check(_ word: String, language: String? = nil,
                             using checker: (String, String?) -> SpellingResult) -> SpellingResult? {
        guard !word.isEmpty, word.utf16.count <= 128,
              word.range(of: "^\\p{L}[\\p{L}\\p{M}'’-]*$", options: .regularExpression) != nil else { return nil }
        if let language {
            guard language.count <= 32,
                  language.range(of: "^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$", options: .regularExpression) != nil else { return nil }
        }
        let result = checker(word, language)
        guard result.available else { return .unavailable }
        guard result.misspelled else { return SpellingResult(available: true, misspelled: false, suggestions: []) }
        var seen = Set<String>(), suggestions: [String] = []
        for value in result.suggestions.prefix(64) {
            let candidate = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !candidate.isEmpty, candidate != word, candidate.utf16.count <= 128,
                  candidate.rangeOfCharacter(from: CharacterSet.controlCharacters.union(.newlines)) == nil, seen.insert(candidate).inserted else { continue }
            suggestions.append(candidate)
            if suggestions.count == 8 { break }
        }
        return SpellingResult(available: true, misspelled: true, suggestions: suggestions)
    }
}
