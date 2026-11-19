import Foundation

/// L23: where a paste landed in the field, so an edit right after it can be read back as "this is what the person
/// put in place of what Kiwi pasted". Only the pasted stretch: the text before and after it must stay as it was, or
/// the edit isn't about the dictation and nothing is reported.
public struct PastedRegion: Equatable, Sendable {
    public let prefix: String
    public let pasted: String
    public let suffix: String

    /// The field before and right after the ⌘V. The paste is where the two first differ; it must be exactly the
    /// pasted text (a leading space Kiwi added counts).
    public static func locate(before: String, after: String, pasted: String) -> PastedRegion? {
        guard !pasted.isEmpty, after.count == before.count + pasted.count else { return nil }
        let start = zip(before, after).prefix { $0 == $1 }.count
        let a = Array(after)
        guard start + pasted.count <= a.count, String(a[start..<(start + pasted.count)]) == pasted else { return nil }
        let prefix = String(a[0..<start])
        let suffix = String(a[(start + pasted.count)...])
        guard before == prefix + suffix else { return nil }
        return PastedRegion(prefix: prefix, pasted: pasted, suffix: suffix)
    }

    /// Why `locate` found nothing, for the log (issue #1): only a reason and counts, never the text.
    /// `count(+N/M)`: the field grew by N characters for M pasted; `moved`: the change isn't the pasted text where the
    /// field first differs; `around`: the text around the paste isn't what was there before.
    public static func whyNotLocated(before: String, after: String, pasted: String) -> String {
        if pasted.isEmpty { return "empty" }
        let grew = after.count - before.count
        guard grew == pasted.count else { return "count(\(grew >= 0 ? "+" : "")\(grew)/\(pasted.count))" }
        let start = zip(before, after).prefix { $0 == $1 }.count
        let a = Array(after)
        guard start + pasted.count <= a.count, String(a[start..<(start + pasted.count)]) == pasted else { return "moved" }
        return "around"
    }

    /// The pasted stretch as it reads now, or nil when it didn't change or the text around it did.
    public func edited(_ now: String) -> String? {
        guard now.hasPrefix(prefix), now.hasSuffix(suffix), now.count >= prefix.count + suffix.count else { return nil }
        let chars = Array(now)
        let middle = String(chars[prefix.count..<(chars.count - suffix.count)])
        return middle == pasted ? nil : middle
    }
}

/// When to report an edit: once it has stopped changing for a moment, inside a short window after the paste.
public enum PasteEditWatch {
    /// How long after the paste an edit still counts as correcting it.
    public static let window: TimeInterval = 20
    /// How often the field is read.
    public static let interval: TimeInterval = 0.7
    /// The edit is reported after it stayed the same this long (the person stopped typing).
    public static let settle: TimeInterval = 1.5
}

/// L23 and issue #1: the decision of the watch after a paste, one field read at a time, so a test can drive it with
/// fake reads. `wait` keeps reading; `report` sends the edited stretch; `stop` ends with nothing and says why.
public struct PasteEditWatcher {
    /// One read of the focused field: its element and text, or nothing (no focused text field).
    public enum Read: Equatable, Sendable {
        case field(element: Int, value: String?)
        case none
    }

    public enum Step: Equatable, Sendable {
        case wait
        case report(String)
        /// Why it ended without an edit: `superseded` (a new paste), `focus_left`, `element_changed`, `unreadable`,
        /// `around_changed` (the text before or after the paste changed), `emptied` (the stretch was cleared, as when
        /// a message is sent), `window` (the time ran out).
        case stop(String)
    }

    public let region: PastedRegion
    public let element: Int
    public private(set) var reads = 0
    /// How many different versions of the stretch were seen, the original included only once.
    public private(set) var changes = 0
    private var last: String?
    private var changedAt: TimeInterval
    private var stable = 0

    public init(region: PastedRegion, element: Int, start: TimeInterval) {
        self.region = region
        self.element = element
        changedAt = start
    }

    /// One read, taken at `now`. `current` is false when a newer paste took over.
    public mutating func read(_ read: Read, at now: TimeInterval, current: Bool = true) -> Step {
        guard current else { return .stop("superseded") }
        reads += 1
        guard case let .field(element, value) = read else { return end("focus_left") }
        guard element == self.element else { return end("element_changed") }
        guard let value else { return end("unreadable") }
        guard value.hasPrefix(region.prefix), value.hasSuffix(region.suffix) else { return end("around_changed") }
        guard value.count > region.prefix.count + region.suffix.count else { return end("emptied") }
        let edited = region.edited(value)
        if edited != last {
            if edited != nil { changes += 1 }
            last = edited
            changedAt = now
            stable = 1
            return .wait
        }
        stable += 1
        if let edited, now - changedAt >= PasteEditWatch.settle { return .report(edited) }
        return .wait
    }

    /// The watch ended (the window ran out, or a read ended it): the stretch as it last read, if an edit was seen in
    /// two reads in a row, or the reason.
    public func end(_ reason: String) -> Step {
        if let last, stable >= 2 { return .report(last) }
        return .stop(reason)
    }
}
