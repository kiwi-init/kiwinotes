// O docx dentro das Notas (T7110; desde o T21151, spec #21080, como no Word): as páginas do documento, com a fonte, as
// tabelas, as imagens, o cabeçalho e o rodapé, pelo motor do @docx-editor.dev/core (`docxEngine.ts`), que só carrega
// quando um docx abre. Desde o T21152, a pessoa edita nas páginas, e o Kiwi grava um instante depois (`docxSaver.ts`),
// com a versão do disco: se outro app mudou o arquivo, vale o de lá, e a barra avisa. Aberto e fechado sem edição, o
// arquivo fica como estava, byte a byte. O ⌘F acha no texto do corpo; o zoom é o de todo arquivo (a pinça e o ⌘+, ⌘−, ⌘0). Ao fechar, o motor é solto (#22186, a decisão do harry
// em #22216): a memória do documento volta.
//
// O Kiwi Cat ao vivo (T21231, spec #21155): quando o agente grava o docx aberto, a tela toca as mudanças dele por cima
// do documento (`docxKiwi.ts`) e confere com o arquivo gravado; se não bate, abre o do disco, só com o realce. Com o
// docx fechado, o realce vem na primeira abertura. O parágrafo com o cursor da pessoa vai ao `files.editing`, e o gato
// espera ela sair dele.

import { type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { docxOpsResult } from "../../../src/shared/docx/ops.ts";
import { NO_TEXT_ASSIST } from "../../src/textAssist.ts";
import { kiwiFaceUrl } from "../editor/kiwi-face.ts";
import { reducedMotion } from "../kiwiWrite.ts";
import { externalUrl } from "../links.ts";
import { bytesOf } from "./csv.ts";
import type { DocxHandle } from "./docxEngine.ts";
import { barSpot, type DocxBarSpot, DocxFormatBar } from "./DocxFormatBar.tsx";
import { caretReporter, DocxSaver } from "./docxSaver.ts";
import { docxBodyParagraphs, sameText } from "./docxText.ts";
import { type DocxMatch, type DocxParagraph, docxParagraphs, findInDocx } from "./docxFind.ts";
import { stepMatch } from "./pdfSearch.ts";
import { useViewerZoom } from "./useViewerZoom.ts";
import type { FileViewerProps } from "./viewers.ts";
import { checkZip } from "./zipSize.ts";
import { recallZoom, stepZoom } from "./zoom.ts";

type State = { kind: "loading" } | { kind: "ready"; pages: number } | { kind: "tooLarge" } | { kind: "error" };

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

export function DocxViewer({ path, file, files, flushRef, at, kiwi }: FileViewerProps) {
  const incoming = "base64" in file ? file.base64 : "";
  // O que está aberto no motor. Uma leitura nova (outro app gravou) só reabre se não for a nossa própria gravação.
  const [source, setSource] = useState({ base64: incoming, version: file.version });
  const base64 = source.base64;
  const [notice, setNotice] = useState<string | null>(null);
  const saver = useMemo(
    () =>
      new DocxSaver(
        {
          path,
          files,
          bytes: () => {
            if (!engine.current) throw new Error("sem documento");
            return engine.current.save();
          },
          notice: setNotice,
          reload: (b64, version) => setSource({ base64: b64, version }),
          catWrote: (base, version) => !!kiwiSource.current?.catWroteDocx?.(path, base, version),
        },
        file.version,
      ),
    // Um gravador por arquivo: a versão de partida é a da primeira leitura.
    // biome-ignore lint/correctness/useExhaustiveDependencies: file.version só vale na criação
    [path, files],
  );
  const kiwiSource = useRef(kiwi);
  kiwiSource.current = kiwi;
  // As gravações do gato tocam uma depois da outra.
  const playing = useRef<Promise<void>>(Promise.resolve());
  // Os parágrafos para realçar quando o documento abrir de novo (o gato gravou e a tela não pôde tocar).
  const glowNext = useRef<string[] | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    const version = file.version;
    const b64 = incoming;
    if (saver.known(b64, version)) {
      saver.incoming(b64, version);
      return;
    }
    const ops = kiwiSource.current?.takeDocx?.(path, version)?.docxOps;
    if (!ops?.length) {
      if (!saver.incoming(b64, version)) setSource({ base64: b64, version });
      return;
    }
    const result = docxOpsResult(ops);
    const reopen = () => {
      glowNext.current = result.touched;
      if (!saver.incoming(b64, version)) setSource({ base64: b64, version });
    };
    playing.current = playing.current.then(async () => {
      const e = engine.current;
      if (!e || !mounted.current) return reopen();
      saver.hold();
      let ok = false;
      try {
        ok = await e.play(ops, { face: kiwiFaceUrl(kiwiSource.current?.cor), reduced: reducedMotion() });
        // A tela tem de ter o texto do arquivo: o que a pessoa ainda não gravou fica, o resto confere todo.
        ok = ok && engine.current === e && sameText(docxBodyParagraphs(e.save()), docxBodyParagraphs(bytesOf(b64)), { pending: saver.unsaved, ...result });
      } catch {
        ok = false;
      }
      if (engine.current !== e) return;
      // O gato mudou o texto (o tocar não passa pelo `onEdit`): a busca e o `at` leem os parágrafos de novo.
      paragraphs.current = null;
      setMatches((m) => (m ? null : m));
      setCurrent(-1);
      if (ok) {
        saver.adopt(version);
        saver.release();
      } else {
        saver.release();
        reopen();
      }
    });
  }, [saver, incoming, file.version, path]);
  useEffect(() => {
    const flush = () => saver.flush();
    flushRef.current = flush;
    return () => {
      if (flushRef.current === flush) flushRef.current = null;
      saver.dispose();
    };
  }, [saver, flushRef]);
  const [state, setState] = useState<State>({ kind: "loading" });
  const scroller = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<DocxHandle | null>(null);
  const queryBox = useRef<HTMLInputElement>(null);
  // O zoom (T21238): `null` é 100%, como o Word abre.
  const [zoom, setZoom] = useState<number | null>(() => recallZoom(path));
  useEffect(() => setZoom(recallZoom(path)), [path]);
  const z = zoom ?? 1;
  const zoomAtMount = useRef(z);
  zoomAtMount.current = z;
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<DocxMatch[] | null>(null);
  const [current, setCurrent] = useState(-1);
  const paragraphs = useRef<DocxParagraph[] | null>(null);
  // A barra de formatação em cima da seleção (T23238), medida no quadro seguinte à mudança.
  const frame = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<DocxBarSpot | null>(null);
  const barFrame = useRef(0);
  const placeBar = useCallback(() => {
    cancelAnimationFrame(barFrame.current);
    barFrame.current = requestAnimationFrame(() => {
      const inDoc = host.current?.contains(document.activeElement) ?? false;
      setBar(inDoc ? barSpot(engine.current, frame.current) : null);
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(barFrame.current), []);

  // O parágrafo com o cursor da pessoa, para o gato esperar ela sair dele (T21231).
  const owner = useMemo(() => `docx-${Math.random().toString(36).slice(2, 10)}`, []);
  const tellCaret = useRef<(id: string | null) => void>(() => {});
  // Sair do parágrafo grava antes a edição da pessoa, e só então o gato fica sabendo (revisão #23268).
  const reportCaret = useMemo(() => caretReporter(saver, (id) => files.editing?.(path, owner, null, id) ?? Promise.resolve()), [saver, files, path, owner]);
  tellCaret.current = reportCaret;

  // Abre o documento no motor. Outro arquivo, ou o mesmo que mudou no disco: solta o de antes.
  useEffect(() => {
    let alive = true;
    mounted.current = false;
    setState({ kind: "loading" });
    setMatches(null);
    setCurrent(-1);
    paragraphs.current = null;
    void (async () => {
      try {
        const bytes = bytesOf(base64);
        // Antes do motor, o tamanho aberto (revisão do T7110): um docx pequeno pode descompactar em centenas de MB.
        const zip = checkZip(bytes);
        if (!zip.ok) {
          if (alive) setState({ kind: zip.reason === "too-large" ? "tooLarge" : "error" });
          return;
        }
        const { mountDocx } = await import("./docxEngine.ts");
        const el = host.current;
        if (!alive || !el) return;
        const r = mountDocx(el, bytes, {
          zoom: zoomAtMount.current,
          editable: saver.canSave,
          onEdit: () => {
            setNotice(null);
            // O texto mudou: a busca lê os parágrafos de novo, e as marcas velhas saem.
            paragraphs.current = null;
            setMatches((m) => (m ? null : m));
            setCurrent(-1);
            saver.edited();
          },
          onCaret: (id) => tellCaret.current(id),
          onSelection: placeBar,
          onLink: (href) => {
            const url = externalUrl(href);
            // O `newWindow: "external"` da janela manda para o navegador padrão.
            if (url) window.open(url, "_blank", "noopener,noreferrer");
          },
        });
        if (!r.ok) return setState({ kind: "error" });
        engine.current = r.handle;
        saver.opened(source.version);
        mounted.current = true;
        // O que o gato mudou com o docx fechado (ou o que a tela não pôde tocar): só o realce, de uma vez.
        const glow = glowNext.current ?? docxOpsResultOf(kiwiSource.current?.takeDocx?.(path, source.version)?.docxOps);
        glowNext.current = null;
        if (glow?.length) r.handle.glow(glow);
        setState({ kind: "ready", pages: r.handle.pages() });
      } catch {
        if (alive) setState({ kind: "error" });
      }
    })();
    return () => {
      alive = false;
      mounted.current = false;
      // Saiu do documento com uma edição por gravar: os bytes saem do motor agora, antes de soltá-lo.
      if (engine.current) void saver.flush();
      engine.current?.destroy();
      engine.current = null;
      paragraphs.current = null;
      setBar(null);
    };
    // Reabre a cada leitura nova (um `setSource`), mesmo com os bytes de antes: o desfazer da Atividade volta o arquivo
    // de quando abriu, e a tela pode estar com o que o gato tocou.
    // biome-ignore lint/correctness/useExhaustiveDependencies: reabre só quando a leitura muda
  }, [source, saver]);

  // O zoom vai ao motor, que desenha as páginas de novo na escala nova (o texto fica nítido, sem esticar a imagem). Antes
  // do `useViewerZoom`, e também num efeito de layout: quando ele mede onde o ponto dos dedos foi parar, as páginas já
  // estão no tamanho novo.
  useLayoutEffect(() => {
    engine.current?.setZoom(z);
  }, [z, state.kind]);
  const { zoomBy, zoomTo } = useViewerZoom({ path, target: scroller, scale: z, set: setZoom, min: MIN_ZOOM, max: MAX_ZOOM, anchor: ".docx-page", enabled: state.kind === "ready" });

  // A busca, um pouco depois da última tecla. O texto dos parágrafos é lido do motor uma vez, na primeira busca.
  useEffect(() => {
    if (state.kind !== "ready") return;
    if (!query.trim()) {
      setMatches(null);
      setCurrent(-1);
      return;
    }
    const timer = setTimeout(() => {
      if (!engine.current) return;
      paragraphs.current ??= docxParagraphs(engine.current.pieces());
      const found = findInDocx(paragraphs.current, query);
      setMatches(found);
      setCurrent(found.length ? 0 : -1);
    }, 150);
    return () => clearTimeout(timer);
  }, [query, state.kind]);

  // As marcas na página, e o achado da vez à vista.
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.mark(matches ?? [], current);
    const m = matches && current >= 0 ? matches[current] : undefined;
    if (m) e.reveal(m);
  }, [matches, current]);

  // O parágrafo que a busca do app achou (T22218): o n-ésimo do corpo, contado como o `docText` do índice, ganha a marca
  // da vez e vai para a tela. O ⌘F, quando a pessoa busca, troca as marcas.
  useEffect(() => {
    const e = engine.current;
    if (!e || state.kind !== "ready" || !at || !("paragraph" in at)) return;
    // Os dois lados contam pela lista do motor: todo parágrafo do corpo, mesmo o vazio (T22847).
    const id = e.paragraphId(at.paragraph);
    if (!id) return;
    paragraphs.current ??= docxParagraphs(e.pieces());
    const p = paragraphs.current.find((x) => x.id === id);
    // Sem texto desenhado no corpo (só uma caixa de texto, achada pelo texto dela): rola até ele, sem marca.
    if (!p) {
      e.mark([], -1);
      e.revealParagraph(id);
      return;
    }
    const found = { paragraphId: p.id, from: p.offsets[0]!, to: p.offsets[p.text.length]!, page: p.page };
    e.mark([found], 0);
    e.reveal(found);
  }, [at, state.kind]);

  const step = useCallback((direction: 1 | -1) => setCurrent((c) => stepMatch(c, matches?.length ?? 0, direction)), [matches]);

  // ⌘F em qualquer lugar do documento vai para a busca; ⌘G e ⇧⌘G andam pelos achados.
  const onKeyDown = (e: KeyboardEvent) => {
    if (!e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "f") {
      e.preventDefault();
      queryBox.current?.focus();
      queryBox.current?.select();
    } else if (k === "g" && matches?.length) {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    }
  };

  const count = useMemo(() => (matches === null ? "" : matches.length ? `${current + 1} de ${matches.length.toLocaleString("pt-BR")}` : "Nada encontrado"), [matches, current]);

  if (state.kind === "error") {
    return (
      <div className="kn-file-notice" role="status">
        <p>Não deu para abrir este documento. Ele pode estar corrompido ou ser de outro formato (o .doc antigo, por exemplo).</p>
      </div>
    );
  }
  if (state.kind === "tooLarge") {
    return (
      <div className="kn-file-notice" role="status">
        <p>Este documento é grande demais para abrir aqui. Abra no app padrão.</p>
      </div>
    );
  }
  const ready = state.kind === "ready";
  return (
    // biome-ignore lint: o ⌘F e o ⌘G do documento; o foco fica nos controles e nas páginas
    <div
      ref={frame}
      className="kn-file-pdf kn-file-docx"
      aria-busy={ready ? undefined : "true"}
      onKeyDown={onKeyDown}
      // Sair das páginas (a busca, outro painel) esconde a barra; voltar a mostra de novo.
      onFocus={placeBar}
      onBlur={placeBar}
    >
      {notice || (ready && !saver.canSave) ? (
        <div className="kn-file-text-note" role="status">
          {notice ?? "Só leitura: este Kiwi ainda não grava documentos."}
        </div>
      ) : null}
      <div className="kn-file-pdf-bar" role="toolbar" aria-label="Documento">
        <span className="kn-file-pdf-group">
          <button type="button" className="kn-bt" aria-label="Diminuir o zoom" disabled={!ready || z <= MIN_ZOOM} onClick={() => zoomBy(stepZoom(z, -1, MIN_ZOOM, MAX_ZOOM) / z)}>
            −
          </button>
          <span className="kn-file-pdf-zoom" aria-live="polite">{`${Math.round(z * 100)}%`}</span>
          <button type="button" className="kn-bt" aria-label="Aumentar o zoom" disabled={!ready || z >= MAX_ZOOM} onClick={() => zoomBy(stepZoom(z, 1, MIN_ZOOM, MAX_ZOOM) / z)}>
            +
          </button>
          <button type="button" className="kn-bt" disabled={!ready || zoom === null} onClick={() => zoomTo(null)}>
            100%
          </button>
        </span>
        <span className="kn-file-pdf-page">{ready ? `${state.pages} ${state.pages === 1 ? "página" : "páginas"}` : ""}</span>
        <span className="kn-file-pdf-group kn-file-pdf-find">
          <input
            ref={queryBox}
            className="kn-file-pdf-query"
            type="search"
            placeholder="Buscar no documento"
            aria-label="Buscar no documento"
            value={query}
            disabled={!ready}
            {...NO_TEXT_ASSIST}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                step(e.shiftKey ? -1 : 1);
              }
              if (e.key === "Escape") setQuery("");
            }}
          />
          <span className="kn-file-pdf-count" aria-live="polite">
            {count}
          </span>
          <button type="button" className="kn-bt" aria-label="Achado anterior" disabled={!matches?.length} onClick={() => step(-1)}>
            ↑
          </button>
          <button type="button" className="kn-bt" aria-label="Próximo achado" disabled={!matches?.length} onClick={() => step(1)}>
            ↓
          </button>
        </span>
      </div>
      {/* Com foco (o clique numa página): as setas e o Page Down rolam, e o ⌘F chega aqui. */}
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a área rolável do documento, como a do pdf no Preview */}
      <div className="kn-file-docx-scroll docx-editor docx-editor__scroll-container" ref={scroller} tabIndex={0} aria-label="Páginas do documento" onScroll={bar ? placeBar : undefined}>
        <div className="docx-paginated-surface" ref={host} />
      </div>
      {bar && ready && saver.canSave ? (
        <DocxFormatBar
          spot={bar}
          onFormat={(action) => {
            engine.current?.format(action);
            placeBar();
          }}
        />
      ) : null}
    </div>
  );
}

const docxOpsResultOf = (ops: Parameters<typeof docxOpsResult>[0] | undefined) => (ops?.length ? docxOpsResult(ops).touched : null);
