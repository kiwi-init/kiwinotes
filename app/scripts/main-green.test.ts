import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { type Job, judge, MAIN_JOBS, newestPerSha, pickLastGreen, type Run } from "./main-green.ts";

const ok = (): Job[] => MAIN_JOBS.map((name) => ({ name, conclusion: "success" }));
const run = (id: number, sha: string, conclusion: string | null, status = "completed", created_at = `2026-01-01T00:0${id}:00Z`): Run => ({ id, head_sha: sha, status, conclusion, created_at });

describe("judge: um sha da main está verde?", () => {
  test("verde com o run success e todos os jobs esperados success", () => {
    expect(judge("aaa", run(1, "aaa", "success"), ok())).toEqual({ green: true, sha: "aaa" });
  });

  test("sem run, rodando, cancelado e vermelho não estão verdes, cada um com o motivo", () => {
    const why = (v: ReturnType<typeof judge>) => (v.green ? "" : v.reason);
    expect(why(judge("aaa", undefined, undefined))).toContain("sem run");
    expect(why(judge("aaa", run(1, "aaa", null, "in_progress"), undefined))).toContain("in_progress");
    expect(why(judge("aaa", run(1, "aaa", "cancelled"), undefined))).toContain("cancelado");
    expect(why(judge("aaa", run(1, "aaa", "failure"), undefined))).toContain("failure");
  });

  test("um job esperado que falta ou não saiu success barra, mesmo com o run success", () => {
    const semSwift = ok().filter((j) => j.name !== "swift test");
    const v1 = judge("aaa", run(1, "aaa", "success"), semSwift);
    expect(v1).toMatchObject({ green: false, reason: "swift test: falta" });
    const pulado = ok().map((j) => (j.name === "bun test" ? { ...j, conclusion: "skipped" } : j));
    expect(judge("aaa", run(1, "aaa", "success"), pulado)).toMatchObject({ green: false, reason: "bun test: skipped" });
  });

  test("um job de fora da lista não conta", () => {
    expect(judge("aaa", run(1, "aaa", "success"), [...ok(), { name: "outro", conclusion: "failure" }]).green).toBe(true);
  });
});

describe("pickLastGreen: o commit verde mais novo", () => {
  // A main, do mais novo ao mais velho: ddd rodando, ccc cancelado (o merge do ddd cancelou), bbb e aaa verdes.
  const commits = ["ddd", "ccc", "bbb", "aaa"];
  const runs = [run(4, "ddd", null, "in_progress"), run(3, "ccc", "cancelled"), run(2, "bbb", "success"), run(1, "aaa", "success")];

  test("pula o que roda e o cancelado, e fica com o mais novo verde", () => {
    expect(pickLastGreen(commits, runs, ok)).toEqual({ green: true, sha: "bbb" });
  });

  test("um run success com um job vermelho na última tentativa não serve: vai ao anterior", () => {
    const jobsOf = (r: Run) => (r.head_sha === "bbb" ? ok().map((j) => (j.name === "typecheck" ? { ...j, conclusion: "failure" } : j)) : ok());
    expect(pickLastGreen(commits, runs, jobsOf)).toEqual({ green: true, sha: "aaa" });
  });

  test("nenhum verde: undefined", () => {
    expect(pickLastGreen(["ccc"], [run(3, "ccc", "cancelled")], ok)).toBeUndefined();
  });

  test("dois runs no mesmo sha: vale o mais novo", () => {
    const twice = [run(1, "aaa", "success", "completed", "2026-01-01T00:01:00Z"), run(5, "aaa", "failure", "completed", "2026-01-01T00:05:00Z")];
    expect(newestPerSha(twice).get("aaa")?.id).toBe(5);
    expect(pickLastGreen(["aaa"], twice, ok)).toBeUndefined();
  });
});

test("os jobs esperados são os nomes do ci.yml", () => {
  const yml = readFileSync(path.join(import.meta.dir, "..", "..", ".github", "workflows", "ci.yml"), "utf8");
  const names = [...yml.matchAll(/^ {2}[a-z][a-z-]*:\n {4}name: (.+)$/gm)].map((m) => m[1]);
  expect(names.sort()).toEqual([...MAIN_JOBS].sort());
});
