import Foundation

/// R3, option B of #5131: after the meeting, the VBx (offline, over the whole system channel) corrects who said what.
/// Its clusters take the live labels they overlap most, one to one, so a "Pessoa 1" the person already renamed keeps
/// its name; a cluster the live diarizer never told apart gets a new "Pessoa N". Each system final then moves to the
/// cluster that covers most of it. Pure: the VBx turns come in on the meeting clock (seconds).
public enum SpeakerRelabel {
    public struct Change: Equatable, Sendable {
        public let id: String
        public let start: Double
        public let end: Double
        public let from: String
        public let to: String

        public var fields: [String: Any] { ["id": id, "start": start, "end": end, "channel": "system", "from": from, "to": to] }
    }

    public static func plan(finals: [MeetingSegment], vbx: [SpeakerTimeline.Turn]) -> [Change] {
        let system = finals.filter { $0.channel == .system && $0.final }
        guard !system.isEmpty, !vbx.isEmpty else { return [] }
        func overlap(_ s: MeetingSegment, _ cluster: Int) -> Double {
            vbx.filter { $0.speaker == cluster }.reduce(0) { $0 + max(0, min(s.end, $1.end) - max(s.start, $1.start)) }
        }
        let labels = orderedUnique(system.map(\.speaker))
        let clusters = orderedUnique(vbx.sorted { $0.start < $1.start }.map(\.speaker))

        // The overlap of each live label with each cluster, and a one-to-one match, biggest first.
        var pairs: [(label: String, cluster: Int, seconds: Double)] = []
        for label in labels {
            for cluster in clusters {
                let seconds = system.filter { $0.speaker == label }.reduce(0) { $0 + overlap($1, cluster) }
                if seconds > 0 { pairs.append((label, cluster, seconds)) }
            }
        }
        pairs.sort { $0.seconds != $1.seconds ? $0.seconds > $1.seconds : ($0.label, $0.cluster) < ($1.label, $1.cluster) }
        var nameOf: [Int: String] = [:]
        var taken: Set<String> = []
        for p in pairs where nameOf[p.cluster] == nil && !taken.contains(p.label) {
            nameOf[p.cluster] = p.label
            taken.insert(p.label)
        }
        var next = (labels.compactMap(number).max() ?? 0) + 1
        for cluster in clusters where nameOf[cluster] == nil {
            nameOf[cluster] = "Pessoa \(next)"
            next += 1
        }

        var changes: [Change] = []
        for s in system {
            let best = clusters.map { ($0, overlap(s, $0)) }.max { $0.1 < $1.1 || ($0.1 == $1.1 && $0.0 > $1.0) }
            guard let best, best.1 > 0, let to = nameOf[best.0], to != s.speaker else { continue }
            changes.append(Change(id: s.id, start: s.start, end: s.end, from: s.speaker, to: to))
        }
        return changes
    }

    private static func number(_ label: String) -> Int? {
        guard label.hasPrefix("Pessoa ") else { return nil }
        return Int(label.dropFirst("Pessoa ".count))
    }

    private static func orderedUnique<T: Hashable>(_ items: [T]) -> [T] {
        var seen: Set<T> = []
        return items.filter { seen.insert($0).inserted }
    }
}
