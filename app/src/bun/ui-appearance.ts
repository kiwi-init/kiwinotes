// A aparência de cada janela (T25031, spec #25011): qual UI ela mostra (a de fábrica ou uma que o canal instalou) e o
// "Voltar à aparência anterior" de Ajustes › Sobre.
//
// O AppEngine guarda o estado de cada janela em `<dados>/appengine/<janela>/engine.json` e não tem um rollback manual
// público. Então o Kiwi lê esse arquivo para o Sobre e, para voltar, faz o que o engine faz com uma UI que falhou:
// marca as instaladas mais novas como `bad` (nunca sobem de novo, e o canal recusa baixá-las outra vez) e deixa a
// anterior boa, ou a de fábrica, subir. Só se mexe no arquivo com o engine da janela parado; quem chama garante isso.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { UiStatus } from "../shared/ui-contract.ts";

/** O pedaço do manifest de uma UI que o Kiwi usa. */
interface Manifest {
  uiVersion: string;
  sha256: string;
  seq: number;
  dataSchema: number;
}

/** A versão da UI de fábrica da janela (o ui.json do bundle). */
export interface BuiltInVersion {
  uiVersion: string;
  seq: number;
}

/** O motivo gravado no `bad` do engine.json quando a pessoa volta à aparência anterior. */
export const REVERT_REASON = "a pessoa voltou à aparência anterior (Ajustes › Sobre)";

const engineFile = (dir: string) => path.join(dir, "engine.json");

const isManifest = (v: unknown): v is Manifest => {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return typeof m.uiVersion === "string" && typeof m.sha256 === "string" && Number.isSafeInteger(m.seq) && Number.isSafeInteger(m.dataSchema);
};

function readState(dir: string): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(readFileSync(engineFile(dir), "utf8")) as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const manifestOf = (v: unknown) => (isManifest(v) ? v : null);
const goodOf = (state: Record<string, unknown>) => (Array.isArray(state.good) ? state.good.filter(isManifest) : []);
const badOf = (state: Record<string, unknown>): Record<string, string> =>
  state.bad && typeof state.bad === "object" && !Array.isArray(state.bad) ? (state.bad as Record<string, string>) : {};

/**
 * A UI instalada que a janela sobe na próxima abertura, na ordem do `start()` do engine no modo host: a nova (`next`),
 * a que ganhou outra chance (`retry`), a atual e as boas. Fica de fora a que falhou e a que não é mais nova que a de
 * fábrica (o engine nunca sobe essa). Null: sobe a de fábrica.
 */
export function installedToBoot(state: Record<string, unknown> | null, builtIn: BuiltInVersion): Manifest | null {
  if (!state) return null;
  const bad = badOf(state);
  const order = [manifestOf(state.next), manifestOf(state.retry), manifestOf(state.current), ...goodOf(state)];
  return order.find((m) => m !== null && !(m.sha256 in bad) && m.seq > builtIn.seq) ?? null;
}

/** A UI de uma janela fechada, pelo engine.json: a que sobe na próxima abertura. */
export function closedWindowStatus(dir: string, builtIn: BuiltInVersion): UiStatus {
  const m = installedToBoot(readState(dir), builtIn);
  return m ? { uiVersion: m.uiVersion, builtIn: false, pending: null } : { uiVersion: builtIn.uiVersion, builtIn: true, pending: null };
}

/** A UI na tela de uma janela aberta: a instalada (o sha dela) ou a de fábrica (null). */
export type OnScreen = { sha256: string } | null;

/**
 * O estado depois do "Voltar à aparência anterior". O alvo é a UI que a pessoa vê: numa janela aberta, a da tela
 * (`onScreen`); numa fechada, a que subiria na próxima abertura. O alvo e as mais novas que ele (o `next` que espera o
 * Recarregar, o `retry`) vão para o `bad` e saem do `current` e das boas; sobe a anterior boa, ou a de fábrica.
 * Com a de fábrica na tela, não há anterior: só a nova que espera é descartada, para o Voltar não ser desfeito pelo
 * Recarregar ou pela próxima abertura. Null: nada a desfazer.
 */
export function revertedState(state: Record<string, unknown> | null, builtIn: BuiltInVersion, onScreen?: OnScreen): Record<string, unknown> | null {
  if (!state) return null;
  const bad = badOf(state);
  const installed = [manifestOf(state.next), manifestOf(state.retry), manifestOf(state.current), ...goodOf(state)].filter(
    (m): m is Manifest => m !== null && !(m.sha256 in bad) && m.seq > builtIn.seq,
  );
  const target = onScreen === undefined ? installedToBoot(state, builtIn) : onScreen && installed.find((m) => m.sha256 === onScreen.sha256);
  const waiting = [manifestOf(state.next), manifestOf(state.retry)].filter((m): m is Manifest => m !== null && !(m.sha256 in bad));
  // Uma instalada na tela que o engine.json não conhece mais: não há o que mexer com segurança.
  if (onScreen && !target) return null;
  const drop = target ? [target, ...waiting.filter((m) => m.seq >= target.seq)] : waiting;
  if (drop.length === 0) return null;
  const nextBad = { ...bad };
  for (const m of drop) nextBad[m.sha256] = REVERT_REASON;
  const gone = new Set(drop.map((m) => m.sha256));
  const keep = (m: Manifest | null) => (m && !gone.has(m.sha256) ? m : null);
  const good = goodOf(state).filter((m) => !gone.has(m.sha256));
  const strikes = { ...((state.strikes as Record<string, number> | undefined) ?? {}) };
  for (const sha of gone) delete strikes[sha];
  return {
    ...state,
    current: keep(manifestOf(state.current)),
    next: keep(manifestOf(state.next)),
    retry: keep(manifestOf(state.retry)),
    good,
    bad: nextBad,
    strikes,
    // Como o engine faz ao banir: o teto do esquema de dados volta ao das boas que ficaram.
    dataSchemaHighWater: Math.max(0, ...good.map((m) => m.dataSchema)),
  };
}

/**
 * Volta a janela à aparência anterior, com o engine dela parado. `onScreen`: a UI na tela de uma janela aberta (sem ele,
 * a janela está fechada). Devolve se havia o que desfazer.
 */
export function revertWindow(dir: string, builtIn: BuiltInVersion, onScreen?: OnScreen): boolean {
  if (!existsSync(engineFile(dir))) return false;
  const next = revertedState(readState(dir), builtIn, onScreen);
  if (!next) return false;
  // Gravado de uma vez (tmp + rename): um engine.json pela metade faria o engine começar do zero.
  const tmp = `${engineFile(dir)}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  renameSync(tmp, engineFile(dir));
  return true;
}
