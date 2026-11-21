// O portão do merge (spec #21331): o lead só faz o merge com todos os checks do PR verdes. O PR #55 entrou com o
// `bun test` vermelho porque o comando só olhava o sha e imprimia os checks sem barrar.
//
// Desde o #21331 um check pode passar "pulado": o job roda no Linux, com um passo "pulado: <motivo>", e sai verde. O
// portão aceita o pulado com motivo, e barra o vermelho, o que falta, o que ainda roda e o pulado sem motivo (o
// `skipped` do GitHub, ou o passo "pulado:" sem texto).
//
// Só os checks do nosso CI contam (T24794): os jobs do GitHub Actions deste repo, pelo link
// `github.com/<dono>/<repo>/actions/runs/…`. Um app de fora (o "Proof" do Blacksmith, que sai `skipped`) aparece como
// "ignorado (app de fora)": nunca barra e nunca conta como um dos obrigatórios.
//
//   bun scripts/merge-gate.ts 135                  # só confere: sai 0 se pode, 1 se não
//   bun scripts/merge-gate.ts 135 --merge          # confere e faz o squash, preso ao sha conferido
//   bun scripts/merge-gate.ts 135 --merge -- --delete-branch
import { spawnSync } from "node:child_process";

/** Os checks que todo PR precisa ter. */
export const REQUIRED = ["bun test", "typecheck", "swift test"];

/** O prefixo do passo de um job pulado (o `ci.yml` escreve o motivo depois dele). */
export const SKIP_STEP = "pulado:";

/** Um item do `statusCheckRollup` do `gh pr view`. */
export interface Check {
  __typename?: string;
  name?: string;
  context?: string;
  status?: string;
  conclusion?: string | null;
  state?: string;
  detailsUrl?: string;
  targetUrl?: string;
  startedAt?: string;
}

export interface Step {
  name: string;
  conclusion: string | null;
}

export type State = "passou" | "pulado" | "vermelho" | "falta" | "rodando" | "pulado sem motivo" | "ignorado (app de fora)";

export interface Verdict {
  name: string;
  state: State;
  ok: boolean;
  detail: string;
}

const nameOf = (c: Check) => c.name ?? c.context ?? "";

/**
 * Se o check é do nosso CI: um job do GitHub Actions do próprio repo (`dono/repo`), pelo link dele. Um status de commit
 * ou um check de outro app (outro link) é de fora.
 */
export function isOwnCi(c: Check, repo: string): boolean {
  if (c.__typename === "StatusContext") return false;
  return (c.detailsUrl ?? "").toLowerCase().startsWith(`https://github.com/${repo.toLowerCase()}/actions/runs/`);
}

/** O motivo do pulo, pelos passos do job: `undefined` se o job não pulou, "" se pulou sem dizer o motivo. */
export function skipReason(steps: Step[] | null): string | undefined {
  const step = steps?.find((s) => s.name.startsWith(SKIP_STEP) && s.conclusion === "success");
  return step ? step.name.slice(SKIP_STEP.length).trim() : undefined;
}

/**
 * O veredito de cada check: os obrigatórios (mesmo os que faltam) e os outros que o PR tiver. `stepsOf` dá os passos
 * do job de um check verde, para achar o "pulado:".
 */
export function judge(checks: Check[], stepsOf: (c: Check) => Step[] | null, repo: string, required = REQUIRED): Verdict[] {
  const own = checks.filter((c) => isOwnCi(c, repo));
  // Os de fora só aparecem na saída, um por nome.
  const foreign = [...new Set(checks.filter((c) => !isOwnCi(c, repo)).map(nameOf))]
    .sort()
    .map((name): Verdict => ({ name, state: "ignorado (app de fora)", ok: true, detail: "" }));
  // Um check rodado de novo aparece mais de uma vez: vale o último.
  const latest = new Map<string, Check>();
  for (const c of own) {
    const prev = latest.get(nameOf(c));
    if (!prev || (c.startedAt ?? "") >= (prev.startedAt ?? "")) latest.set(nameOf(c), c);
  }
  const names = [...required, ...[...latest.keys()].filter((n) => !required.includes(n)).sort()];
  const verdicts = names.map((name): Verdict => {
    const c = latest.get(name);
    if (!c) return { name, state: "falta", ok: false, detail: "o check não está no PR" };
    if (c.__typename === "StatusContext") {
      const s = (c.state ?? "").toUpperCase();
      if (s === "SUCCESS") return { name, state: "passou", ok: true, detail: "" };
      if (s === "PENDING" || s === "EXPECTED") return { name, state: "rodando", ok: false, detail: s.toLowerCase() };
      return { name, state: "vermelho", ok: false, detail: s.toLowerCase() };
    }
    if ((c.status ?? "").toUpperCase() !== "COMPLETED") return { name, state: "rodando", ok: false, detail: (c.status ?? "").toLowerCase() };
    const conclusion = (c.conclusion ?? "").toUpperCase();
    if (conclusion === "SKIPPED" || conclusion === "NEUTRAL") return { name, state: "pulado sem motivo", ok: false, detail: `${conclusion.toLowerCase()} no GitHub, sem o passo "${SKIP_STEP}"` };
    if (conclusion !== "SUCCESS") return { name, state: "vermelho", ok: false, detail: conclusion.toLowerCase() || "sem conclusão" };
    const reason = skipReason(stepsOf(c));
    if (reason === undefined) return { name, state: "passou", ok: true, detail: "" };
    if (!reason) return { name, state: "pulado sem motivo", ok: false, detail: `o passo "${SKIP_STEP}" sem o motivo` };
    return { name, state: "pulado", ok: true, detail: reason };
  });
  return [...verdicts, ...foreign];
}

function gh(args: string[]): string {
  const r = spawnSync("gh", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(" ")}: ${r.stderr.trim()}`);
  return r.stdout;
}

/** Os passos do job de um check, pelo link dele (`…/<dono>/<repo>/actions/runs/<run>/job/<id>`). */
function jobSteps(c: Check): Step[] | null {
  const m = /github\.com\/([^/]+\/[^/]+)\/actions\/runs\/\d+\/job\/(\d+)/.exec(c.detailsUrl ?? "");
  if (!m) return null;
  return JSON.parse(gh(["api", `repos/${m[1]}/actions/jobs/${m[2]}`, "--jq", "[.steps[] | {name, conclusion}]"])) as Step[];
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const cut = args.indexOf("--");
  const own = cut < 0 ? args : args.slice(0, cut);
  const extra = cut < 0 ? [] : args.slice(cut + 1);
  const pr = own.find((a) => /^\d+$/.test(a));
  if (!pr) {
    console.error("uso: bun scripts/merge-gate.ts <PR> [--merge] [-- <args do gh pr merge>]");
    process.exit(2);
  }
  const view = JSON.parse(gh(["pr", "view", pr, "--json", "headRefOid,statusCheckRollup,isDraft,url"])) as { headRefOid: string; statusCheckRollup: Check[]; isDraft: boolean; url: string };
  // O repo do PR (`https://github.com/<dono>/<repo>/pull/N`): os checks do nosso CI apontam para as Actions dele.
  const repo = /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(view.url)?.[1];
  if (!repo) throw new Error(`não achei o repo no link do PR: ${view.url}`);
  const verdicts = judge(view.statusCheckRollup, jobSteps, repo);
  for (const v of verdicts) console.log(`${v.state === "ignorado (app de fora)" ? "--  " : v.ok ? "ok  " : "BARRA"}  ${v.name}: ${v.state}${v.detail ? ` (${v.detail})` : ""}`);
  const sha = view.headRefOid;
  if (view.isDraft) {
    console.log(`#${pr} @ ${sha.slice(0, 8)}: é draft, não entra`);
    process.exit(1);
  }
  if (verdicts.some((v) => !v.ok)) {
    console.log(`#${pr} @ ${sha.slice(0, 8)}: não entra`);
    process.exit(1);
  }
  console.log(`#${pr} @ ${sha.slice(0, 8)}: pode entrar`);
  if (own.includes("--merge")) {
    // Preso ao sha conferido: um push depois da conferência faz o merge falhar, em vez de levar um commit sem CI.
    const r = spawnSync("gh", ["pr", "merge", pr, "--squash", "--match-head-commit", sha, ...extra], { stdio: "inherit" });
    process.exit(r.status ?? 1);
  }
}
