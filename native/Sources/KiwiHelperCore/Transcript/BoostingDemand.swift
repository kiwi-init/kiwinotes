/// When the CTC model of the vocabulary boosting is in RAM (T20949, spec #20887). The 110M CTC only helps with the
/// dictionary's terms, so it loads with the first term and leaves RAM when the last one is gone; the file stays on
/// disk, and a new term loads it again without downloading. Without terms, nothing is downloaded or loaded.
public enum BoostingDemand {
    public enum Action: Equatable, Sendable {
        case none
        /// Download (the first time) and load the CTC model.
        case load
        /// Drop the CTC model and its session from RAM.
        case release
    }

    /// What to do now. `loaded`: the model is in RAM; `loading`: a load is running; `failedRecently`: the last load
    /// failed less than `ctcRetryAfter` ago (offline), so an offline Mac doesn't try on every dictation.
    public static func action(enabled: Bool, hasTerms: Bool, loaded: Bool, loading: Bool, failedRecently: Bool) -> Action {
        guard enabled else { return .none }
        if !hasTerms { return loaded ? .release : .none }
        if loaded || loading || failedRecently { return .none }
        return .load
    }

    /// A load that ends after the last term was removed doesn't stay in RAM.
    public static func keepAfterLoad(hasTerms: Bool) -> Bool { hasTerms }
}
