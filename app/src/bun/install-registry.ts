// O registro de instalação do Electrobun apontando para outro app (T2399, a rc3 do harry, #2395).
//
// O instalador do Electrobun (o wrapper que se desempacota) grava `<userData>/.electrobun-uninstall.json`, com o
// `app_bundle_path` do app que ele instalou. Na troca de versão, o extractor do Livewire 2026.10.2 compara esse caminho
// com o app que está rodando, e recusa com `InvalidUpdateIdentity` se forem outros
// (`package/src/extractor/main.zig`, `validateApplyUpdatePlan`, o ramo do macOS). Sem o arquivo, ele segue pelo
// caminho antigo, que confere o Info.plist do próprio app que está rodando.
//
// Foi o que aconteceu: um build de teste (de um worktree) rodou no Mac do harry e gravou o registro com o caminho dele;
// depois o harry instalou a rc2 arrastando do .dmg para /Applications, e o registro nunca foi refeito. Toda
// atualização falhava.
//
// O conserto: na abertura, se o registro aponta para outro app, ele sai do caminho, renomeado ao lado (nunca apagado),
// e a próxima troca segue pelo caminho antigo. Não reescrevemos o registro no formato do extractor (o token com o
// nonce): um campo fora do que ele espera viraria `InvalidUninstallManifest`, e a troca falharia de novo.

import { existsSync, readFileSync, renameSync } from "node:fs";
import path from "node:path";

export const REGISTRY_NAME = ".electrobun-uninstall.json";

export type RegistryState =
  /** Sem registro: o extractor confere o próprio app. */
  | { state: "missing" }
  /** O registro aponta para este app. */
  | { state: "ok" }
  /** Apontava para outro app e foi renomeado para `movedTo`. */
  | { state: "moved"; recorded: string; movedTo: string }
  /** Não é um app empacotado (o `bun` do dev), ou não deu para ler: nada foi mexido. */
  | { state: "skipped"; reason: string };

/**
 * O .app que está rodando, pelo executável (`<app>.app/Contents/MacOS/bun`), ou null fora de um .app. É o mesmo cálculo
 * do Updater ao montar o plano da troca (`resolve(dirname(process.execPath), "..", "..")`, só léxico, sem realpath):
 * o extractor compara o registro com esse texto, exato (revisão #2414).
 */
export function runningBundle(execPath: string): string | null {
  const bundle = path.resolve(path.dirname(execPath), "..", "..");
  if (!bundle.endsWith(".app") || path.basename(path.dirname(execPath)) !== "MacOS") return null;
  return bundle;
}

/**
 * Confere o registro em `channelRoot` (o `Utils.paths.userData` do Electrobun) contra o app que está rodando, e tira do
 * caminho o que aponta para outro app. Nunca lança: a abertura do app não depende disto.
 */
export function repairInstallRegistry(o: { channelRoot: string; bundle: string | null; now?: Date }): RegistryState {
  if (!o.bundle) return { state: "skipped", reason: "not a packaged .app" };
  const file = path.join(o.channelRoot, REGISTRY_NAME);
  if (!existsSync(file)) return { state: "missing" };
  let recorded: unknown;
  try {
    recorded = (JSON.parse(readFileSync(file, "utf8")) as { app_bundle_path?: unknown }).app_bundle_path;
  } catch (e) {
    return { state: "skipped", reason: `unreadable registry: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (typeof recorded !== "string") return { state: "skipped", reason: "registry without app_bundle_path" };
  // O extractor compara o texto exato (`std.mem.eql`): o mesmo app por um link ainda falharia, então também sai.
  if (recorded === o.bundle) return { state: "ok" };
  const stamp = (o.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const movedTo = path.join(o.channelRoot, `.electrobun-uninstall.stale-${stamp}.json`);
  try {
    renameSync(file, movedTo);
  } catch (e) {
    return { state: "skipped", reason: `couldn't move the registry: ${e instanceof Error ? e.message : String(e)}` };
  }
  return { state: "moved", recorded, movedTo };
}
