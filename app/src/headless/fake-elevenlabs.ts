// O ElevenLabs de mentira do headless (T31628, spec #31616): `KIWI_FAKE_ELEVENLABS` é um JSON com o estado dos Ajustes,
// para os testes, os roteiros e os prints. Nada vai à rede nem ao Keychain: a chave "guardada" fica só na memória deste
// processo, e o "Testar" não toca som.
//   { "hasKey": true, "test": "ok" | "<motivo>", "fallback": { "reason": "<motivo>", "at": "2026-11-26T10:00:00Z" } }

import type { CapabilityDeps } from "../bun/ui-capabilities.ts";
import { type ElevenLabsReason, isElevenLabsReason } from "../shared/elevenlabs.ts";

interface FakeElevenLabs {
  hasKey?: boolean;
  test?: "ok" | ElevenLabsReason;
  fallback?: { reason: ElevenLabsReason; at: string } | null;
}

/** Lê o JSON; o que não for o formato acima lança, para o roteiro errado falhar logo. */
export function parseFakeElevenLabs(raw: string): FakeElevenLabs {
  const v = JSON.parse(raw) as Record<string, unknown>;
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("KIWI_FAKE_ELEVENLABS: esperava um objeto");
  if (v.hasKey !== undefined && typeof v.hasKey !== "boolean") throw new Error("KIWI_FAKE_ELEVENLABS: hasKey é true ou false");
  if (v.test !== undefined && v.test !== "ok" && !isElevenLabsReason(v.test)) throw new Error("KIWI_FAKE_ELEVENLABS: test é ok ou um motivo");
  const f = v.fallback as { reason?: unknown; at?: unknown } | null | undefined;
  if (f != null && (!isElevenLabsReason(f.reason) || typeof f.at !== "string" || Number.isNaN(Date.parse(f.at))))
    throw new Error("KIWI_FAKE_ELEVENLABS: fallback é { reason, at }");
  return v as FakeElevenLabs;
}

export function fakeElevenLabs(raw: string): NonNullable<CapabilityDeps["elevenLabs"]> {
  const state = parseFakeElevenLabs(raw);
  let key: string | null = state.hasKey ? "chave-de-exemplo" : null;
  return {
    hasKey: async () => key !== null,
    setKey: async (k) => {
      key = k;
    },
    deleteKey: async () => {
      key = null;
    },
    speakOnce: async () => {
      const r = state.test ?? "ok";
      if (r !== "ok") throw Object.assign(new Error(r), { reason: r });
    },
    lastFallback: () => state.fallback ?? null,
  };
}
