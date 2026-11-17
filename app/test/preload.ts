// O preload do `bun test` (bunfig.toml, spec #10077): cada rodada numa pasta temporária própria, e no fim a conta do
// que os testes deixaram para trás.
//
// O `TMPDIR` aponta para `<tmp>/kr-XXXXXX`, então o `tmpdir()` dos testes e dos processos que eles abrem (o headless, a
// CLI, o helper falso) cai nela, e as rodadas de outros agentes na mesma máquina não se misturam. No fim, o que
// sobrou lá dentro é contado por prefixo e apagado.
//
// A pasta da rodada fica de pé até o processo sair: com `--rerun-each N`, o Bun roda o `afterAll` do preload a cada
// volta (e o `beforeAll` só nas voltas do primeiro arquivo), sem dizer qual é a última; apagá-la no `afterAll` dava
// ENOENT na volta seguinte (#10905). Ela leva uma marca com o pid do dono, e o próximo `bun test` apaga as pastas
// marcadas cujo dono já saiu.

import { afterAll, afterEach, beforeEach } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { cleanupTempDirs, setInTest } from "./tmp.ts";

const system = realpathSync(tmpdir());
// Curto de propósito: os sockets unix dos testes ficam dentro dela, e o caminho de um socket tem limite (104 bytes).
/** A marca da pasta da rodada: o pid de quem a criou. */
const MARK = ".kiwi-run";

/** O processo ainda existe (um `EPERM` é de outro usuário, e conta como vivo). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * As pastas de rodadas que já acabaram: só as `kr-*` com a marca deste preload e cujo dono saiu. Nunca pelo prefixo
 * só, e nunca a de uma rodada viva (de outro agente na mesma máquina).
 */
export function sweepFinishedRuns(root = system): string[] {
  const removed: string[] = [];
  let names: string[];
  try {
    names = readdirSync(root).filter((n) => n.startsWith("kr-"));
  } catch {
    return removed;
  }
  for (const name of names) {
    const dir = path.join(root, name);
    let pid: number;
    try {
      pid = Number.parseInt(readFileSync(path.join(dir, MARK), "utf8"), 10);
    } catch {
      continue;
    }
    if (!Number.isInteger(pid) || pid <= 0 || alive(pid)) continue;
    rmSync(dir, { recursive: true, force: true });
    removed.push(dir);
  }
  return removed;
}

sweepFinishedRuns();
const run = mkdtempSync(path.join(system, "kr-"));
writeFileSync(path.join(run, MARK), String(process.pid), { mode: 0o600 });
process.env.TMPDIR = run;

beforeEach(() => setInTest(true));
afterEach(() => {
  setInTest(false);
  cleanupTempDirs();
});

/**
 * O que sobrou na pasta da rodada, por prefixo (`kiwi-agent-svc-`, `kn-projects-`…). `strict` são as pastas `kiwi-*` e
 * `kn-*`, que a conferência não aceita; o resto (um socket, o cache do compilador do Node) só aparece no relatório.
 */
export function leftovers(dir = run): { strict: Map<string, number>; other: Map<string, number> } {
  const strict = new Map<string, number>();
  const other = new Map<string, number>();
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === MARK) continue;
    const prefix = e.name.replace(/[A-Za-z0-9]{6}$/, "");
    const into = e.isDirectory() && /^(kiwi|kn)-/.test(e.name) ? strict : other;
    into.set(prefix, (into.get(prefix) ?? 0) + 1);
  }
  return { strict, other };
}

/**
 * No fim da suíte (no Bun, o `afterAll` do preload roda depois de todos os arquivos, uma vez por volta do
 * `--rerun-each`; o evento `exit` não chega a rodar no `bun test`): o que sobrou, por prefixo, e a pasta da rodada
 * esvaziada. A conferência vale em cada volta.
 */
afterAll(async () => {
  // Uma gravação atrasada de um teste (o registro do Lixo de um vault) pode recriar a pasta depois do afterEach.
  cleanupTempDirs();
  await Bun.sleep(300);
  cleanupTempDirs(true);
  let left: ReturnType<typeof leftovers>;
  try {
    left = leftovers();
  } catch {
    return;
  }
  const list = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([p, n]) => `  ${p}* ${n}`).join("\n");
  const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  if (left.strict.size) {
    writeSync(2, `\n[tmp] os testes deixaram ${total(left.strict)} pastas kiwi-*/kn-* para trás (spec #10077):\n${list(left.strict)}\nUse tempDir() de test/tmp.ts, que apaga no fim do teste.\n`);
    // A conferência: a suíte falha. KIWI_TMP_STRICT=0 só mostra (para medir).
    if (process.env.KIWI_TMP_STRICT !== "0") process.exitCode = 1;
  }
  if (left.other.size && process.env.KIWI_TMP_VERBOSE === "1") writeSync(2, `[tmp] outros arquivos na pasta da rodada:\n${list(left.other)}\n`);
  if (process.env.KIWI_TMP_KEEP === "1") {
    writeSync(2, `[tmp] pasta da rodada mantida: ${run}\n`);
    return;
  }
  // Vazia, mas de pé para a próxima volta; o próximo `bun test` apaga a pasta (o dono terá saído).
  for (const name of readdirSync(run)) if (name !== MARK) rmSync(path.join(run, name), { recursive: true, force: true });
});
