// O Apple Foundation Models pelo sidecar Swift (`llm.complete`, ADR 0001).

import type { Command, LlmStatus, ResultMessage } from "../shared/ipc.ts";
import type { LlmBackend } from "./types.ts";

type LlmComplete = Extract<Command, { type: "llm.complete" }>;

export interface SidecarLlmDeps {
  /** Manda o comando ao sidecar e resolve com o `result` dele. */
  request(command: LlmComplete, signal: AbortSignal): Promise<ResultMessage<"llm.complete">>;
  /** O último `llm` que chegou no `ready` ou no `permissions.changed`. */
  status(): LlmStatus | undefined;
}

export function sidecarLlm(deps: SidecarLlmDeps): LlmBackend {
  return {
    name: "foundation-models",
    available: () => deps.status()?.available === true,
    async complete(req, signal) {
      const result = await deps.request(
        {
          type: "llm.complete",
          system: req.system,
          prompt: req.prompt,
          maxTokens: req.maxTokens,
          temperature: req.temperature,
          timeoutMs: req.timeoutMs,
        },
        signal,
      );
      if (!result.ok) throw new Error(result.error);
      return result.data.text;
    },
  };
}
