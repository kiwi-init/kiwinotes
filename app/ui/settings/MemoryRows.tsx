// A memória do agente em Ajustes › Agente (spec #11469, T11668): o que ele sabe sobre a pessoa (editar, apagar uma
// linha, apagar tudo) e as instruções da pessoa para ele. Tudo grava pelas capacidades: a memória pelo
// `agent.memorySet`/`agent.memoryClear` (com o filtro do guardrail) e as instruções pelo `agent.configure`.

import { useEffect, useState } from "react";

import type { AgentMemoryView, AgentStatus } from "../../src/shared/ui-contract.ts";
import { api, has } from "../src/api.ts";
import { Button, Row } from "../src/kit/index.tsx";
import {
  clearQuestion,
  countLine,
  INSTRUCTIONS_HINT,
  INSTRUCTIONS_MAX,
  INSTRUCTIONS_TITLE,
  instructionsCount,
  MEMORY_EMPTY,
  MEMORY_HINT,
  MEMORY_TITLE,
} from "./memoryText.ts";

/** O erro da capacidade, sem o nome dela na frente ("agent.memorySet: …"): a frase é para a pessoa. */
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^agent\.[a-zA-Z]+:\s*/, "");

export function MemoryRows({ status, run }: { status: AgentStatus; run: (call: () => Promise<unknown>) => Promise<void> }) {
  const [view, setView] = useState<AgentMemoryView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [draft, setDraft] = useState(status.instructions ?? "");
  const saved = status.instructions ?? "";

  useEffect(() => {
    if (!has("agent.memory")) return;
    let alive = true;
    const off = api.agent.onMemory((v) => alive && setView(v));
    void api.agent.memory().then(
      (v) => alive && setView(v),
      (e) => alive && setFailure(message(e)),
    );
    return () => {
      alive = false;
      off();
    };
  }, []);
  // As instruções que chegam de fora (outra janela) trocam o rascunho só se ele não foi mexido.
  useEffect(() => setDraft((d) => (d === "" || d === saved ? saved : d)), [saved]);

  if (!view) return failure ? <Row label={MEMORY_TITLE} hint={failure} /> : null;
  const save = (facts: string[]) =>
    void api.agent.memorySet(facts).then(
      (v) => {
        setView(v);
        setEditing(null);
        setFailure(null);
      },
      (e) => setFailure(message(e)),
    );

  return (
    <div className="kn-agent-memory" role="group" aria-label={MEMORY_TITLE}>
      <Row label={MEMORY_TITLE} hint={MEMORY_HINT} />
      <div className="kn-memory-box">
        <p className="kn-row-hint">{view.facts.length ? countLine(view.facts.length, view.max) : MEMORY_EMPTY}</p>
        {view.facts.length ? (
          <ul className="kn-memory-facts" aria-label="Os fatos da memória">
            {view.facts.map((f, i) => (
              <li key={`${i}:${f}`} className="kn-memory-fact">
                {editing?.index === i ? (
                  <form
                    className="kn-memory-edit"
                    onSubmit={(e) => {
                      e.preventDefault();
                      save(view.facts.map((x, j) => (j === i ? editing.text : x)));
                    }}
                  >
                    <input className="kn-input" aria-label="O fato" value={editing.text} maxLength={300} onChange={(e) => setEditing({ index: i, text: e.target.value })} autoFocus />
                    <Button variant="primary" type="submit" disabled={!editing.text.trim()}>
                      Salvar
                    </Button>
                    <Button
                      onClick={() => {
                        setEditing(null);
                        setFailure(null);
                      }}
                    >
                      Cancelar
                    </Button>
                  </form>
                ) : (
                  <>
                    <span className="kn-memory-fact-text">{f}</span>
                    <span className="kn-memory-fact-actions">
                      <Button onClick={() => setEditing({ index: i, text: f })}>Editar</Button>
                      <Button onClick={() => save(view.facts.filter((_, j) => j !== i))}>Apagar</Button>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {failure ? (
          <p className="kn-memory-failure" role="alert">
            {failure}
          </p>
        ) : null}
        {view.facts.length ? (
          <div className="kn-memory-clear">
            {confirmClear ? (
              <>
                <span>{clearQuestion(view.facts.length)}</span>
                <Button
                  variant="primary"
                  onClick={() =>
                    void api.agent.memoryClear().then(
                      (v) => {
                        setView(v);
                        setConfirmClear(false);
                      },
                      (e) => setFailure(message(e)),
                    )
                  }
                >
                  Apagar tudo
                </Button>
                <Button onClick={() => setConfirmClear(false)}>Cancelar</Button>
              </>
            ) : (
              <Button onClick={() => setConfirmClear(true)}>Apagar tudo</Button>
            )}
          </div>
        ) : null}
      </div>
      <Row label={INSTRUCTIONS_TITLE} hint={INSTRUCTIONS_HINT} />
      <div className="kn-memory-box">
        <textarea
          className="kn-input kn-memory-instructions"
          aria-label={INSTRUCTIONS_TITLE}
          value={draft}
          maxLength={INSTRUCTIONS_MAX}
          rows={4}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="kn-memory-clear">
          <span className="kn-row-hint">{instructionsCount(draft.length)}</span>
          <Button variant="primary" disabled={draft === saved} onClick={() => void run(() => api.agent.configure({ instructions: draft }))}>
            Salvar
          </Button>
        </div>
      </div>
    </div>
  );
}
