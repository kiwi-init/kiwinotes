// "Anotei: …" (spec #11469, T11665): quando o agente anota ou esquece um fato na memória, o balão do gato mostra o
// fato com o [Desfazer]. Aparece depois que o balão da resposta sai e fica uns segundos; o [Desfazer] é o
// `agent.memoryUndo`. Nunca tira o foco.

import { useEffect, useRef, useState } from "react";

import type { AgentMemoryView } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
import { Button } from "../src/kit/index.tsx";

/** Quanto o balão fica na tela depois de aparecer. */
export const MEMORY_BUBBLE_MS = 12_000;

type Last = NonNullable<AgentMemoryView["last"]>;

/** A frase do balão para uma mudança na memória. */
export function memoryBubbleLine(last: Last): string {
  if (last.undone) return last.action === "remember" ? `Desfeito: não anotei "${last.fact}".` : `Desfeito: "${last.fact}" voltou para a memória.`;
  return last.action === "remember" ? `Anotei: ${last.fact}` : `Esqueci: ${last.fact}`;
}

export function MemoryBubble({ hidden, onShown }: { hidden: boolean; onShown?: (shown: boolean) => void }) {
  const [last, setLast] = useState<Last | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!has("agent.memory")) return;
    let seen: string | null = null;
    const off = api.agent.onMemory((v) => {
      // Só uma mudança nova (ou o desfeito da mostrada) abre o balão; a tela de Ajustes mudando a lista não.
      if (!v.last || (v.last.id === seen && !v.last.undone)) return;
      seen = v.last.id;
      setFailure(null);
      setLast(v.last);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setLast(null), MEMORY_BUBBLE_MS);
    });
    return () => {
      off();
      clearTimeout(timer.current);
    };
  }, []);

  const shown = !!last && !hidden;
  useEffect(() => onShown?.(!!last), [!!last]);
  if (!shown) return null;
  const keepFocus = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) e.preventDefault();
  };
  return (
    <div className="kn-bubble-shell kn-bubble kn-memory-bubble" onMouseDown={keepFocus} role="status" aria-label="A memória do agente">
      <p className="kn-memory-line">{memoryBubbleLine(last!)}</p>
      {failure ? <p className="kn-memory-note">{failure}</p> : null}
      <div className="kn-memory-actions">
        {!last!.undone ? (
          <Button
            onClick={() =>
              void api.agent.memoryUndo(last!.id).catch((e: unknown) => setFailure(e instanceof Error ? e.message : String(e)))
            }
          >
            Desfazer
          </Button>
        ) : null}
        <Button onClick={() => setLast(null)}>Ok</Button>
      </div>
    </div>
  );
}
