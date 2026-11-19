// A tela do que o Kiwi faz (T20838, spec #20828): depois do "Vamos lá" da boas-vindas, antes do consentimento. Quatro
// exemplos encenados que passam sozinhos, cada um com o pedido e o resultado acontecendo. Nada chama o agente: os
// textos e as notas são inventados (`showcaseText.ts`). Os pontos pulam entre os exemplos; "Continuar" e "Pular"
// seguem o caminho de quem monta a tela. Com Reduzir movimento, cada exemplo fica parado no resultado, um por vez.
import "./onboarding.css";
import "./showcase.css";

import { useEffect, useRef, useState } from "react";

import { DEFAULT_CAT_COLOR } from "../../../src/shared/kiwicat-colors.ts";
import { Button } from "../../src/kit/index.tsx";
import type { createKiwiCat } from "../../kiwicat/cat.ts";
import type { FogState } from "../../kiwicat/visual.ts";
import {
  catState,
  dotLabel,
  EXAMPLES,
  exampleMs,
  FOLDER,
  FOUND,
  MEETING,
  MESSY_NOTE,
  nextIndex,
  PROPOSAL,
  type Scene,
  sceneAt,
  SHEET,
  SHOWCASE_HINT,
  SHOWCASE_STAGED,
  SHOWCASE_TITLE,
  stillScene,
  TIDY_NOTE,
} from "./showcaseText.ts";

type Cat = Awaited<ReturnType<typeof createKiwiCat>>;

const theme = (): "light" | "dark" => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
const osReduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** O Kiwi pequeno ao lado da fala: ouve o pedido, pensa, termina. */
function SmallCat({ estado, cor, reduced }: { estado: FogState; cor: string; reduced: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const handle = useRef<Cat | undefined>(undefined);
  const first = useRef({ estado, cor, reduced });
  useEffect(() => handle.current?.update({ estado }), [estado]);
  useEffect(() => handle.current?.update({ cor }), [cor]);
  useEffect(() => handle.current?.update({ parado: reduced }), [reduced]);
  useEffect(() => {
    const el = root.current!;
    let gone = false;
    void (async () => {
      try {
        const { createKiwiCat } = await import("../../kiwicat/cat.ts");
        if (gone) return;
        const start = first.current;
        const cat = await createKiwiCat(el, {
          mode: "runtime",
          width: 72,
          height: 72,
          cutout: true,
          background: theme(),
          inputs: { estado: start.estado, cor: start.cor, voz: null, parado: start.reduced },
        });
        if (gone) return void (await cat.dispose());
        handle.current = cat;
        el.dataset.ready = "true";
      } catch {
        el.replaceChildren();
      }
    })();
    return () => {
      gone = true;
      void handle.current?.dispose();
      handle.current = undefined;
    };
  }, []);
  return <div className="kn-show-cat" ref={root} aria-hidden="true" />;
}

/** O resultado de cada exemplo, na fase em que a cena está. */
function Result({ scene }: { scene: Scene }) {
  const done = scene.phase === "resultado";
  switch (EXAMPLES[scene.index]!.id) {
    case "organizar":
      return (
        <div className="kn-show-note" data-done={done}>
          <div className="kn-show-note-bar">Anotações da semana</div>
          {done ? (
            <div className="kn-show-note-body kn-show-in">
              {TIDY_NOTE.map((l, i) =>
                l.kind === "h" ? <h3 key={i}>{l.text}</h3> : <p key={i} data-kind={l.kind}>{l.kind === "todo" ? <i aria-hidden="true" /> : null}{l.text}</p>,
              )}
            </div>
          ) : (
            <div className="kn-show-note-body kn-show-messy">
              {MESSY_NOTE.map((l, i) => <p key={i} style={{ "--n": i } as never}>{l}</p>)}
            </div>
          )}
        </div>
      );
    case "documento":
      return (
        <div className="kn-show-folder">
          <div className="kn-show-files">
            <div className="kn-show-folder-name">{FOLDER.name}</div>
            {FOLDER.before.map((f) => <div key={f} className="kn-show-file">{f}</div>)}
            {done ? <div className="kn-show-file kn-show-in" data-new="true">{FOLDER.created}</div> : null}
          </div>
          {done ? (
            <table className="kn-show-sheet kn-show-in">
              <tbody>
                {SHEET.map((row, r) => (
                  <tr key={r} data-head={r === 0} data-total={r === SHEET.length - 1}>
                    {row.map((c, i) => (r === 0 ? <th key={i}>{c}</th> : <td key={i}>{c}</td>))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="kn-show-sheet-empty" />
          )}
        </div>
      );
    case "reuniao":
      return (
        <div className="kn-show-meeting">
          <div className="kn-show-meeting-bar">
            <span className="kn-show-dot" aria-hidden="true" />
            {MEETING.title} · {MEETING.length} · terminou
          </div>
          {done ? (
            <div className="kn-show-proposal kn-show-in">
              <div className="kn-show-proposal-to">Para a nota <strong>{PROPOSAL.note}</strong></div>
              <h3>Resumo</h3>
              {PROPOSAL.summary.map((s) => <p key={s}>{s}</p>)}
              <h3>Tarefas</h3>
              {PROPOSAL.todos.map((s) => <p key={s} data-kind="todo"><i aria-hidden="true" />{s}</p>)}
              {/* Encenado: os botões só mostram como a proposta chega; não fazem nada. */}
              <div className="kn-show-fake-actions" aria-hidden="true">
                <span>{PROPOSAL.dismiss}</span>
                <span data-primary="true">{PROPOSAL.approve}</span>
              </div>
            </div>
          ) : (
            <div className="kn-show-wave" aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <i key={i} style={{ "--i": i } as never} />)}</div>
          )}
        </div>
      );
    case "achar":
      return (
        <div className="kn-show-found">
          {done ? (
            <>
              <div className="kn-show-hit kn-show-in">
                <div className="kn-show-hit-path">{FOUND.path}</div>
                <p>{FOUND.before}<mark>{FOUND.hit}</mark>{FOUND.after}</p>
              </div>
              <div className="kn-show-also kn-show-in">
                <span>Também fala do prazo:</span>
                {FOUND.also.map((n) => <div key={n}>{n}</div>)}
              </div>
            </>
          ) : (
            <div className="kn-show-search" aria-hidden="true">{["Projeto X › Ideias", "Projeto X › Cronograma", "Projeto X › Reuniões"].map((n) => <div key={n}>{n}</div>)}</div>
          )}
        </div>
      );
  }
}

export function KiwiShowcase({
  onContinue,
  onSkip,
  cor = DEFAULT_CAT_COLOR,
  reduced: appReduced = false,
}: {
  onContinue: () => void;
  onSkip: () => void;
  cor?: string;
  reduced?: boolean;
}) {
  const reduced = appReduced || osReduced();
  const [index, setIndex] = useState(0);
  const [ms, setMs] = useState(0);
  // Clicar no ponto do exemplo que já está na tela recomeça o exemplo.
  const [run, setRun] = useState(0);
  const title = useRef<HTMLHeadingElement>(null);

  useEffect(() => title.current?.focus(), []);

  // A linha do tempo: um relógio por exemplo; no fim, o próximo. Com Reduzir movimento, nada anda sozinho.
  useEffect(() => {
    if (reduced) return;
    const total = exampleMs(EXAMPLES[index]!);
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = now - start;
      if (t >= total) return setIndex(nextIndex(index));
      setMs(t);
      raf = requestAnimationFrame(tick);
    };
    setMs(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [index, run, reduced]);

  const scene = reduced ? stillScene(index) : sceneAt(index, ms);
  const example = EXAMPLES[index]!;
  const kiwiLine = scene.phase === "trabalhando" ? example.working : scene.phase === "resultado" ? example.done : null;

  return (
    <div className="kn-onb kn-show" role="dialog" aria-modal="true" aria-labelledby="kn-show-title" data-motion={reduced ? "reduced" : "full"}>
      <section className="kn-onb-step kn-show-step">
        <h1 id="kn-show-title" className="kn-onb-title" tabIndex={-1} ref={title}>{SHOWCASE_TITLE}</h1>
        <p className="kn-onb-hint">{SHOWCASE_HINT}</p>
        <div className="kn-show-stage" data-example={example.id} data-phase={scene.phase} aria-live="polite" aria-label={example.label}>
          <div className="kn-show-chat">
            {scene.ask !== null ? (
              <p className="kn-show-ask" aria-label={scene.ask}>
                <span aria-hidden="true">{scene.ask.slice(0, scene.typed)}</span>
                {scene.phase === "pedido" && !reduced ? <span className="kn-show-caret" aria-hidden="true" /> : null}
              </p>
            ) : null}
            <div className="kn-show-kiwi">
              <SmallCat estado={catState(scene.phase)} cor={cor} reduced={reduced} />
              <p className="kn-show-line" data-phase={scene.phase}>
                <strong>Kiwi</strong>
                <span>{kiwiLine ?? (example.ask ? "Ouvindo…" : "A reunião terminou.")}</span>
              </p>
            </div>
          </div>
          <div className="kn-show-result" key={example.id}>
            <Result scene={scene} />
          </div>
        </div>
        <ol className="kn-show-dots" aria-label="Exemplos">
          {EXAMPLES.map((e, i) => (
            <li key={e.id}>
              <button type="button" aria-label={dotLabel(i)} aria-current={i === index ? "step" : undefined} data-on={i === index}
                onClick={() => { setIndex(i); setRun((r) => r + 1); }}>
                <span>{e.label}</span>
              </button>
            </li>
          ))}
        </ol>
        <p className="kn-onb-soon">{SHOWCASE_STAGED}</p>
      </section>
      <footer className="kn-onb-actions">
        <Button onClick={onSkip}>Pular</Button>
        <Button variant="primary" onClick={onContinue}>Continuar</Button>
      </footer>
    </div>
  );
}
