// Os roteiros de Ajustes que precisam de um modelo baixado (T18690): `ajustes-sentido.json` (o e5 da busca pelo
// sentido) e `ajustes-modo-preciso.json` (o Whisper small do Ditado preciso). O headless não sai para a rede, então
// rodados soltos pelo `cli ui` eles param em "Esperando a pasta de notas abrir." ou "Não deu para baixar o modelo".
// Este script roda cada um com o modelo que já está neste Mac:
//
// - o modelo vem de KIWI_MODELS_DIR (a pasta que os agentes dividem) ou do app deste Mac, e é **clonado** (`cp -c`,
//   APFS) numa pasta tmp. Desligar a busca ou o Ditado preciso apaga a pasta dos modelos: com a cópia, a do app
//   nunca é tocada;
// - um modelo que não está em nenhum dos dois pula o roteiro, com o motivo. O script nunca baixa nada;
// - o modo preciso carrega o Whisper no helper headless (sem mic): pegue `kiwi lock bench` antes.
//
// Os `ajustes-agente*.json` não são daqui: rodam pelo `scripts/agent-ui-check.ts`, que monta o agente falso.
//
//   bun scripts/ajustes-models-check.ts [pasta-dos-prints]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { WHISPER_SMALL } from "../src/bun/precise-dictation.ts";
import { E5_SMALL, modelDir, type ModelManifest } from "../src/notes/semantic/model.ts";

const app = path.resolve(import.meta.dir, "..");
const out = path.resolve(process.argv[2] ?? path.join(tmpdir(), "kiwi-T18690-ajustes"));
const roots = [process.env.KIWI_MODELS_DIR, path.join(homedir(), "Library/Application Support/KiwiNotes/models")];

/** A pasta do modelo (`<raiz>/<id>/<revisão>`) com todos os arquivos, na primeira raiz que tem; `null` se nenhuma. */
export function findModel(m: ModelManifest, where: (string | undefined)[] = roots): string | null {
  for (const root of where) {
    if (!root) continue;
    const dir = modelDir(root, m);
    if (m.files.every((f) => existsSync(path.join(dir, f.name)))) return dir;
  }
  return null;
}

function cli(data: string, args: string[], env: Record<string, string>) {
  const r = spawnSync(process.execPath, [path.join(app, "scripts/cli.ts"), ...args, "--data", data], {
    cwd: app, encoding: "utf8", env: { ...process.env, ...env }, timeout: 300_000,
  });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const cases: { script: string; model: ModelManifest; helper: boolean }[] = [
  { script: "ajustes-sentido.json", model: E5_SMALL, helper: false },
  { script: "ajustes-modo-preciso.json", model: WHISPER_SMALL, helper: true },
];

if (import.meta.main) {
  let failed = false;
  for (const c of cases) {
    const name = c.script.replace(/\.json$/, "");
    const found = findModel(c.model);
    if (!found) {
      console.log(`pulado ${name}: o modelo ${c.model.id} não está baixado (nem em KIWI_MODELS_DIR, nem no app deste Mac)`);
      continue;
    }
    const tmp = mkdtempSync(path.join(tmpdir(), "kiwi-ajustes-models-"));
    const models = path.join(tmp, "models");
    const copy = modelDir(models, c.model);
    mkdirSync(path.dirname(copy), { recursive: true });
    // O clone do APFS: instantâneo e sem espaço a mais; apagar a cópia não toca no original.
    const cp = spawnSync("cp", ["-cR", found, copy]);
    if (cp.status !== 0) throw new Error(`não deu para clonar o modelo ${c.model.id}: ${cp.stderr}`);
    const data = path.join(tmp, "data");
    const env = { KIWI_MODELS_DIR: models };
    try {
      const start = cli(data, ["start", ...(c.helper ? [] : ["--no-helper"])], env);
      if (start.code !== 0) throw new Error(`cli start: ${start.out}`);
      const run = cli(data, ["ui", "--script", path.join(app, "scripts/ui-scripts", c.script), "--out", path.join(out, name)], env);
      const ok = run.code === 0;
      failed ||= !ok;
      const why = ok ? "" : ` ${run.out.match(/"error": "([^\n]*)"/)?.[1] ?? run.out.slice(-400)}`;
      console.log(`${ok ? "ok" : "FALHOU"} ${name}${why}`);
    } finally {
      cli(data, ["stop"], env);
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  console.log(`prints em ${out}`);
  process.exit(failed ? 1 : 0);
}
