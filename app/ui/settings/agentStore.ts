// O estado do agente, um só para as 5 abas de Ajustes › Agente (spec #31754, T31765). Todas as abas ficam montadas:
// sem isto, cada uma leria o `agent.status` (com `refresh`, que confere os programas instalados) e ouviria os eventos
// por conta própria. A primeira aba que monta lê e assina; a última que desmonta solta, e a próxima abertura lê de novo.

import { useEffect, useSyncExternalStore } from "react";

import type { AgentStatus } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";

export type AgentSnapshot = { status: AgentStatus | null; failure: string | null; checking: boolean };

const EMPTY: AgentSnapshot = { status: null, failure: null, checking: false };
let snap: AgentSnapshot = EMPTY;
const subs = new Set<() => void>();
let users = 0;
let off: (() => void) | null = null;
/** Conta os eventos `agent.status`: a resposta de uma chamada só vale se nenhum evento chegou durante ela. */
let events = 0;
/** Cada abertura ganha um número: a leitura de uma abertura que já fechou não escreve na próxima. */
let epoch = 0;

const set = (p: Partial<AgentSnapshot>) => {
  snap = { ...snap, ...p };
  for (const f of subs) f();
};

function start(readFailed: string) {
  const mine = ++epoch;
  const alive = () => mine === epoch && users > 0;
  set({ checking: true });
  api.agent
    .status(true)
    .then(
      (s) => alive() && set({ status: s }),
      () => alive() && set({ failure: readFailed }),
    )
    .finally(() => alive() && set({ checking: false }));
  off = api.agent.onStatus((s) => {
    events++;
    if (alive()) set({ status: s });
  });
}

function stop() {
  off?.();
  off = null;
  epoch++;
  snap = EMPTY;
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};

/** O estado compartilhado; `readFailed` é o texto da falha de leitura, na língua da tela. */
export function useAgentStore(readFailed: string): AgentSnapshot {
  useEffect(() => {
    if (!has("agent.status")) return;
    if (users++ === 0) start(readFailed);
    return () => {
      if (--users === 0) stop();
    };
    // A leitura é só na abertura: o texto da falha é o da língua de quando abriu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return useSyncExternalStore(subscribe, () => snap);
}

export const setAgentStatus = (status: AgentStatus) => set({ status });
export const setAgentFailure = (failure: string | null) => set({ failure });
export const setAgentChecking = (checking: boolean) => set({ checking });

/**
 * Chama uma capacidade e mostra o erro dela, sem derrubar a tela. O estado que ela devolve é de antes do fim (o
 * `cancel` responde antes de o download parar): se um evento chegou no meio, ele é mais novo e fica.
 */
export async function runAgent(call: () => Promise<AgentStatus | unknown>) {
  set({ failure: null });
  const before = events;
  try {
    const r = await call();
    if (r && typeof r === "object" && "adapter" in r && events === before) set({ status: r as AgentStatus });
  } catch (e) {
    set({ failure: e instanceof Error ? e.message : String(e) });
  }
}
