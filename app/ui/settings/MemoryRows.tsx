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
  dropFact,
  EDIT_GONE,
  factCount,
  outsideLine,
  skippedLine,
  skippedReason,
  INSTRUCTIONS_HINT,
  INSTRUCTIONS_MAX,
  INSTRUCTIONS_TITLE,
  instructionsCount,
  MEMORY_EMPTY,
  MEMORY_HINT,
  MEMORY_TITLE,
  replaceFact,
} from "./memoryText.ts";

/** O erro da capacidade, sem o nome dela na frente ("agent.memorySet: …"): a frase é para a pessoa. */
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^agent\.[a-zA-Z]+:\s*/, "");

export function MemoryRows({ status, run }: { status: AgentStatus; run: (call: () => Promise<unknown>) => Promise<void> }) {
  const [view, setView] = useState<AgentMemoryView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // O fato em edição pelo texto de origem (`from`), não pela posição: a lista muda ao vivo (revisão do T11668).
  const [editing, setEditing] = useState<{ from: string; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  /** O fato de fora em edição (spec #12749), pela posição na lista `skipped`. */
  const [fixing, setFixing] = useState<{ at: number; text: string } | null>(null);
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

  // O fato em edição sumiu (o agente o esqueceu ou mudou): a edição para, com o aviso, e nada é salvo.
  useEffect(() => {
    if (editing && view && !view.facts.includes(editing.from)) {
      setEditing(null);
      setFailure(EDIT_GONE);
    }
  }, [view, editing]);

  if (!view) return failure ? <Row label={MEMORY_TITLE} hint={failure} /> : null;
  const skipped = view.skipped ?? [];
  const save = (facts: string[], skipped?: string[]) =>
    void api.agent.memorySet(facts, skipped).then(
      (v) => {
        setView(v);
        setEditing(null);
        setFixing(null);
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
                {editing?.from === f ? (
                  <form
                    className="kn-memory-edit"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const next = replaceFact(view.facts, editing.from, editing.text);
                      if (next) save(next);
                      else {
                        setEditing(null);
                        setFailure(EDIT_GONE);
                      }
                    }}
                  >
                    <input className="kn-input" aria-label="O fato" value={editing.text} maxLength={300} onChange={(e) => setEditing({ from: f, text: e.target.value })} autoFocus />
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
                      <Button
                        onClick={() => {
                          setEditing({ from: f, text: f });
                          setFailure(null);
                        }}
                      >
                        Editar
                      </Button>
                      <Button
                        onClick={() => {
                          const next = dropFact(view.facts, f);
                          if (next) save(next);
                        }}
                      >
                        Apagar
                      </Button>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {skipped.length ? (
          <div className="kn-memory-skipped" role="group" aria-label="Os fatos que ficam de fora">
            <p className="kn-memory-warning">{skippedLine(skipped.length)}</p>
            <ul className="kn-memory-facts">
              {skipped.map((x, i) => (
                <li key={`${i}:${x.text}`} className="kn-memory-fact" data-reason={x.reason}>
                  {fixing?.at === i ? (
                    <form
                      className="kn-memory-edit"
                      onSubmit={(e) => {
                        e.preventDefault();
                        // Encurtado, ele vira um fato da lista; a linha longa sai do arquivo.
                        save([...view.facts, fixing.text], skipped.filter((_, j) => j !== i).map((y) => y.text));
                      }}
                    >
                      <input className="kn-input" aria-label="O fato" value={fixing.text} onChange={(e) => setFixing({ at: i, text: e.target.value })} autoFocus />
                      <Button variant="primary" type="submit" disabled={!fixing.text.trim() || fixing.text.trim().length > 300}>
                        Salvar
                      </Button>
                      <Button onClick={() => setFixing(null)}>Cancelar</Button>
                    </form>
                  ) : (
                    <>
                      <span className="kn-memory-fact-text">
                        {x.text}
                        <span className="kn-memory-reason">{skippedReason(x.reason)}</span>
                      </span>
                      <span className="kn-memory-fact-actions">
                        <Button
                          onClick={() => {
                            setFixing({ at: i, text: x.text });
                            setFailure(null);
                          }}
                        >
                          {x.reason === "long" ? "Encurtar" : "Editar"}
                        </Button>
                        <Button onClick={() => save(view.facts, skipped.filter((_, j) => j !== i).map((y) => y.text))}>Apagar</Button>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
            {fixing && fixing.text.trim().length > 300 ? <p className="kn-row-hint">{factCount(fixing.text.trim().length)}</p> : null}
          </div>
        ) : null}
        {view.outside ? <p className="kn-row-hint kn-memory-outside">{outsideLine(view.outside)}</p> : null}
        {failure ? (
          <p className="kn-memory-failure" role="alert">
            {failure}
          </p>
        ) : null}
        {view.facts.length + skipped.length ? (
          <div className="kn-memory-clear">
            {confirmClear ? (
              <>
                <span>{clearQuestion(view.facts.length + skipped.length)}</span>
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
