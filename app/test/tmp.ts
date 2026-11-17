// As pastas temporárias dos testes (spec #10077, issue #416). Antes, cada teste criava a sua com `mkdtemp` e nem
// sempre apagava: o disco do harry juntou 13.610 pastas `kiwi-*`/`kn-*` (1,8 GB).
//
// - `tempDir(prefixo)` cria a pasta dentro da pasta temporária e a apaga no fim do teste (o `afterEach` do preload),
//   mesmo quando o teste falha ou estoura o tempo. Criada fora de um teste (num `beforeAll`), sai no fim da suíte.
// - O preload (`test/preload.ts`) põe a rodada inteira numa pasta própria (o `TMPDIR` dos testes e dos processos que
//   eles abrem) e, no fim, diz o que sobrou e apaga essa pasta.
// - Só apaga o que este módulo criou, e só dentro da pasta temporária do sistema: nunca pelo prefixo.

import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const created = new Set<string>();
/** As criadas fora de um teste (num `beforeAll`, no topo do arquivo): servem a vários testes e só saem no fim. */
const shared = new Set<string>();
let inTest = false;
/** O preload avisa quando um teste começa e termina (o `beforeEach`/`afterEach` globais). */
export function setInTest(on: boolean): void {
  inTest = on;
}
/** Todas as que este módulo já criou: uma gravação atrasada (o registro do Lixo de um vault) pode recriar a pasta. */
const ever = new Set<string>();

/** A raiz em que o ajudante aceita apagar: a pasta temporária do sistema, como ela é de verdade (sem links). */
export function tempRoot(): string {
  return realpathSync(tmpdir());
}

/** `dir` fica dentro de `root` (e não é a própria `root`). */
export function insideRoot(root: string, dir: string): boolean {
  const rel = path.relative(root, dir);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** Apaga uma pasta criada aqui. Recusa (com erro) o que estiver fora da pasta temporária ou não for daqui. */
export function removeTempDir(dir: string, root = tempRoot()): void {
  const real = (() => {
    try {
      return realpathSync(dir);
    } catch {
      return path.resolve(dir);
    }
  })();
  if (!insideRoot(root, real)) throw new Error(`tempDir: recuso apagar ${dir}: fica fora da pasta temporária (${root})`);
  if (!ever.has(dir) && !ever.has(real)) throw new Error(`tempDir: recuso apagar ${dir}: não foi criada por tempDir`);
  rmSync(real, { recursive: true, force: true });
  created.delete(dir);
  created.delete(real);
}

/** Uma pasta temporária nova, apagada no fim do teste (ou da suíte, se criada fora de um teste). */
export function tempDir(prefix = "kiwi-test-"): string {
  if (!/^[a-z0-9-]{1,40}$/i.test(prefix)) throw new Error(`tempDir: prefixo inválido ${JSON.stringify(prefix)}`);
  const dir = mkdtempSync(path.join(tempRoot(), prefix));
  (inTest ? created : shared).add(dir);
  ever.add(dir);
  return dir;
}

/**
 * Apaga as que ainda existem (o `afterEach` do preload). Um erro numa não impede as outras. Com `again`, no fim da
 * suíte, apaga também as que uma gravação atrasada recriou depois do teste.
 */
export function cleanupTempDirs(again = false): void {
  const root = tempRoot();
  if (again) {
    for (const dir of shared) created.add(dir);
    shared.clear();
    for (const dir of ever) if (existsSync(dir)) created.add(dir);
  }
  for (const dir of [...created]) {
    try {
      removeTempDir(dir, root);
    } catch (e) {
      console.error(String(e));
      created.delete(dir);
    }
  }
}

/** As que ainda estão de pé (para os testes do próprio ajudante). */
export function pendingTempDirs(): string[] {
  return [...created, ...shared];
}
