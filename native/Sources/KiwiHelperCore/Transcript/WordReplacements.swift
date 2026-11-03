// Portado de VoiceInk/VoiceInk/Features/Dictionary/Workflows/WordReplacementService.swift e
// WordReplacementVariants.swift @ 19546d2 (GPL-3.0). Mudanças: as regras vêm de uma lista (lá vinham do
// SwiftData), sem cache nem logs; ficou só o `parse`/`key` das variantes (o detector de ciclos é da tela de edição).

import Foundation

/// "Other ways of saying it" → the right spelling, applied to the transcript after the vocabulary correction
/// (VoiceInk's word replacements; the dictionary's aliases in Kiwi, T57).
public struct WordReplacements: Sendable {
    public struct Rule: Equatable, Sendable {
        /// One or more variants, comma separated ("cube control, kube control").
        public let original: String
        public let replacement: String

        public init(original: String, replacement: String) {
            self.original = original
            self.replacement = replacement
        }
    }

    private struct PreparedRule: @unchecked Sendable {
        let original: String
        let replacement: String
        let regex: NSRegularExpression?
    }

    private let rules: [PreparedRule]

    public var isEmpty: Bool { rules.isEmpty }

    public init(_ rules: [Rule]) {
        // Longest variant first, so "kube control plane" wins over "kube control".
        let sorted = rules.enumerated()
            .flatMap { index, rule in
                Variants.parse(rule.original).map { (original: $0, replacement: rule.replacement, order: index) }
            }
            .sorted {
                if $0.original.count != $1.original.count { return $0.original.count > $1.original.count }
                let left = Variants.key(for: $0.original), right = Variants.key(for: $1.original)
                if left != right { return left < right }
                return $0.order < $1.order
            }
        self.rules = sorted.compactMap { rule in
            guard Self.usesWordBoundaries(for: rule.original) else {
                return PreparedRule(original: rule.original, replacement: rule.replacement, regex: nil)
            }
            // Unicode-aware lookarounds treat punctuation as a boundary while
            // preventing matches inside larger words.
            let escaped = NSRegularExpression.escapedPattern(for: rule.original)
            let wordChar = "[[\\p{L}\\p{M}\\p{N}]-[\\p{scx=Han}\\p{scx=Hiragana}\\p{scx=Katakana}\\p{scx=Hangul}\\p{scx=Thai}]]"
            let pattern = "(?<!\(wordChar))\(escaped)(?!\(wordChar))"
            guard let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) else { return nil }
            return PreparedRule(original: rule.original, replacement: rule.replacement, regex: regex)
        }
    }

    public func apply(to text: String) -> String {
        var modifiedText = text
        for rule in rules {
            if let regex = rule.regex {
                let range = NSRange(modifiedText.startIndex..., in: modifiedText)
                guard regex.numberOfMatches(in: modifiedText, options: [], range: range) > 0 else { continue }
                modifiedText = regex.stringByReplacingMatches(
                    in: modifiedText,
                    options: [],
                    range: range,
                    withTemplate: NSRegularExpression.escapedTemplate(for: rule.replacement)
                )
            } else {
                modifiedText = modifiedText.replacingOccurrences(
                    of: rule.original, with: rule.replacement, options: .caseInsensitive)
            }
        }
        return modifiedText
    }

    private static func usesWordBoundaries(for text: String) -> Bool {
        // Returns false for languages without spaces (CJK, Thai), true for spaced languages
        let nonSpacedScripts: [ClosedRange<UInt32>] = [
            0x3040...0x309F,  // Hiragana
            0x30A0...0x30FF,  // Katakana
            0x4E00...0x9FFF,  // CJK Unified Ideographs
            0xAC00...0xD7AF,  // Hangul Syllables
            0x0E00...0x0E7F,  // Thai
        ]
        return !text.unicodeScalars.contains { scalar in nonSpacedScripts.contains { $0.contains(scalar.value) } }
    }

    enum Variants {
        static func parse(_ text: String) -> [String] {
            deduplicated(
                text
                    .split(separator: ",")
                    .map {
                        $0.trimmingCharacters(in: .whitespacesAndNewlines)
                            .precomposedStringWithCanonicalMapping
                    }
                    .filter { !$0.isEmpty }
            )
        }

        static func key(for text: String) -> String {
            let normalized = text
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .precomposedStringWithCanonicalMapping
            return (normalized as NSString).folding(options: .caseInsensitive, locale: nil)
        }

        private static func deduplicated(_ variants: [String]) -> [String] {
            var seen = Set<String>()
            var result: [String] = []
            for variant in variants {
                let trimmed = variant.trimmingCharacters(in: .whitespacesAndNewlines)
                    .precomposedStringWithCanonicalMapping
                guard !trimmed.isEmpty else { continue }
                let comparisonKey = key(for: trimmed)
                guard !comparisonKey.isEmpty, seen.insert(comparisonKey).inserted else { continue }
                result.append(trimmed)
            }
            return result
        }
    }
}
