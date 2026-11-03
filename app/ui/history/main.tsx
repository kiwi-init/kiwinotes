// Histórico: cada ditado (texto final e original), do mais novo para o mais velho, com busca.
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { fold, foldWithMap } from "../../src/store/text.ts";
import { api, type HistoryEntry } from "../src/api.ts";
import { CopyIcon, TrashIcon } from "../src/kit/editable.tsx";
import { Button, Empty, mount, Window } from "../src/kit/index.tsx";

const PAGE = 50;

function WaveIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 36 36" aria-hidden style={{ color: "var(--accent)" }}>
      {[10, 20, 28, 20, 10].map((h, i) => (
        <rect key={i} x={4.5 + i * 6} y={(36 - h) / 2} width={3.5} height={h} rx={1.75} fill="currentColor" />
      ))}
    </svg>
  );
}

const dayKey = (iso: string) => new Date(iso).toDateString();

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Hoje";
  if (d.toDateString() === yesterday.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
}

const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Marca as palavras da busca no texto, sem olhar acento nem maiúscula. */
function Highlight({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>;
  const { folded, map } = foldWithMap(text);
  const ranges: [number, number][] = [];
  for (const w of words) {
    for (let i = folded.indexOf(w); i !== -1; i = folded.indexOf(w, i + w.length)) ranges.push([map[i]!, map[i + w.length]!]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const out: ReactNode[] = [];
  let last = 0;
  for (const [s, e] of ranges) {
    if (s < last) continue;
    out.push(text.slice(last, s), <mark className="kn-mark" key={s}>{text.slice(s, e)}</mark>);
    last = e;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

function matches(e: HistoryEntry, words: string[]): boolean {
  const hay = fold(`${e.text}\n${e.raw}\n${e.app?.name ?? ""}`);
  return words.every((w) => hay.includes(w));
}

function History() {
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<string | undefined>();
  const [state, setState] = useState<"loading" | "ready" | "offline">("loading");
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const words = fold(query).split(/\s+/).filter(Boolean);
  const wordsRef = useRef(words);
  wordsRef.current = words;

  const load = useCallback((q: string, before?: string) => {
    api.history.search({ query: q, limit: PAGE, before }).then(
      (page) => {
        setEntries((old) => (before ? [...old, ...page.entries] : page.entries));
        setNextBefore(page.nextBefore);
        setState("ready");
      },
      () => setState("offline"),
    );
  }, []);

  // Busca 200 ms depois de parar de digitar.
  useEffect(() => {
    const t = setTimeout(() => load(query), query ? 200 : 0);
    return () => clearTimeout(t);
  }, [query, load]);

  // Ditado novo entra no topo, se casar com a busca.
  useEffect(
    () =>
      api.history.onAdded((e) => {
        if (!matches(e, wordsRef.current)) return;
        setEntries((old) => [e, ...old]);
        setFresh((f) => new Set(f).add(e.id));
      }),
    [],
  );

  const remove = async (id: string) => {
    if (await api.history.delete(id).catch(() => false)) setEntries((old) => old.filter((e) => e.id !== id));
  };

  const search = (
    <input
      className="kn-search"
      type="search"
      placeholder="Buscar nos ditados"
      aria-label="Buscar nos ditados"
      value={query}
      disabled={state === "offline"}
      onChange={(e) => setQuery(e.target.value)}
    />
  );

  if (state !== "loading" && entries.length === 0) {
    return (
      <Window title="Histórico" end={search}>
        {query ? (
          <Empty title="Nada encontrado">Nenhum ditado tem “{query}”. A busca ignora acentos e maiúsculas.</Empty>
        ) : (
          <Empty icon={<WaveIcon />} title="Nenhum ditado ainda">
            Segure <strong>Fn</strong> em qualquer app e fale. Cada ditado aparece aqui, com o texto limpo e o original.
          </Empty>
        )}
      </Window>
    );
  }

  const groups: { day: string; label: string; items: HistoryEntry[] }[] = [];
  for (const e of entries) {
    const day = dayKey(e.at);
    if (groups.at(-1)?.day !== day) groups.push({ day, label: dayLabel(e.at), items: [] });
    groups.at(-1)!.items.push(e);
  }

  return (
    <Window title="Histórico" end={search}>
      {groups.map((g) => (
        <section key={g.day}>
          <h2 className="kn-day">{g.label}</h2>
          <div className="kn-card">
            {g.items.map((e) => (
              <article className="kn-entry" key={e.id} data-new={fresh.has(e.id)}>
                <div className="kn-entry-meta">
                  <span>{time(e.at)}</span>
                  {e.app?.name ? <span>· {e.app.name}</span> : null}
                  <span className="kn-entry-actions">
                    <button type="button" className="kn-icon-button" aria-label="Copiar o texto" onClick={() => api.copy(e.text)}>
                      <CopyIcon />
                    </button>
                    <button type="button" className="kn-icon-button" data-tone="danger" aria-label="Apagar do histórico" onClick={() => remove(e.id)}>
                      <TrashIcon />
                    </button>
                  </span>
                </div>
                <div className="kn-entry-text">
                  <Highlight text={e.text} words={words} />
                </div>
                {e.raw.trim() && e.raw.trim() !== e.text.trim() ? (
                  <div className="kn-entry-raw">
                    <Highlight text={e.raw} words={words} />
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ))}
      {nextBefore ? (
        <div className="kn-more">
          <Button onClick={() => load(query, nextBefore)}>Mostrar mais</Button>
        </div>
      ) : null}
    </Window>
  );
}

mount(<History />);
