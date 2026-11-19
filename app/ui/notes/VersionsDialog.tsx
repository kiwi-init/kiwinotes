// "Versões…" (T2680): as versões da nota, a mais nova primeiro, com a diferença para o texto de agora e o Restaurar.
// O restaurar grava por cima (o engine guarda o texto de agora como uma versão antes, então dá para voltar dele).
// Desde o T22432 (issue #182): o quadro branco mostra o diff em linhas legíveis (`readable`, os cartões e as setas), e
// o xlsx abre a versão só leitura no próprio visualizador da planilha, no lugar do diff.

import { useEffect, useMemo, useRef, useState } from "react";

import { collapse, diffStats, lineDiff } from "./diff.ts";
import { type FilesApi, viewerFor } from "./files/viewers.ts";
import type { VersionInfo, VersionsApi } from "./types.ts";

const when = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function VersionsDialog({
  api,
  path,
  title,
  current,
  onRestored,
  onClose,
  readable,
}: {
  api: VersionsApi;
  path: string;
  title: string;
  /** O texto de agora (com o frontmatter), para a diferença. */
  current: string;
  onRestored(): void;
  onClose(): void;
  /** O texto que o diff compara (T22432): o quadro em cartões e setas, no lugar do JSON. */
  readable?(text: string): string;
}) {
  const [list, setList] = useState<VersionInfo[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  /** A versão em bytes (o xlsx): abre no visualizador, sem diff. */
  const [bytes, setBytes] = useState<{ base64: string; at: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.list(path).then(
      (l) => {
        setList(l);
        setPicked(l[0]?.id ?? null);
      },
      () => setList([]),
    );
  }, [api, path]);
  useEffect(() => {
    setContent(null);
    setBytes(null);
    if (picked)
      api.get(path, picked).then(
        (v) => ("content" in v ? setContent(v.content) : setBytes(v)),
        () => setContent(null),
      );
  }, [api, path, picked]);
  // Do texto de agora para a versão: o que o Restaurar traz de volta (+) e o que ele tira (−).
  const diff = useMemo(
    () => (content === null ? null : readable ? lineDiff(readable(current), readable(content)) : lineDiff(current, content)),
    [content, current, readable],
  );
  const stats = diff ? diffStats(diff) : null;

  const restore = async () => {
    if (!picked) return;
    setError(null);
    const r = await api.restore(path, picked).catch(() => null);
    if (r && r.saved) onRestored();
    else setError("A nota mudou enquanto isso (no Obsidian, talvez). Feche e abra de novo para ver a versão de agora.");
  };

  return (
    <div className="kn-palette-scrim" onMouseDown={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="kn-palette kn-versions" role="dialog" aria-label={`Versões de ${title}`} onMouseDown={(e) => e.stopPropagation()}>
        <header className="kn-versions-h">
          <span className="kn-versions-title">Versões de “{title}”</span>
          <button type="button" className="kn-bt" onClick={onClose} aria-label="Fechar">
            Fechar
          </button>
        </header>
        {list === null ? null : !list.length ? (
          <p className="kn-faint kn-versions-empty">Ainda não há versões: elas nascem quando o arquivo é editado.</p>
        ) : (
          <div className="kn-versions-body">
            <ul className="kn-versions-list" role="listbox" aria-label="Versões">
              {list.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={v.id === picked}
                    className="kn-versions-it"
                    onClick={() => setPicked(v.id)}
                  >
                    {when(v.at)}
                  </button>
                </li>
              ))}
            </ul>
            <div className="kn-versions-diff" aria-label="O que o Restaurar muda">
              {bytes ? (
                <div className="kn-versions-stats">Restaurar troca o arquivo de agora por esta versão.</div>
              ) : null}
              {bytes ? <VersionPreview path={path} base64={bytes.base64} at={bytes.at} /> : null}
              {stats ? (
                <div className="kn-versions-stats">
                  {stats.added || stats.removed ? `Restaurar traz ${stats.added} e tira ${stats.removed} ${stats.removed === 1 ? "linha" : "linhas"}` : "Igual ao texto de agora."}
                </div>
              ) : null}
              <pre className="kn-diff" hidden={!!bytes}>
                {diff
                  ? collapse(diff).map((l, i) =>
                      l.kind === "gap" ? (
                        <div key={i} className="kn-diff-gap">
                          … {l.count} {l.count === 1 ? "linha igual" : "linhas iguais"}
                        </div>
                      ) : (
                        <div key={i} className={`kn-diff-${l.kind}`}>
                          {l.kind === "add" ? "+ " : l.kind === "del" ? "− " : "  "}
                          {l.text || " "}
                        </div>
                      ),
                    )
                  : null}
              </pre>
              {error ? <p className="kn-trash-error" role="alert">{error}</p> : null}
              <div className="kn-versions-actions">
                <button type="button" className="kn-bt kn-bt-acc" disabled={!picked || (!bytes && (!stats || (!stats.added && !stats.removed)))} onClick={() => void restore()}>
                  Restaurar esta versão
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** A versão em bytes no visualizador do arquivo, só leitura: nada grava, nada chama o engine (T22432). */
function VersionPreview({ path, base64, at }: { path: string; base64: string; at: string }) {
  const viewer = viewerFor(path);
  const flushRef = useRef<(() => Promise<boolean>) | null>(null);
  const files = useMemo<FilesApi>(
    () => ({
      open: async () => true as const,
      onChanged: () => () => {},
      read: async () => ({ path, size: 0, version: `versao:${at}`, base64 }),
    }),
    [path, base64, at],
  );
  if (!viewer || viewer.as !== "binary") return null;
  const file = { path, size: Math.floor((base64.length * 3) / 4), version: `versao:${at}`, base64 };
  return (
    <div className="kn-versions-preview" aria-label="A versão escolhida, só leitura">
      <viewer.View key={at} path={path} file={file} files={files} flushRef={flushRef} readOnly={`a versão de ${when(at)}.`} />
    </div>
  );
}
