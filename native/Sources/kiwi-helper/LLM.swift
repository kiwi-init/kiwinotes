import Foundation
import KiwiHelperCore
#if canImport(FoundationModels)
import FoundationModels
#endif

/// `llm.complete` and `llm.prewarm` (ADR 0001) on Apple Foundation Models, on-device only:
/// `SystemLanguageModel.default`, never the Private Cloud Compute model (nothing leaves the Mac).
/// Every completion runs in a fresh session, so no context carries over between dictations.
/// Everything here is called on the main thread; replies come back on the main thread.
final class LLM {
    typealias Reply = (_ ok: Bool, _ error: String?, _ fields: [String: Any]) -> Void

    /// `{available, reason?}` for `ready` and `permissions.changed`.
    var status: [String: Any] {
        #if canImport(FoundationModels)
        if #available(macOS 26, *) {
            switch SystemLanguageModel.default.availability {
            case .available:
                return ["available": true]
            case .unavailable(let reason):
                return ["available": false, "reason": Self.code(reason)]
            @unknown default:
                return ["available": false, "reason": "modelNotReady"]
            }
        }
        #endif
        return ["available": false, "reason": "deviceNotEligible"]
    }

    var isAvailable: Bool { status["available"] as? Bool == true }

    #if canImport(FoundationModels)
    /// A session made by `llm.prewarm`, handed to the next `llm.complete` with the same instructions.
    /// It has no transcript yet, so using it still counts as a fresh session.
    private var warm: (system: String, session: AnyObject)?

    @available(macOS 26, *)
    private static func code(_ reason: SystemLanguageModel.Availability.UnavailableReason) -> String {
        switch reason {
        case .deviceNotEligible: return "deviceNotEligible"
        case .appleIntelligenceNotEnabled: return "appleIntelligenceNotEnabled"
        case .modelNotReady: return "modelNotReady"
        @unknown default: return "modelNotReady"
        }
    }
    #endif

    func handle(_ message: InboundMessageFields, reply: @escaping Reply) {
        switch message.type {
        case "llm.prewarm":
            guard let system = message.string("system") else { return reply(false, "bad_message", [:]) }
            prewarm(system: system)
            reply(true, nil, [:])
        case "llm.complete":
            guard let system = message.string("system"), let prompt = message.string("prompt") else {
                return reply(false, "bad_message", [:])
            }
            complete(
                system: system,
                prompt: prompt,
                maxTokens: message.double("maxTokens").map { max(1, Int($0)) },
                temperature: message.double("temperature"),
                timeoutMs: message.double("timeoutMs").map { max(1, Int($0)) } ?? 5000,
                reply: reply
            )
        default:
            reply(false, "unknown_type", [:])
        }
    }

    private func unavailable(_ reply: Reply) {
        reply(false, "llm_unavailable", ["reason": status["reason"] ?? "modelNotReady"])
    }

    private func prewarm(system: String) {
        #if canImport(FoundationModels)
        if #available(macOS 26, *), isAvailable {
            let session = LanguageModelSession(model: .default, instructions: system)
            session.prewarm()
            warm = (system, session)
        }
        #endif
    }

    private func complete(system: String, prompt: String, maxTokens: Int?, temperature: Double?, timeoutMs: Int, reply: @escaping Reply) {
        #if canImport(FoundationModels)
        guard #available(macOS 26, *), isAvailable else { return unavailable(reply) }
        let session: LanguageModelSession
        if let warm, warm.system == system, let s = warm.session as? LanguageModelSession {
            session = s
        } else {
            session = LanguageModelSession(model: .default, instructions: system)
        }
        warm = nil
        let options: GenerationOptions = (temperature ?? 0) <= 0
            ? GenerationOptions(samplingMode: .greedy, maximumResponseTokens: maxTokens)
            : GenerationOptions(temperature: temperature, maximumResponseTokens: maxTokens)

        let started = ProcessInfo.processInfo.systemUptime
        let elapsedMs = { Int(((ProcessInfo.processInfo.systemUptime - started) * 1000).rounded()) }
        var answered = false
        let answerOnce: Reply = { ok, error, fields in
            DispatchQueue.main.async {
                guard !answered else { return }
                answered = true
                reply(ok, error, fields)
            }
        }
        let generation = Task {
            do {
                let response = try await session.respond(to: prompt, options: options)
                answerOnce(true, nil, ["text": response.content, "ms": elapsedMs()])
            } catch is CancellationError {
                // The timeout already answered.
            } catch {
                answerOnce(false, LLMErrorCode.from(error), ["ms": elapsedMs()])
            }
        }
        // Past the deadline, cancel the generation: otherwise it keeps the Neural Engine busy and delays the next one.
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(timeoutMs)) {
            guard !answered else { return }
            generation.cancel()
            answerOnce(false, "llm_timeout", ["ms": elapsedMs()])
        }
        #else
        unavailable(reply)
        #endif
    }
}

/// What `LLM.handle` needs from an inbound message (keeps it testable without a socket).
protocol InboundMessageFields {
    var type: String { get }
    func string(_ key: String) -> String?
    func double(_ key: String) -> Double?
}

extension InboundMessage: InboundMessageFields {}
