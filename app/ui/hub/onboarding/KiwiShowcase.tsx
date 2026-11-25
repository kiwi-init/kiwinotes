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
import { useT } from "../../src/i18n.ts";
import {
  catState,
  dotLabel,
  exampleMs,
  nextIndex,
  type Scene,
  sceneAt,
  SHOWCASE,
  type ShowcaseContent,
  stillScene,
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
function Result({ scene, c }: { scene: Scene; c: ShowcaseContent }) {
  const done = scene.phase === "resultado";
  const { folder: FOLDER, found: FOUND, meeting: MEETING, proposal: PROPOSAL, sheet: SHEET } = c;
  switch (c.examples[scene.index]!.id) {
    case "organizar":
      return (
        <div className="kn-show-note" data-done={done}>
          <div className="kn-show-note-bar">{c.noteTitle}</div>
          {done ? (
            <div className="kn-show-note-body kn-show-in">
              {c.tidy.map((l, i) =>
                l.kind === "h" ? <h3 key={i}>{l.text}</h3> : <p key={i} data-kind={l.kind}>{l.kind === "todo" ? <i aria-hidden="true" /> : null}{l.text}</p>,
              )}
            </div>
          ) : (
            <div className="kn-show-note-body kn-show-messy">
              {c.messy.map((l, i) => <p key={i} style={{ "--n": i } as never}>{l}</p>)}
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
            {MEETING.title} · {MEETING.length} · {MEETING.ended}
          </div>
          {done ? (
            <div className="kn-show-proposal kn-show-in">
              <div className="kn-show-proposal-to">{PROPOSAL.to} <strong>{PROPOSAL.note}</strong></div>
              <h3>{PROPOSAL.summaryTitle}</h3>
              {PROPOSAL.summary.map((s) => <p key={s}>{s}</p>)}
              <h3>{PROPOSAL.todosTitle}</h3>
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
                <span>{FOUND.alsoTitle}</span>
                {FOUND.also.map((n) => <div key={n}>{n}</div>)}
              </div>
            </>
          ) : (
            <div className="kn-show-search" aria-hidden="true">{FOUND.searching.map((n) => <div key={n}>{n}</div>)}</div>
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
  const { t, locale } = useT();
  const c = SHOWCASE[locale];
  const EXAMPLES = c.examples;
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
        <h1 id="kn-show-title" className="kn-onb-title" tabIndex={-1} ref={title}>{c.title}</h1>
        <p className="kn-onb-hint">{c.hint}</p>
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
                <strong>{t("hub.cat.name")}</strong>
                <span>{kiwiLine ?? (example.ask ? c.listening : c.meetingEnded)}</span>
              </p>
            </div>
          </div>
          <div className="kn-show-result" key={example.id}>
            <Result scene={scene} c={c} />
          </div>
        </div>
        <ol className="kn-show-dots" aria-label={c.dots}>
          {EXAMPLES.map((e, i) => (
            <li key={e.id}>
              <button type="button" aria-label={dotLabel(i)} aria-current={i === index ? "step" : undefined} data-on={i === index}
                onClick={() => { setIndex(i); setRun((r) => r + 1); }}>
                <span>{e.label}</span>
              </button>
            </li>
          ))}
        </ol>
        <p className="kn-onb-soon">{c.staged}</p>
      </section>
      <footer className="kn-onb-actions">
        <Button onClick={onSkip}>{t("common.skip")}</Button>
        <Button variant="primary" onClick={onContinue}>{t("common.continue")}</Button>
      </footer>
    </div>
  );
}
