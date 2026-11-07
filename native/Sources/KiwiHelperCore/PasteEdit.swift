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
