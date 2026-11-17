import XCTest
@testable import KiwiHelperCore

final class LLMErrorTests: XCTestCase {
    func testCodesFromBothErrorEnums() {
        XCTAssertEqual(LLMErrorCode.from(description: "guardrailViolation(FoundationModels.LanguageModelError.GuardrailViolation(...))"), "llm_refused")
        XCTAssertEqual(LLMErrorCode.from(description: "refusal(FoundationModels.LanguageModelSession.GenerationError.Refusal, ...)"), "llm_refused")
        XCTAssertEqual(LLMErrorCode.from(description: "assetsUnavailable(Context(debugDescription: \"x\"))"), "llm_unavailable")
        XCTAssertEqual(LLMErrorCode.from(description: "unsupportedLanguageOrLocale(...)"), "llm_unsupported_language")
        XCTAssertEqual(LLMErrorCode.from(description: "rateLimited(...)"), "llm_failed")
    }
}
