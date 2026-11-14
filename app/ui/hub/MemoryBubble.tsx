// "Anotei: …" (spec #11469, T11665): quando o agente anota ou esquece fatos na memória, o balão do gato mostra cada
// mudança do pedido, cada uma com o seu [Desfazer] (`agent.memoryUndo`). Aparece depois que o balão da resposta sai e
// fica uns segundos. Nunca tira o foco.

import { useEffect, useRef, useState } from "react";

import type { AgentMemoryView } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
import { useHubNav } from "../src/hubNav.ts";
import { Button } from "../src/kit/index.tsx";
import { MEMORY_TITLE, overLine } from "../settings/memoryText.ts";
import { BubblePresence } from "./BubblePresence";

/** Quanto o balão fica na tela depois da última mudança. */
export const MEMORY_BUBBLE_MS = 12_000;

type Change = AgentMemoryView["changes"][number];

/** A frase do balão para uma mudança na memória. */
export function memoryBubbleLine(c: Change): string {
  if (c.action === "over") return overLine(c.over ?? { facts: 0, long: 0 });
  if (c.action === "full") return `A memória está cheia: não anotei "${c.fact}". Apague um fato em Ajustes › Agente › Memória.`;
  if (c.undone) return c.action === "remember" ? `Desfeito: não anotei "${c.fact}".` : `Desfeito: "${c.fact}" voltou para a memória.`;
  return c.action === "remember" ? `Anotei: ${c.fact}` : `Esqueci: ${c.fact}`;
}

export function MemoryBubble({ hidden, onShown, reduced = false }: { hidden: boolean; onShown?: (shown: boolean) => void; reduced?: boolean }) {
  const [changes, setChanges] = useState<Change[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** O balão está aberto: um [Desfazer] o atualiza. O [Ok] e o fim do tempo o fecham de vez (revisão do T11665). */
  const open = useRef(false);
  /** A memória cheia leva a Ajustes › Agente › Memória (spec #11966): o texto do balão vira um botão. */
  const nav = useHubNav();

  const close = () => {
    open.current = false;
    clearTimeout(timer.current);
    setChanges([]);
  };

  useEffect(() => {
    if (!has("agent.memory")) return;
    const seen = new Set<string>();
    const off = api.agent.onMemory((v) => {
      // Uma mudança nova abre o balão (e o reabre); um [Desfazer] atualiza o que está aberto. A tela de Ajustes mudando
      // a lista, sem mudança do agente, não abre nada.
      const fresh = v.changes.some((c) => !seen.has(c.id));
      for (const c of v.changes) seen.add(c.id);
      if (!fresh && !open.current) return;
      open.current = true;
      setFailure(null);
      setChanges(v.changes);
    });
    return () => {
      off();
      clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => onShown?.(changes.length > 0), [changes.length > 0]);
  const showing = changes.length > 0 && !hidden;
  const warn = changes.some((c) => c.action === "full" || c.action === "over");
  // O tempo conta só com o balão na tela (spec #12749): ele espera o balão da resposta sair, e uma resposta longa não o
  // faz sumir antes de aparecer. Uma mudança nova ou um [Desfazer] recomeça a conta.
  useEffect(() => {
    if (!showing) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(close, MEMORY_BUBBLE_MS);
    return () => clearTimeout(timer.current);
  }, [showing, changes]);
  const keepFocus = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) e.preventDefault();
  };
  const undo = (id: string) => void api.agent.memoryUndo(id).catch((e: unknown) => setFailure(e instanceof Error ? e.message : String(e)));
  // A troca entre os balões (spec #11652): o balão da memória é um só enquanto aberto; uma mudança nova muda o tamanho.
  return (
    <BubblePresence itemKey={showing ? "memoria" : null} reduced={reduced}>
      {showing ? (
        <div className="kn-bubble-shell kn-bubble kn-memory-bubble" onMouseDown={keepFocus} role="status" aria-label="A memória do agente">
          <ul className="kn-memory-list">
            {changes.map((c) => (
              <li key={c.id} className="kn-memory-item">
                <span className="kn-memory-line">{memoryBubbleLine(c)}</span>
                {!c.undone && c.action !== "full" && c.action !== "over" ? <Button onClick={() => undo(c.id)}>Desfazer</Button> : null}
              </li>
            ))}
          </ul>
          {failure ? <p className="kn-memory-note">{failure}</p> : null}
          {/* O aviso (a memória cheia ou acima do limite) tem uma ação principal, numa linha embaixo do texto, como o balão
              da proposta: [Abrir a memória], e o Ok em texto (revisão do T12771). */}
          {warn ? (
            <div className="kn-memory-actions" data-warn="true">
              {nav ? (
                <Button
                  variant="primary"
                  onClick={() => {
                    close();
                    nav.openSettings("agent", MEMORY_TITLE);
                  }}
                >
                  Abrir a memória
                </Button>
              ) : null}
              <Button data-role="dismiss" onClick={close}>
                Ok
              </Button>
            </div>
          ) : (
            <div className="kn-memory-actions">
              <Button onClick={close}>Ok</Button>
            </div>
          )}
        </div>
      ) : null}
    </BubblePresence>
  );
}
