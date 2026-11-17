// O seletor de microfone dos Ajustes pergunta ao helper (T3230). Fora da `Session` para testar sem subir o helper.

import type { Command, CommandResults } from "../shared/ipc.ts";
import { type AudioInputs, sanitizeAudioInputs } from "../shared/microphone.ts";

/**
 * As entradas de áudio pelo helper (T3230). null quando ele não está de pé, quando é antigo (`unknown_type`) ou quando
 * a resposta não é uma lista: o seletor dos Ajustes mostra então só as escolhas fixas.
 */
export async function listAudioInputs(
  send: (c: Extract<Command, { type: "audio.inputs" }>) => Promise<{ ok: true; data: CommandResults["audio.inputs"] } | { ok: false; error: string }>,
): Promise<AudioInputs | null> {
  const r = await send({ type: "audio.inputs" }).catch(() => undefined);
  return r?.ok ? sanitizeAudioInputs(r.data) : null;
}
