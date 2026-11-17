// Os testes das ações (T14563) chamam pelo nome de dentro (`notes_read`), e o servidor só tem a `kiwi`: este é o
// `tools/call` que o agente faria para aquela ação, pela mesma tradução do agente falso (`kiwiCallFor`).

import { ACOES, KIWI_TOOL, kiwiCallFor } from "./kiwi-tool.ts";

export function asKiwi(name: string, args: unknown): { name: string; arguments: unknown } {
  if (!ACOES.some((a) => a.tool === name)) return { name, arguments: args };
  const plain = !!args && typeof args === "object" && !Array.isArray(args);
  return { name: KIWI_TOOL, arguments: plain ? kiwiCallFor(name, args as Record<string, unknown>) : args };
}
