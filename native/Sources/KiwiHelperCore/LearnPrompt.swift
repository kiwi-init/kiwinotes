import Foundation

/// L26 (T6910, harry in #6906): the app offers a correction made right after a paste ("Pax" → "PACS") and the person
/// answers on a small card by the pill. Only the state lives here, so it is testable without a screen: which offer is
/// up, its answer, and when it runs out. The card itself is `LearnPanel` in the executable.
public struct LearnOffer: Equatable {
    public let from: String
    public let to: String

    public init(from: String, to: String) {
        self.from = from
        self.to = to
    }

    /// The longest side the card takes; the app only sends a term's swap (up to 3 words each side).
    public static let maxLength = 80

    /// `learn.offer {from, to}` from the app, or nil when a side is empty, too long or the same as the other.
    public static func parse(_ fields: [String: Any]) -> LearnOffer? {
        guard let from = (fields["from"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
              let to = (fields["to"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !from.isEmpty, !to.isEmpty, from != to,
              from.count <= maxLength, to.count <= maxLength else { return nil }
        return LearnOffer(from: from, to: to)
    }
}

public enum LearnAnswer: String {
    /// "Adicionar": the app saves the swap in the dictionary.
    case add
    /// "Agora não": the app never offers this swap again.
    case notNow
    /// Nobody answered in time, a newer offer took its place, or a dictation started: the app may offer it again.
    case expired
}

public final class LearnPrompt {
    /// How long the card waits for an answer.
    public static let timeout: TimeInterval = 10

    /// The offer on the card now, or nil (the card is hidden).
    public private(set) var current: LearnOffer?
    /// The card shows `current` (or hides, with nil).
    public var onChange: ((LearnOffer?) -> Void)?
    /// What the person answered, for the `learn.answered` event.
    public var onAnswer: ((LearnOffer, LearnAnswer) -> Void)?

    private let schedule: (TimeInterval, @escaping () -> Void) -> Void
    private var generation = 0

    /// `schedule` runs a closure after a delay (the main queue in the helper, a fake clock in the tests).
    public init(schedule: @escaping (TimeInterval, @escaping () -> Void) -> Void) {
        self.schedule = schedule
    }

    /// Puts an offer on the card. One that was still up expires: only the newest correction is asked about.
    public func offer(_ offer: LearnOffer) {
        if let old = current, old != offer { onAnswer?(old, .expired) }
        current = offer
        generation += 1
        let mine = generation
        onChange?(offer)
        schedule(Self.timeout) { [weak self] in
            guard let self, self.generation == mine else { return }
            self.answer(.expired)
        }
    }

    /// The person answered (or the time ran out). False when no offer is up.
    @discardableResult
    public func answer(_ answer: LearnAnswer) -> Bool {
        guard let offer = current else { return false }
        current = nil
        generation += 1
        onChange?(nil)
        onAnswer?(offer, answer)
        return true
    }

    /// A dictation started: the card gives the place to the pill and the offer expires.
    public func dictationStarted() {
        answer(.expired)
    }
}
