import Foundation

/// Stable `llm.*` error codes for the app (ADR 0001). Foundation Models moved its error enums between
/// macOS 26 and 27 (`LanguageModelSession.GenerationError` → `LanguageModelError`), so this matches
/// on the case name, which is the same in both.
public enum LLMErrorCode {
    public static func from(_ error: Error) -> String { from(description: String(describing: error)) }

    public static func from(description name: String) -> String {
        if name.contains("guardrailViolation") || name.contains("refusal") { return "llm_refused" }
        if name.contains("assetsUnavailable") { return "llm_unavailable" }
        if name.contains("unsupportedLanguageOrLocale") { return "llm_unsupported_language" }
        return "llm_failed"
    }
}
