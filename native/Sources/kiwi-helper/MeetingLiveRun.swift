import Foundation
import KiwiHelperCore

/// `kiwi-helper --meeting-live <file.wav> [--realtime] [--output speaker|headphones]` (R3, T4943): the meeting pipeline
/// the app runs, whole (the two streaming ASRs, the live Sortformer, the echo filter, the VBx correction at the end),
/// over a 2-channel 16 kHz WAV (0 = you, 1 = the system) from `spikes/meeting-bench/gen.ts`. No mic, no sound, no
/// spool. It writes what the note would get, as the lines `score.ts` reads (ADR 0009): `word` (each final segment's
/// words, spread over its time, with `firmAt` when it came out) and `spk` (the system segments' speakers, after the
/// correction), plus a `stats` line.
enum MeetingLiveRun {
    struct Options {
        var path: String
        var realtime = false
        var output = "speaker"
        var feedSeconds = 0.1
    }

    private final class Collector: @unchecked Sendable {
        let lock = NSLock()
        var finals: [String: [String: Any]] = [:]
        var order: [String] = []
        var firmAt: [String: Double] = [:]
        var vbx: [SpeakerTimeline.Turn] = []
        var vbxFailed = false
        var warnings: [String] = []
        var fed = 0.0
    }

    static func run(_ o: Options) async -> Int32 {
        let started = Date()
        let channels: [[Float]]
        do {
            channels = try MeetingBench.readStereo(URL(fileURLWithPath: o.path))
        } catch {
            FileHandle.standardError.write(Data("meeting-live: \(error)\n".utf8))
            return 1
        }
        let collected = Collector()
        let system = channels[1]
        let t = LiveMeetingTranscriber(
            session: UUID().uuidString, output: o.output, dictionary: .empty,
            systemAudio: { system },
            emit: { type, fields in
                collected.lock.withLock {
                    switch type {
                    case "meeting.segment" where fields["final"] as? Bool == true:
                        let id = fields["id"] as! String
                        if collected.finals[id] == nil { collected.order.append(id) }
                        collected.finals[id] = fields
                        collected.firmAt[id] = o.realtime ? Date().timeIntervalSince(started) : collected.fed
                    case "meeting.relabel":
                        collected.vbxFailed = fields["failed"] as? Bool == true
                        collected.vbx = (fields["turns"] as? [[String: Any]] ?? []).compactMap { t in
                            guard let sp = t["speaker"] as? Int, let a = t["start"] as? Double, let b = t["end"] as? Double else { return nil }
                            return SpeakerTimeline.Turn(speaker: sp, start: a, end: b)
                        }
                    case "meeting.warning":
                        collected.warnings.append(fields["warning"] as? String ?? "?")
                    case "log":
                        FileHandle.standardError.write(Data("\(fields["message"] ?? "")\n".utf8))
                    default:
                        break
                    }
                }
            })
        let step = Int(o.feedSeconds * StreamClock.sampleRate)
        let count = channels.map(\.count).max() ?? 0
        var offset = 0
        while offset < count {
            for (i, channel) in [MeetingChannel.mine, .system].enumerated() where offset < channels[i].count {
                let n = min(step, channels[i].count - offset)
                t.feed(channel, startFrame: offset, samples: Array(channels[i][offset..<(offset + n)]))
            }
            offset += step
            collected.lock.withLock { collected.fed = Double(offset) / StreamClock.sampleRate }
            if o.realtime {
                let due = Double(offset) / StreamClock.sampleRate - Date().timeIntervalSince(started)
                if due > 0 { try? await Task.sleep(nanoseconds: UInt64(due * 1e9)) }
            }
        }
        await t.finish()

        let (finals, order, firmAt, vbx, vbxFailed, warnings) = collected.lock.withLock {
            (collected.finals, collected.order, collected.firmAt, collected.vbx, collected.vbxFailed, collected.warnings)
        }
        // What the note ends with: each system block goes to the VBx cluster that covers most of it (the app's
        // `planRelabel`; for the speaker error the names don't matter, `score.ts` matches the labels one to one).
        var timeline = SpeakerTimeline()
        timeline.replace(vbx)
        for id in order {
            guard let s = finals[id], let text = s["text"] as? String, let start = s["start"] as? Double, let end = s["end"] as? Double else { continue }
            let channel = s["channel"] as? String == "mine" ? "voce" : "sistema"
            let words = text.split(separator: " ").map(String.init)
            let each = (end - start) / Double(max(1, words.count))
            for (i, w) in words.enumerated() {
                var line: [String: Any] = ["type": "word", "channel": channel, "start": start + Double(i) * each, "end": start + Double(i + 1) * each, "text": w]
                if o.realtime, let firm = firmAt[id] { line["firmAt"] = firm }
                MeetingBench.emit(line)
            }
            if channel == "sistema" {
                let corrected = timeline.speaker(from: start, to: end).map { "vbx-\($0)" }
                MeetingBench.emit(["type": "spk", "speaker": corrected ?? (s["speaker"] as? String ?? "?"), "start": start, "end": end])
            }
        }
        MeetingBench.emit([
            "type": "stats", "file": (o.path as NSString).lastPathComponent, "asr": "live", "diarizer": "sortformer+vbx",
            "audioSeconds": Double(count) / StreamClock.sampleRate, "realtime": o.realtime, "output": o.output,
            "wallSeconds": Date().timeIntervalSince(started), "cpuSeconds": MeetingBench.cpuSeconds(),
            "peakFootprintMB": MeetingBench.peakFootprintMB(), "segments": order.count, "vbxSpeakers": Set(vbx.map(\.speaker)).count, "vbxFailed": vbxFailed, "warnings": warnings,
        ])
        return 0
    }
}
