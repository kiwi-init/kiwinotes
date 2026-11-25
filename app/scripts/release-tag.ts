// O comando do releaser (spec #29579, T29584): do "pode soltar" ao "latest" num comando só, sem o PR da versão.
//
// 1. o sha: o que o lead indicou ou o último verde da `main` (`main-green.ts`, T29585), conferido verde e na `main`;
// 2. o tag: o próximo do mês (`update-feed.ts next`), criado nesse sha e enviado;
// 3. o `release.yml` do tag: confere o tag na `main` e o CI verde, carimba a versão do tag no package.json do build,
//    assina, notariza e publica. O comando acompanha cada job e imprime o tempo de cada etapa;
// 4. o fim: o release vira o "latest", de onde o app instalado lê o feed.
//
//   bun scripts/release-tag.ts               # o último sha verde da main
//   bun scripts/release-tag.ts <sha>         # um sha certo (verde e na main)
//   bun scripts/release-tag.ts --dry-run     # só diz o sha e o tag, sem criar nada
//
// Pegue o lease antes (`kiwi lock release-tag --ttl 1h`) e só com o ok do harry (AGENTS.md › Releases).
import { spawnSync } from "node:child_process";

import { checkSha, lastGreenSha, type Verdict } from "./main-green.ts";
import { nextTag } from "./update-feed.ts";

/** Um job do run do tag, como a API do GitHub devolve (`actions/runs/<id>/jobs`). */
export interface RunJob {
  name: string;
  status: string;
  conclusion: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

/** Uma linha da tabela de tempos: a etapa e quanto ela levou. */
export interface Stage {
  name: string;
  ms: number;
}

/** "4 min 05 s", "38 s", "1 h 02 min": o tempo de uma etapa, para o canal. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

/** O mês do próximo tag (`2026-11`), no fuso de São Paulo: um release na noite do dia 30 ainda é do mês. */
export function monthOf(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}`;
}

/**
 * As etapas do release, do tag enviado ao "latest": a fila (até o primeiro job começar), cada job que rodou (os
 * pulados ficam de fora) e o fim (do último job ao "latest"). Sem rede: o teste passa os dados.
 */
export function stageTimes(tagPushedAt: Date, jobs: RunJob[], latestAt: Date | undefined): Stage[] {
  const ran = jobs
    .filter((j) => j.started_at && j.completed_at && j.conclusion !== "skipped")
    .sort((a, b) => Date.parse(a.started_at!) - Date.parse(b.started_at!));
  const out: Stage[] = [];
  if (ran.length) out.push({ name: "fila", ms: Date.parse(ran[0]!.started_at!) - tagPushedAt.getTime() });
  for (const j of ran) out.push({ name: j.name, ms: Date.parse(j.completed_at!) - Date.parse(j.started_at!) });
  const end = ran.length ? Math.max(...ran.map((j) => Date.parse(j.completed_at!))) : tagPushedAt.getTime();
  if (latestAt) out.push({ name: "latest", ms: latestAt.getTime() - end });
  out.push({ name: "total", ms: (latestAt?.getTime() ?? end) - tagPushedAt.getTime() });
  return out;
}

/** A tabela de tempos em Markdown, pronta para o canal. */
export function stageTable(tag: string, stages: Stage[]): string {
  const rows = stages.map((s) => `| ${s.name === "total" ? "**total**" : s.name} | ${s.name === "total" ? `**${formatDuration(s.ms)}**` : formatDuration(s.ms)} |`);
  return [`**${tag}**: os tempos de cada etapa`, "", "| etapa | tempo |", "|---|---|", ...rows].join("\n");
}

/** Os tags `v*` da saída do `git ls-remote --tags` (sem as linhas `^{}` dos tags anotados). */
export function remoteTags(lsRemote: string): string[] {
  return lsRemote
    .split("\n")
    .map((l) => l.split("\t")[1]?.replace(/^refs\/tags\//, "") ?? "")
    .filter((t) => t.startsWith("v") && !t.endsWith("^{}"));
}

/** O sha a soltar: o indicado tem de estar verde; sem um, o último verde da `main`. Lança com o motivo. */
export function pickSha(arg: string | undefined, check: (sha: string) => Verdict, last: () => Verdict | undefined): string {
  if (arg) {
    const v = check(arg);
    if (!v.green) throw new Error(`${v.sha} não está verde: ${v.reason}${v.url ? ` (${v.url})` : ""}`);
    return v.sha;
  }
  const v = last();
  if (!v?.green) throw new Error("nenhum commit verde entre os últimos 30 da main");
  return v.sha;
}

function run(cmd: string, args: string[], opts: { quiet?: boolean } = {}): string {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 2).join(" ")}: ${(r.stderr || r.stdout).trim()}`);
  if (!opts.quiet && r.stderr.trim()) process.stderr.write(r.stderr);
  return r.stdout.trim();
}

const gh = (args: string[]) => run("gh", args, { quiet: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** O run do `release.yml` deste tag, quando o GitHub o cria (até uns segundos depois do push). */
async function findRun(tag: string, deadline: number): Promise<number> {
  while (Date.now() < deadline) {
    const out = gh(["run", "list", "--workflow", "release.yml", "--branch", tag, "--event", "push", "--limit", "1", "--json", "databaseId", "--jq", ".[0].databaseId // empty"]);
    if (out) return Number(out);
    await sleep(10_000);
  }
  throw new Error(`o release.yml do ${tag} não apareceu em 10 min`);
}

function runState(id: number): { status: string; conclusion: string | null; jobs: RunJob[]; url: string } {
  const r = JSON.parse(gh(["run", "view", String(id), "--json", "status,conclusion,url"])) as { status: string; conclusion: string | null; url: string };
  const repo = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  const jobs = (JSON.parse(gh(["api", `repos/${repo}/actions/runs/${id}/jobs?per_page=100`])) as { jobs: RunJob[] }).jobs;
  return { ...r, jobs };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry-run");
  const shaArg = args.find((a) => !a.startsWith("--"));
  const t0 = Date.now();
  const say = (m: string) => console.log(`[${formatDuration(Date.now() - t0).padStart(9)}] ${m}`);

  // Os tags vêm do remoto: um tag local que anda (o `updates-rc`) faz o `fetch --tags` recusar.
  run("git", ["fetch", "-q", "origin", "main"]);
  const sha = pickSha(shaArg, checkSha, lastGreenSha);
  run("git", ["merge-base", "--is-ancestor", sha, "origin/main"]);
  const tag = nextTag(monthOf(new Date()), remoteTags(run("git", ["ls-remote", "--tags", "origin", "refs/tags/v*"])));
  say(`${sha.slice(0, 8)} verde, na main; o tag é ${tag}`);
  if (dry) return;

  run("git", ["tag", tag, sha]);
  run("git", ["push", "-q", "origin", tag]);
  const pushed = new Date();
  say(`${tag} enviado`);

  const id = await findRun(tag, Date.now() + 10 * 60_000);
  const seen = new Set<string>();
  let state = runState(id);
  say(`release.yml: ${state.url}`);
  for (;;) {
    for (const j of state.jobs) {
      const key = `${j.name}:${j.status}`;
      if (seen.has(key) || (j.status !== "in_progress" && j.status !== "completed")) continue;
      seen.add(key);
      say(j.status === "completed" ? `${j.name}: ${j.conclusion}` : `${j.name}: começou`);
    }
    if (state.status === "completed") break;
    await sleep(30_000);
    state = runState(id);
  }
  if (state.conclusion !== "success") {
    console.log(stageTable(tag, stageTimes(pushed, state.jobs, undefined)));
    throw new Error(`o release.yml do ${tag} saiu ${state.conclusion}: ${state.url}`);
  }

  let latestAt: Date | undefined;
  for (const end = Date.now() + 5 * 60_000; Date.now() < end; await sleep(10_000)) {
    if (gh(["release", "view", "--json", "tagName", "--jq", ".tagName"]) === tag) {
      latestAt = new Date();
      break;
    }
  }
  if (!latestAt) throw new Error(`o release.yml passou, mas o ${tag} não virou o latest`);
  say(`${tag} é o latest`);
  console.log(`\n${stageTable(tag, stageTimes(pushed, state.jobs, latestAt))}`);
}

if (import.meta.main) {
  main().catch((e: unknown) => {
    console.error(`release-tag: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
