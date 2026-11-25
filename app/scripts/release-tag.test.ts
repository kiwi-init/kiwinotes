import { describe, expect, test } from "bun:test";

import { judge, type Verdict } from "./main-green.ts";
import { formatDuration, monthOf, pickSha, remoteTags, stageTable, stageTimes, type RunJob } from "./release-tag.ts";

const at = (min: number) => new Date(Date.UTC(2026, 10, 25, 12, min)).toISOString();

describe("release-tag (T29584)", () => {
  test("formatDuration: segundos, minutos e horas", () => {
    expect(formatDuration(38_400)).toBe("38 s");
    expect(formatDuration(245_000)).toBe("4 min 05 s");
    expect(formatDuration(3_720_000)).toBe("1 h 02 min");
    expect(formatDuration(-5)).toBe("0 s");
  });

  test("monthOf: o mês de São Paulo, não o do UTC", () => {
    expect(monthOf(new Date("2026-11-30T23:30:00-03:00"))).toBe("2026-11");
    expect(monthOf(new Date("2026-12-01T00:10:00-03:00"))).toBe("2026-12");
  });

  test("stageTimes: a fila, os jobs que rodaram em ordem, o latest e o total", () => {
    const jobs: RunJob[] = [
      { name: "publish", status: "completed", conclusion: "success", started_at: at(40), completed_at: at(43) },
      { name: "mac", status: "completed", conclusion: "success", started_at: at(5), completed_at: at(38) },
      { name: "on-main", status: "completed", conclusion: "success", started_at: at(1), completed_at: at(2) },
      { name: "helper-cache", status: "completed", conclusion: "skipped", started_at: at(2), completed_at: at(2) },
    ];
    const stages = stageTimes(new Date(at(0)), jobs, new Date(at(44)));
    expect(stages.map((s) => [s.name, s.ms / 60_000])).toEqual([
      ["fila", 1],
      ["on-main", 1],
      ["mac", 33],
      ["publish", 3],
      ["latest", 1],
      ["total", 44],
    ]);
    const table = stageTable("v2026.11.15", stages);
    expect(table).toContain("| mac | 33 min 00 s |");
    expect(table).toContain("| **total** | **44 min 00 s** |");
  });

  test("stageTimes sem o latest (o run falhou): o total vai até o último job", () => {
    const jobs: RunJob[] = [{ name: "mac", status: "completed", conclusion: "failure", started_at: at(3), completed_at: at(10) }];
    expect(stageTimes(new Date(at(0)), jobs, undefined).map((s) => s.name)).toEqual(["fila", "mac", "total"]);
    expect(stageTimes(new Date(at(0)), jobs, undefined).at(-1)!.ms).toBe(10 * 60_000);
  });

  test("remoteTags: os v* do ls-remote, sem o ^{} dos anotados", () => {
    const out = ["aaaa\trefs/tags/updates-rc", "bbbb\trefs/tags/v2026.11.13", "cccc\trefs/tags/v2026.11.14", "dddd\trefs/tags/v2026.11.14^{}"].join("\n");
    expect(remoteTags(out)).toEqual(["v2026.11.13", "v2026.11.14"]);
    expect(remoteTags("")).toEqual([]);
  });

  test("pickSha: o indicado só se verde; sem um, o último verde", () => {
    const green: Verdict = { green: true, sha: "a".repeat(40) };
    const red: Verdict = { green: false, sha: "b".repeat(40), reason: "bun test: failure", url: "https://exemplo/run/1" };
    expect(pickSha("aaaa", () => green, () => undefined)).toBe(green.sha);
    expect(() => pickSha("bbbb", () => red, () => green)).toThrow("bun test: failure (https://exemplo/run/1)");
    expect(pickSha(undefined, () => red, () => green)).toBe(green.sha);
    expect(() => pickSha(undefined, () => green, () => undefined)).toThrow("nenhum commit verde");
  });

  test("as frases de espera do judge() que o ci-green do release.yml espera (o case: ainda está, sem run)", async () => {
    const pending = (v: Verdict) => (v.green ? "" : v.reason);
    expect(pending(judge("a".repeat(40), undefined, undefined))).toContain("sem run");
    const run = { id: 1, head_sha: "a".repeat(40), status: "queued", conclusion: null, html_url: "https://exemplo/run/1" };
    expect(pending(judge("a".repeat(40), run as never, undefined))).toContain("ainda está");
    // E o release.yml ainda espera exatamente essas duas.
    const yml = await Bun.file(new URL("../../.github/workflows/release.yml", import.meta.url)).text();
    expect(yml).toContain(`*"ainda está"*|*"sem run"*) sleep 30 ;;`);
  });
});
