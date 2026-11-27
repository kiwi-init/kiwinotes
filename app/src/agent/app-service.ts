// O serviço do agente como o app e o headless montam (T8678). No app, o agente é o Claude Code instalado, pelo
// adaptador baixado (#8368). As chaves de teste só valem no headless (`KIWI_HEADLESS=1`, que a CLI liga).
//
// **No headless, o agente é sempre o falso** (T32699, issue #461): o agente falso no lugar do adaptador, o `claude` e o
// `agy` falsos nas conferências, e nenhum download vai ao npm de verdade. Sem `KIWI_ADAPTER_REGISTRY`, o download cai
// num endereço local fechado e falha (`E_ADAPTER_OFFLINE`). Nenhum binário de agente deste Mac é procurado nem rodado.
//
//   KIWI_REAL_AGENT=1            o agente de verdade no headless (o `claude`/`agy` instalados e o npm). Só o harry, a
//                                pedido do lead (ADR 0011); nenhum roteiro do repo usa.
//   KIWI_FAKE_AGENT=1            o padrão; os roteiros antigos ainda a passam, e ela não muda nada
//   KIWI_ADAPTER_REGISTRY=<url>  o registro do npm (um falso, local)
//   KIWI_ADAPTER_PACKAGES=<json> a lista de pacotes que esse registro serve (nome, versão, integrity, size)
//   KIWI_AGENT_IDLE_MS=<ms>      o teto sem uso, para os testes não esperarem 10 minutos
//
// Fora do headless, nenhuma delas é lida: o app de verdade nunca troca de agente nem de registro por uma variável.

import { readFileSync } from "node:fs";
import path from "node:path";

import { claudeAdapterHost, agentDir, CLAUDE_CODE } from "./adapter/open.ts";
import type { PinnedPackage } from "./adapter/pinned.ts";
import { findClaude, type ProgramArgv } from "./claude.ts";
import { findGeminiAgent } from "./agy.ts";
import { geminiHost } from "./gemini-host.ts";
import { FAKE_AGENT_COMMAND, FAKE_AGY, FAKE_CLAUDE } from "./fake/index.ts";
import { AgentHost } from "./host.ts";
import { AgentService } from "./service.ts";
import type { AgentSettings, AppSettings, SettingsPatch } from "../store/settings.ts";

export interface AppAgentOptions {
  data: string;
  settings: {
    load(): Promise<AppSettings>;
    update(change: (current: AppSettings) => SettingsPatch | null): Promise<AppSettings>;
  };
  env?: Record<string, string | undefined>;
  log?: (msg: string) => void;
}

/** O registro do headless com o agente falso e sem `KIWI_ADAPTER_REGISTRY`: uma porta local fechada, nunca o npm. */
export const NO_REGISTRY = "http://127.0.0.1:9/kiwi-headless-sem-registro";

export function appAgentService(o: AppAgentOptions): AgentService {
  const env = o.env ?? process.env;
  const headless = env.KIWI_HEADLESS === "1";
  const fake = headless && env.KIWI_REAL_AGENT !== "1";
  const settings = {
    load: async (): Promise<AgentSettings> => (await o.settings.load()).agent,
    save: async (patch: Partial<AgentSettings>): Promise<AgentSettings> =>
      (await o.settings.update((current) => ({ agent: { ...current.agent, ...patch } }))).agent,
  };
  const packages =
    headless && env.KIWI_ADAPTER_PACKAGES ? (JSON.parse(readFileSync(env.KIWI_ADAPTER_PACKAGES, "utf8")) as PinnedPackage[]) : undefined;
  const idle = headless && env.KIWI_AGENT_IDLE_MS ? Number(env.KIWI_AGENT_IDLE_MS) : undefined;
  // O relógio de teste do headless (spec #12150, a prova das rotinas): começa na hora dada e anda junto com o de verdade.
  const clockStart = headless && env.KIWI_CLOCK_START ? Date.parse(env.KIWI_CLOCK_START) : NaN;
  const boot = Date.now();
  const now = Number.isFinite(clockStart) ? () => clockStart + (Date.now() - boot) : undefined;
  const gemini = (): ProgramArgv | null => {
    if (fake) return FAKE_AGY;
    const found = findGeminiAgent();
    return found ? [found] : null;
  };
  const fakeLog = { KIWI_FAKE_AGENT_LOG: path.join(o.data, "fake-agent.jsonl") };
  return new AgentService({
    data: o.data,
    settings,
    gemini,
    claude: () => {
      if (fake) return FAKE_CLAUDE;
      const found = findClaude();
      return found ? [found] : null;
    },
    openHost: async ({ kind, configOptions, kiwiTools, webTools, onExit }) => {
      const host = { configOptions, onExit, ...(kiwiTools ? { kiwiTools } : {}), ...(webTools ? { webTools } : {}) };
      // O Gemini (spec #24666): o instalado, ou o falso no headless, abertos do mesmo jeito.
      if (kind === "gemini") return (await geminiHost({ data: o.data, program: gemini(), env: fake ? { ...process.env, ...fakeLog } : env, host })).host;
      return fake
        ? new AgentHost({
            name: CLAUDE_CODE,
            command: FAKE_AGENT_COMMAND,
            dir: agentDir(o.data),
            configOptions,
            onExit,
            ...(kiwiTools ? { kiwiTools } : {}),
            ...(webTools ? { webTools } : {}),
            env: { ...process.env, ...fakeLog },
          })
        : (await claudeAdapterHost({ data: o.data, claudePath: findClaude(), host })).host;
    },
    ...(headless && env.KIWI_ADAPTER_REGISTRY
      ? { registry: env.KIWI_ADAPTER_REGISTRY }
      : fake
        ? { registry: NO_REGISTRY }
        : {}),
    ...(packages ? { packages } : {}),
    ...(idle && Number.isFinite(idle) && idle > 0 ? { idleMs: idle } : {}),
    ...(now ? { now } : {}),
    log: o.log,
  });
}
