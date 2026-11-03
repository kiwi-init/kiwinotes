// Um Kiwi Notes por vez (T992). Dois abertos ao mesmo tempo (o build velho e o novo, ou dois `open -n`) dividiam o
// `sidecar.sock`: cada um apagava o arquivo do outro ao subir e ao sair, e os dois recebiam o mesmo Quit (14:45, #989).
//
// Quem está de pé fica em <dados>/instance.json (pid e o .app de onde subiu). Ao abrir:
// - ninguém de pé (sem arquivo, ou o pid morreu ou não é mais um Kiwi Notes): assume;
// - o mesmo .app já de pé: este sai calado, sem tocar no socket nem criar outro ícone na barra;
// - outro .app de pé (um build velho): este assume. Quem abre um build novo quer o build novo. O velho recebe SIGTERM,
//   sai limpo (o handler do SIGTERM em index.ts para o helper e solta o socket) e este espera ele sumir antes de subir.
// - Com `KIWI_DEBUG=1` (um agente no `bun dev`), nunca pede para outro sair: sai ele, sem tocar no app da pessoa.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface InstanceRecord {
  pid: number;
  /** O .app de onde subiu (ou o executável, fora de um .app, como no `bun dev`). */
  app: string;
}

export type InstanceDecision =
  | { action: "start" }
  | { action: "exit"; reason: "already_running" }
  | { action: "replace"; pid: number; app: string };

/**
 * A decisão, sem efeito nenhum. `running` é o registro de quem diz estar de pé; `alive` diz se aquele pid ainda é um
 * Kiwi Notes (o pid pode ter sido reusado por outro processo).
 */
export function decideInstance(
  running: InstanceRecord | undefined,
  self: InstanceRecord,
  alive: (r: InstanceRecord) => boolean,
  mayReplace = true,
): InstanceDecision {
  if (!running || running.pid === self.pid || !alive(running)) return { action: "start" };
  if (running.app === self.app || !mayReplace) return { action: "exit", reason: "already_running" };
  return { action: "replace", pid: running.pid, app: running.app };
}

/** O .app de um executável (`…/Kiwi Notes.app/Contents/MacOS/bun` → `…/Kiwi Notes.app`), ou o próprio caminho. */
export function appOf(executable: string): string {
  const i = executable.indexOf(".app/");
  return i >= 0 ? executable.slice(0, i + 4) : executable;
}

/** O pid está vivo e o comando dele é do mesmo .app do registro: só assim ele é o Kiwi Notes que o arquivo diz. */
export function isKiwiProcess(r: InstanceRecord): boolean {
  try {
    process.kill(r.pid, 0);
  } catch {
    return false;
  }
  const ps = spawnSync("ps", ["-o", "command=", "-p", String(r.pid)], { encoding: "utf8" });
  return ps.status === 0 && ps.stdout.includes(r.app);
}

export function instanceFile(dir: string): string {
  return path.join(dir, "instance.json");
}

export function readRecord(file: string): InstanceRecord | undefined {
  try {
    const r = JSON.parse(readFileSync(file, "utf8")) as Partial<InstanceRecord>;
    return typeof r.pid === "number" && typeof r.app === "string" ? { pid: r.pid, app: r.app } : undefined;
  } catch {
    return undefined;
  }
}

export interface ClaimOptions {
  dir: string;
  self?: InstanceRecord;
  alive?: (r: InstanceRecord) => boolean;
  /** `false` com `KIWI_DEBUG=1`: nunca pede para outro Kiwi Notes sair. */
  mayReplace?: boolean;
  /** Pede para o outro sair (SIGTERM). */
  stop?: (pid: number) => void;
  /** Quanto esperar o outro sair, e de quanto em quanto olhar. */
  waitMs?: number;
  stepMs?: number;
  log?: (m: string) => void;
}

/**
 * Decide e age: grava este processo no arquivo, ou devolve `exit` para quem chamou sair. Síncrono, para rodar antes
 * do ícone da barra e do helper.
 */
export function claimInstance(o: ClaimOptions): InstanceDecision {
  const file = instanceFile(o.dir);
  const self = o.self ?? { pid: process.pid, app: appOf(process.execPath) };
  const alive = o.alive ?? isKiwiProcess;
  const log = o.log ?? ((m) => console.log(`[instance] ${m}`));
  const decision = decideInstance(readRecord(file), self, alive, o.mayReplace ?? true);
  if (decision.action === "exit") {
    log(`another Kiwi Notes is already running: leaving it alone and quitting`);
    return decision;
  }
  if (decision.action === "replace") {
    log(`another Kiwi Notes (pid ${decision.pid}, ${decision.app}) is running: asking it to quit`);
    (o.stop ?? ((pid) => process.kill(pid, "SIGTERM")))(decision.pid);
    const step = o.stepMs ?? 100;
    for (let waited = 0; waited < (o.waitMs ?? 5000) && alive({ pid: decision.pid, app: decision.app }); waited += step) {
      Bun.sleepSync(step);
    }
    if (alive({ pid: decision.pid, app: decision.app })) log(`pid ${decision.pid} is still running; starting anyway`);
  }
  mkdirSync(o.dir, { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(self));
  return decision;
}

/** Ao sair: apaga o registro, se ainda for deste processo (um build novo pode já ter assumido). */
export function releaseInstance(dir: string, pid = process.pid): void {
  const file = instanceFile(dir);
  if (readRecord(file)?.pid === pid) rmSync(file, { force: true });
}
