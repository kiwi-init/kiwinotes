// Os roteiros da pasta das notas (spec da T5161, `docs/specs/pasta-das-notas.md`), com o preparo que eles pedem:
// - `notas-pasta.json`: a pasta padrão, "Abrir pasta…" para outra, a nota editada lá, as Reuniões que ficam na base
//   interna, a volta pelas recentes e o atalho nos Ajustes;
// - `notas-pasta-na-arvore.json`: o mesmo caminho pela linha da raiz na árvore.
//
//   bun scripts/notas-pasta-check.ts [pasta-dos-prints] [vezes]
//
// Cada rodada sobe o headless num tmp novo, com o seletor falso (`KIWI_TEST_NOTES_FOLDER`) apontando para uma pasta
// "Obsidian de teste" criada aqui. Tudo é inventado: a "Nota interna" e a reunião vão para a pasta padrão, e o
// "Projeto Atlas" para a pasta de teste. O seletor de verdade não abre, e nenhuma pasta da pessoa é lida.
// Sai com 1 se algum roteiro falhar (T19835).
import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const app = path.resolve(import.meta.dir, "..");
const scripts = path.join(app, "scripts", "ui-scripts");
const out = path.resolve(process.argv[2] ?? path.join(tmpdir(), "kiwi-notas-pasta"));
const times = Math.max(1, Number(process.argv[3] ?? 1) || 1);
const work = mkdtempSync(path.join(tmpdir(), "kiwi-notas-pasta-"));
mkdirSync(out, { recursive: true });

async function cli(args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  const p = Bun.spawn([process.execPath, path.join(app, "scripts", "cli.ts"), ...args], {
    cwd: app,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  const text = await new Response(p.stdout).text();
  return { code: await p.exited, out: text + (await new Response(p.stderr).text()) };
}

const MEETING = [
  "---",
  "type: meeting",
  "session: a1",
  'date: "2026-11-05"',
  'start: "2026-11-05T17:32:00.000Z"',
  'end: "2026-11-05T18:10:00.000Z"',
  "duration: 2280",
  'app: "Teams"',
  "participants: [Você, Pessoa 1]",
  "---",
  "## Minhas notas",
  "",
  "## Transcrição",
  "**14:32 · Você:** Bom dia, vamos começar.",
  "",
].join("\n");

/** Uma rodada: os dados num tmp novo, o headless, um roteiro e os prints com o nome dele. */
async function run(script: string, round: number): Promise<boolean> {
  const name = script.replace(/\.json$/, "");
  const data = path.join(work, `${name}-${round}`);
  const other = path.join(work, `outra-${name}-${round}`, "Obsidian de teste");
  mkdirSync(other, { recursive: true });
  writeFileSync(path.join(other, "Projeto Atlas.md"), "# Projeto Atlas\n\nUma nota de exemplo na outra pasta.\n");
  const env = { KIWI_TEST_NOTES_FOLDER: other };
  const shots = path.join(work, `shots-${name}-${round}`);
  try {
    const up = await cli(["start", "--no-helper", "--data", data], env);
    if (up.code !== 0) throw new Error(`o headless não subiu: ${up.out}`);
    for (const args of [
      { title: "Nota interna", content: "# Nota interna\n\nFica na pasta padrão.\n" },
      { folder: "Reuniões", title: "2026-11-05 14h32 Reunião do Teams", content: MEETING },
    ]) {
      const r = await cli(["invoke", "notes.create", JSON.stringify(args), "--data", data], env);
      if (r.code !== 0) throw new Error(`notes.create: ${r.out}`);
    }
    const r = await cli(["ui", "hub", "--script", path.join(scripts, script), "--out", shots, "--data", data]);
    const report = JSON.parse(r.out.slice(r.out.indexOf("{"))) as { ok: boolean; problems?: string[]; steps?: { error?: string }[] };
    for (const f of new Bun.Glob("*.png").scanSync(shots)) renameSync(path.join(shots, f), path.join(out, `${name}-${f}`));
    const failed = report.steps?.findIndex((s) => s.error) ?? -1;
    const why = failed >= 0 ? `: passo ${failed + 1}, ${report.steps![failed].error}` : "";
    console.log(`${report.ok ? "ok    " : "FALHOU"} ${name} (rodada ${round})${why}${report.problems?.length ? ` · ${report.problems.join(" | ")}` : ""}`);
    return report.ok && !report.problems?.length;
  } finally {
    await cli(["stop", "--data", data]);
  }
}

let ok = true;
for (let round = 1; round <= times; round++) {
  for (const script of ["notas-pasta.json", "notas-pasta-na-arvore.json"]) ok = (await run(script, round)) && ok;
}
console.log(`prints em ${out}`);
process.exit(ok ? 0 : 1);
