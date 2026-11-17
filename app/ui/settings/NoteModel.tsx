// O Modelo de nota (spec #11102, T11223): a pessoa monta, com um desenho em vez de texto, o padrão que o agente segue
// quando cria ou organiza uma nota. Fica em Ajustes › Agente e aparece na primeira vez que o agente fica pronto, com
// "Pular" (que guarda o padrão).
//
// - O desenho é só forma: retângulos e linhas esmaecidos, nada das notas da pessoa.
// - Os blocos se arrastam (o mouse) e sobem e descem pelos botões (o teclado), e cada um liga e desliga. Desligado, ele
//   some do desenho.
// - O corpo tem quatro estilos, cada um com a sua miniatura; o desenho grande muda na hora.
// - Cada mudança grava `.kiwi/modelo-de-nota.md` (`agent.noteModelSet`), e nenhuma nota é reescrita.
// - Com o Reduzir movimento, sem animação.

import { useEffect, useRef, useState } from "react";

import type { NoteModel } from "../../src/shared/ui-contract.ts";
import { api } from "../src/api.ts";
import { Button, Select, Switch } from "../src/kit/index.tsx";

type Block = NoteModel["blocks"][number]["block"];
type Body = NoteModel["body"];

export const BLOCK_LABEL: Record<Block, string> = {
  titulo: "Título",
  propriedades: "Propriedades",
  introducao: "Introdução",
  sumario: "Sumário",
  corpo: "Corpo",
  fechamento: "Fechamento",
};
export const BODY_LABEL: Record<Body, string> = {
  topicos: "Tópicos",
  curtos: "Parágrafos curtos",
  longos: "Parágrafos longos",
  misto: "Misto",
};
const BODIES: Body[] = ["topicos", "curtos", "longos", "misto"];

/** Move o bloco `from` para a posição `to` (os dois são índices na lista). */
export function moveBlock(model: NoteModel, from: number, to: number): NoteModel {
  if (from === to || from < 0 || to < 0 || from >= model.blocks.length || to >= model.blocks.length) return model;
  const blocks = [...model.blocks];
  const [b] = blocks.splice(from, 1);
  blocks.splice(to, 0, b!);
  return { ...model, blocks };
}

/** As linhas de um corpo em miniatura: `w` é a largura (0–1); `dot` é um tópico; `gap` separa parágrafos. */
function bodyLines(style: Body): { w: number; dot?: boolean; gap?: boolean }[] {
  switch (style) {
    case "topicos":
      return [0.7, 0.55, 0.8, 0.6, 0.5].map((w) => ({ w, dot: true }));
    case "curtos":
      return [{ w: 0.95 }, { w: 0.6 }, { w: 0, gap: true }, { w: 0.9 }, { w: 0.5 }];
    case "longos":
      return [{ w: 0.95 }, { w: 0.92 }, { w: 0.96 }, { w: 0.9 }, { w: 0.7 }];
    case "misto":
      return [{ w: 0.95 }, { w: 0.55 }, { w: 0.6, dot: true }, { w: 0.5, dot: true }, { w: 0.8 }];
  }
}

function BodyShape({ style }: { style: Body }) {
  return (
    <div className="kn-nm-lines">
      {bodyLines(style).map((l, i) =>
        l.gap ? <div key={i} className="kn-nm-gap" /> : (
          <div key={i} className="kn-nm-line-row">
            {l.dot ? <span className="kn-nm-dot" /> : null}
            <span className="kn-nm-line" style={{ width: `${Math.round(l.w * 100)}%` }} />
          </div>
        ),
      )}
    </div>
  );
}

/** A forma de cada bloco no desenho grande: só retângulos e linhas, sem texto. */
function BlockShape({ block, model }: { block: Block; model: NoteModel }) {
  switch (block) {
    case "titulo":
      return <div className="kn-nm-title" />;
    case "propriedades":
      return (
        <div className="kn-nm-props">
          {[0.3, 0.45, 0.35].map((w, i) => (
            <div key={i} className="kn-nm-line-row">
              <span className="kn-nm-key" />
              <span className="kn-nm-line" style={{ width: `${w * 100}%` }} />
            </div>
          ))}
        </div>
      );
    case "introducao":
      return <BodyShape style="curtos" />;
    case "sumario":
      return (
        <div className="kn-nm-toc">
          {[1, 2, 2, 1, 2, 3].filter((level) => level <= model.tocDepth).map((level, i) => (
            <div key={i} className="kn-nm-line-row" style={{ paddingLeft: `${(level - 1) * 12}px` }}>
              {model.numbered ? <span className="kn-nm-num" /> : null}
              <span className="kn-nm-line kn-nm-link" style={{ width: `${48 - level * 6}%` }} />
            </div>
          ))}
        </div>
      );
    case "corpo":
      return (
        <div className="kn-nm-body">
          <div className="kn-nm-line-row">
            {model.numbered ? <span className="kn-nm-num" /> : null}
            <span className="kn-nm-heading" />
          </div>
          <BodyShape style={model.body} />
        </div>
      );
    case "fechamento":
      return (
        <div className="kn-nm-close">
          <span className="kn-nm-heading kn-nm-heading-small" />
          {[0.5, 0.4].map((w, i) => (
            <div key={i} className="kn-nm-line-row">
              <span className="kn-nm-check" />
              <span className="kn-nm-line" style={{ width: `${w * 100}%` }} />
            </div>
          ))}
        </div>
      );
  }
}

export function NoteModelEditor({ first, onDone }: { first?: boolean; onDone?: () => void }) {
  const [model, setModel] = useState<NoteModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dragging = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void api.agent.noteModel().then((r) => alive && setModel(r.model), (e) => alive && setError(String((e as Error)?.message ?? e)));
    return () => {
      alive = false;
    };
  }, []);

  if (!model) return error ? <p className="kn-row-hint">{error}</p> : null;

  const save = (next: NoteModel) => {
    setModel(next);
    void api.agent.noteModelSet(next).then(setModel, (e) => setError(String((e as Error)?.message ?? e)));
  };
  const move = (from: number, to: number) => save(moveBlock(model, from, to));

  return (
    <div className="kn-nm" data-first={first || undefined}>
      <div className="kn-nm-head">
        <div className="kn-row-label">Modelo de nota</div>
        <div className="kn-row-hint">
          O jeito que o agente monta uma nota quando cria ou organiza. Arraste os blocos, ligue e desligue, e escolha o corpo. Mudar
          aqui não reescreve nenhuma nota.
        </div>
      </div>
      <div className="kn-nm-grid">
        <ol className="kn-nm-blocks" aria-label="Os blocos da nota, na ordem">
          {model.blocks.map((b, i) => (
            <li
              key={b.block}
              className="kn-nm-block"
              data-off={!b.on || undefined}
              data-over={over === i || undefined}
              data-block={b.block}
              draggable
              onDragStart={(e) => {
                dragging.current = i;
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", b.block);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(i);
              }}
              onDragLeave={() => setOver((o) => (o === i ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                if (dragging.current !== null) move(dragging.current, i);
                dragging.current = null;
              }}
              onDragEnd={() => {
                dragging.current = null;
                setOver(null);
              }}
            >
              <span className="kn-nm-grip" aria-hidden="true" />
              <span className="kn-nm-block-name">{BLOCK_LABEL[b.block]}</span>
              <span className="kn-nm-move">
                <button type="button" tabIndex={0} className="kn-nm-arrow" aria-label={`Subir ${BLOCK_LABEL[b.block]}`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                  ↑
                </button>
                <button
                  type="button"
                  tabIndex={0}
                  className="kn-nm-arrow"
                  aria-label={`Descer ${BLOCK_LABEL[b.block]}`}
                  disabled={i === model.blocks.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  ↓
                </button>
              </span>
              <Switch
                label={`${BLOCK_LABEL[b.block]} ligado`}
                checked={b.on}
                onChange={(on) => save({ ...model, blocks: model.blocks.map((x, j) => (j === i ? { ...x, on } : x)) })}
              />
            </li>
          ))}
        </ol>
        {/* O desenho grande: só formas. Um bloco desligado some daqui. */}
        <div className="kn-nm-page" aria-hidden="true" data-testid="note-model-drawing">
          {model.blocks
            .filter((b) => b.on)
            .map((b) => (
              <div key={b.block} className="kn-nm-part" data-part={b.block}>
                <BlockShape block={b.block} model={model} />
              </div>
            ))}
        </div>
      </div>
      <div className="kn-nm-bodies" role="radiogroup" aria-label="O estilo do corpo">
        {BODIES.map((style) => (
          <button
            key={style}
            type="button"
            tabIndex={0}
            role="radio"
            aria-checked={model.body === style}
            className="kn-nm-body-choice"
            data-style={style}
            onClick={() => save({ ...model, body: style })}
          >
            <span className="kn-nm-thumb" aria-hidden="true">
              <BodyShape style={style} />
            </span>
            <span>{BODY_LABEL[style]}</span>
          </button>
        ))}
      </div>
      <div className="kn-nm-options">
        <label className="kn-nm-option">
          <span>Títulos numerados</span>
          <Switch label="Títulos numerados" checked={model.numbered} onChange={(numbered) => save({ ...model, numbered })} />
        </label>
        <label className="kn-nm-option">
          <span>O sumário desce até</span>
          <Select
            label="O sumário desce até"
            value={String(model.tocDepth) as "1" | "2" | "3"}
            options={[
              { value: "1", label: "o 1º nível" },
              { value: "2", label: "o 2º nível" },
              { value: "3", label: "o 3º nível" },
            ]}
            onChange={(v) => save({ ...model, tocDepth: Number(v) as 1 | 2 | 3 })}
          />
        </label>
      </div>
      {first ? (
        <div className="kn-nm-first">
          {/* Pular fica com o padrão do spec: sem blocos na entrada, o Kiwi completa os seis na ordem padrão, todos ligados,
              com o corpo misto, sem numeração e o sumário até o 2º nível. */}
          <Button onClick={() => void api.agent.noteModelSet({ blocks: [], body: "misto", numbered: false, tocDepth: 2 }).then(() => onDone?.())}>
            Pular
          </Button>
          <Button variant="primary" onClick={() => void api.agent.noteModelSet(model).then(() => onDone?.())}>
            Pronto
          </Button>
        </div>
      ) : null}
      {error ? <p className="kn-row-hint" role="alert">{error}</p> : null}
    </div>
  );
}

/**
 * A linha do Modelo de nota em Ajustes › Agente. Na primeira vez que o agente fica pronto (o cofre ainda sem o
 * arquivo), a tela aparece aberta, depois do "Testar", com "Pular"; depois, fica atrás de "Mudar".
 */
export function NoteModelRow() {
  const [saved, setSaved] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    void api.agent.noteModel().then((r) => alive && setSaved(r.saved), () => alive && setSaved(true));
    return () => {
      alive = false;
    };
  }, []);
  if (saved === null) return null;
  if (!saved) return <NoteModelEditor first onDone={() => setSaved(true)} />;
  return (
    <>
      <div className="kn-row">
        <div className="kn-row-text">
          <div className="kn-row-label">Modelo de nota</div>
          <div className="kn-row-hint">O jeito que o agente monta uma nota quando cria ou organiza.</div>
        </div>
        <Button onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Fechar" : "Mudar"}
        </Button>
      </div>
      {open ? <NoteModelEditor /> : null}
    </>
  );
}
