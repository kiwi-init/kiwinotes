// O último sha verde da `main` (spec #29579, T29585). Desde o spec, o CI da `main` cancela a suíte do commit anterior
// quando entra outro merge: um commit cancelado não tem resultado, e o tag só vai num commit com o run completo e verde.
// É o desenho do portão `ci-green` do Channels (kiwi-init/channels, .github/actions/ci-green/gate.sh): o run do `ci.yml`
// de um push na `main` naquele sha, a última tentativa dele, e cada job esperado com `success`.
//
//   bun scripts/main-green.ts            # o sha verde mais novo da `main` (sai 1 se não há nenhum entre os últimos)
//   bun scripts/main-green.ts <sha>      # se este sha está verde, e por quê não (sai 0 se está, 1 se não)
//
// O `release-tag.ts` (T29584) importa `lastGreenSha` e `checkSha`.
import { spawnSync } from "node:child_process";

import { REQUIRED } from "./merge-gate.ts";

/** Os jobs do `ci.yml` que um push na `main` roda inteiros (lá nada é pulado: a lista do `changes` vai vazia). */
export const MAIN_JOBS = ["changes", ...REQUIRED];

/** Um run do `ci.yml`, como a API do GitHub devolve (`actions/workflows/ci.yml/runs`). */
export interface Run {
  id: number;
  head_sha: string;
  status: string;
  conclusion: string | null;
  run_attempt?: number;
  created_at?: string;
  html_url?: string;
}

/** Um job da última tentativa de um run. */
export interface Job {
  name: string;
  conclusion: string | null;
}

export type Verdict = { green: true; sha: string; url?: string } | { green: false; sha: string; reason: string; url?: string };

/** Se um run (já com os jobs da última tentativa) deixa o sha verde. Sem rede: o teste passa os dados. */
export function judge(sha: string, run: Run | undefined, jobs: Job[] | undefined, expected = MAIN_JOBS): Verdict {
  if (!run) return { green: false, sha, reason: "sem run do ci.yml num push na main neste sha" };
  const url = run.html_url;
  if (run.status !== "completed") return { green: false, sha, url, reason: `o run ainda está ${run.status}` };
  if (run.conclusion === "cancelled") return { green: false, sha, url, reason: "o run foi cancelado (entrou um merge depois): sem resultado" };
  if (run.conclusion !== "success") return { green: false, sha, url, reason: `o run saiu ${run.conclusion ?? "sem conclusão"}` };
  const all = jobs ?? [];
  const bad = [
    ...expected.filter((name) => !all.some((j) => j.name === name)).map((name) => `${name}: falta`),
    ...all.filter((j) => expected.includes(j.name) && j.conclusion !== "success").map((j) => `${j.name}: ${j.conclusion ?? "sem conclusão"}`),
  ];
  if (bad.length) return { green: false, sha, url, reason: bad.join(", ") };
  return { green: true, sha, url };
}

/** O run mais novo de cada sha (um rerun pela UI cria outra tentativa, não outro run; um push repetido, sim). */
export function newestPerSha(runs: Run[]): Map<string, Run> {
  const out = new Map<string, Run>();
  for (const r of runs) {
    const had = out.get(r.head_sha);
    if (!had || (r.created_at ?? "") > (had.created_at ?? "") || ((r.created_at ?? "") === (had.created_at ?? "") && r.id > had.id)) out.set(r.head_sha, r);
  }
  return out;
}

/** O primeiro verde na ordem dos commits (o mais novo primeiro). `jobsOf` só é chamado para os runs `success`. */
export function pickLastGreen(commits: string[], runs: Run[], jobsOf: (run: Run) => Job[]): Verdict | undefined {
  const bySha = newestPerSha(runs);
  for (const sha of commits) {
    const run = bySha.get(sha);
    if (run?.status !== "completed" || run.conclusion !== "success") continue;
    const v = judge(sha, run, jobsOf(run));
    if (v.green) return v;
  }
  return undefined;
}

function gh(args: string[]): string {
  const r = spawnSync("gh", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(" ")}: ${r.stderr.trim()}`);
  return r.stdout;
}

function repo(): string {
  return process.env.GITHUB_REPOSITORY ?? gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
}

function mainRuns(r: string, sha?: string): Run[] {
  const q = `repos/${r}/actions/workflows/ci.yml/runs?event=push&branch=main&per_page=50${sha ? `&head_sha=${sha}` : ""}`;
  return (JSON.parse(gh(["api", q])) as { workflow_runs: Run[] }).workflow_runs;
}

function jobs(r: string, run: Run): Job[] {
  const q = `repos/${r}/actions/runs/${run.id}/attempts/${run.run_attempt ?? 1}/jobs?per_page=100`;
  return (JSON.parse(gh(["api", q])) as { jobs: Job[] }).jobs.map((j) => ({ name: j.name, conclusion: j.conclusion }));
}

/** Se um sha da `main` está verde: o sha inteiro ou o começo dele. */
export function checkSha(sha: string): Verdict {
  const r = repo();
  const full = gh(["api", `repos/${r}/commits/${sha}`, "--jq", ".sha"]).trim();
  const run = newestPerSha(mainRuns(r, full)).get(full);
  return judge(full, run, run?.status === "completed" && run.conclusion === "success" ? jobs(r, run) : undefined);
}

/** O sha verde mais novo entre os últimos `limit` commits da `main`. */
export function lastGreenSha(limit = 30): Verdict | undefined {
  const r = repo();
  const commits = (JSON.parse(gh(["api", `repos/${r}/commits?sha=main&per_page=${limit}`])) as { sha: string }[]).map((c) => c.sha);
  return pickLastGreen(commits, mainRuns(r), (run) => jobs(r, run));
}

if (import.meta.main) {
  const sha = process.argv[2];
  const v = sha ? checkSha(sha) : lastGreenSha();
  if (!v) {
    console.log("nenhum commit verde entre os últimos 30 da main");
    process.exit(1);
  }
  console.log(v.green ? `${v.sha} verde${v.url ? `: ${v.url}` : ""}` : `${v.sha} não está verde: ${v.reason}${v.url ? ` (${v.url})` : ""}`);
  process.exit(v.green ? 0 : 1);
}
