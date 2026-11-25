// Histórico: cada ditado (texto final e original), do mais novo para o mais velho, com busca.
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { INTL_TAG, type Locale, translate } from "../../src/shared/i18n/index.ts";
import { fold, foldWithMap } from "../../src/store/text.ts";
import { api, has, type HistoryEntry, type NoteMeta, type SearchHit } from "../src/api.ts";
import { CopyIcon, TrashIcon } from "../src/kit/editable.tsx";
import { Button, Empty, Window } from "../src/kit/index.tsx";
import { useT, withStrong } from "../src/i18n.ts";
import { NO_TEXT_ASSIST } from "../src/textAssist.ts";
import { INBOX_LABEL, sentText, targetItems } from "./toNote.ts";

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

function NoteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
      <path d="M4 1.75h5.5L12.5 4.75v9.5H4z" />
      <path d="M9.25 1.75v3.25h3.25M6.25 8.5h4M6.25 11h2.5" />
    </svg>
  );
}

/**
 * O seletor de "Enviar para nota…" (T1320): nota nova em Caixa de entrada/, ou uma que existe, pela mesma busca do
 * ⌘K. Um envio por vez: o botão trava até a resposta, e o engine não duplica um trecho mandado de novo.
 */
function SendToNote({ entry, onClose, onSent }: { entry: HistoryEntry; onClose: () => void; onSent: (message: string) => void }) {
  const { t, locale } = useT();
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    api.notes.list().then(
      (l) => setNotes(l.notes),
      () => setError(t("history.toNote.notesFailed")),
    );
  }, []);

  // A busca no texto, 150 ms depois de parar de digitar; a resposta de uma busca velha é jogada fora.
  useEffect(() => {
    const my = ++seq.current;
    if (!query.trim()) return setHits([]);
    const timer = setTimeout(() => {
      api.notes.search(query).then(
        (h) => my === seq.current && setHits(h),
        () => my === seq.current && setHits([]),
      );
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  const send = async (path?: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onSent(sentText(await api.history.toNote(entry.id, path), locale));
    } catch {
      setError(t("history.toNote.sendFailed"));
      setBusy(false);
    }
  };

  return (
    <div className="kn-tonote" role="dialog" aria-label={t("history.toNote.dialog")} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <input
        className="kn-search"
        type="search"
        {...NO_TEXT_ASSIST}
        placeholder={t("history.toNote.search")}
        aria-label={t("history.toNote.search")}
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="kn-tonote-list">
        {targetItems(notes, query, hits).map((item) =>
          item.kind === "new" ? (
            <li key="new">
              <button type="button" className="kn-tonote-item" data-kind="new" disabled={busy} onClick={() => send()}>
                <span>{t("history.toNote.new")}</span>
                <small>{t("history.toNote.in", { folder: INBOX_LABEL })}</small>
              </button>
            </li>
          ) : (
            <li key={item.path}>
              <button type="button" className="kn-tonote-item" disabled={busy} onClick={() => send(item.path)}>
                <span>{item.title}</span>
                {item.detail ? <small>{item.detail}</small> : null}
              </button>
            </li>
          ),
        )}
      </ul>
      {error ? <p className="kn-tonote-error">{error}</p> : null}
    </div>
  );
}

const dayKey = (iso: string) => new Date(iso).toDateString();

/** "Hoje", "Ontem" ou "quinta-feira, 6 de novembro" ("Thursday, November 6"), na língua das telas (T29247). */
export function dayLabel(iso: string, locale: Locale = "pt", today = new Date()): string {
  const d = new Date(iso);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return translate(locale, "history.today");
  if (d.toDateString() === yesterday.toDateString()) return translate(locale, "history.yesterday");
  return d.toLocaleDateString(INTL_TAG[locale], { weekday: "long", day: "numeric", month: "long" });
}

/** "09:05" em português, "9:05 AM" em inglês. */
export const time = (iso: string, locale: Locale = "pt") =>
  new Date(iso).toLocaleTimeString(INTL_TAG[locale], { hour: locale === "pt" ? "2-digit" : "numeric", minute: "2-digit" });

/** O dia até quando o áudio fica: "6 de nov." ("Nov 6"). */
export const audioUntil = (iso: string, locale: Locale = "pt") =>
  new Date(iso).toLocaleDateString(INTL_TAG[locale], { day: "numeric", month: "short" });

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

export function History() {
  const { t, locale } = useT();
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<string | undefined>();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  /** "Mostrar mais": trava enquanto a página não chega, e diz se ela falhou. */
  const [more, setMore] = useState<"idle" | "loading" | "error">("idle");
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  /** O ditado com o "Enviar para nota…" aberto, e o que já foi enviado (o aviso embaixo de cada um). */
  const [picking, setPicking] = useState<string | null>(null);
  const [sent, setSent] = useState<Map<string, string>>(new Map());
  const canSend = has("history.toNote");
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const [retryErrors, setRetryErrors] = useState<Map<string, string>>(new Map());
  const canRetry = has("history.retry");
  const words = fold(query).split(/\s+/).filter(Boolean);
  const wordsRef = useRef(words);
  wordsRef.current = words;
  /**
   * Cada busca nova ganha um número; a resposta de uma busca que já não é a atual é jogada fora. A busca no disco leva
   * mais ou menos tempo conforme o termo, e a resposta velha chegava depois e sobrescrevia a lista (T914).
   */
  const seq = useRef(0);

  const load = useCallback((q: string, before?: string) => {
    const my = before ? seq.current : ++seq.current;
    if (before) setMore("loading");
    else setMore("idle");
    api.history.search({ query: q, limit: PAGE, before }).then(
      (page) => {
        if (my !== seq.current) return;
        setEntries((old) => {
          if (!before) return page.entries;
          const have = new Set(old.map((e) => e.id));
          return [...old, ...page.entries.filter((e: HistoryEntry) => !have.has(e.id))];
        });
        setNextBefore(page.nextBefore);
        setState("ready");
        setMore("idle");
      },
      () => {
        if (my !== seq.current) return;
        // Um erro não desliga a janela: a busca continua ativa e dá para tentar de novo (T914).
        if (before) return setMore("error");
        setEntries([]);
        setNextBefore(undefined);
        setState("error");
      },
    );
  }, []);

  // Busca 200 ms depois de parar de digitar.
  useEffect(() => {
    const timer = setTimeout(() => load(query), query ? 200 : 0);
    return () => clearTimeout(timer);
  }, [query, load]);

  // Ditado novo entra no topo, se casar com a busca.
  useEffect(
    () =>
      api.history.onAdded((e) => {
        if (!matches(e, wordsRef.current)) return;
        setEntries((old) => [e, ...old.filter((item) => item.id !== e.id)].sort((a, b) => a.id < b.id ? 1 : -1));
        setFresh((f) => new Set(f).add(e.id));
      }),
    [],
  );

  useEffect(() => api.history.onChanged(() => load(query)), [load, query]);

  const remove = async (id: string) => {
    if (!(await api.history.delete(id).catch(() => false))) return;
    const left = entries.filter((e) => e.id !== id);
    setEntries(left);
    // Apagou tudo o que estava na tela, mas há dias mais antigos: busca de novo, em vez de dizer que não há nada (T914).
    if (!left.length && nextBefore) load(query);
  };

  const search = (
    <input
      className="kn-search"
      type="search"
      {...NO_TEXT_ASSIST}
      placeholder={t("history.search")}
      aria-label={t("history.search")}
      value={query}
      onChange={(e) => setQuery(e.target.value)}
    />
  );

  if (state === "error") {
    return (
      <Window title={t("history.title")} end={search}>
        <Empty title={t("history.loadFailed")}>
          <Button onClick={() => load(query)}>{t("history.retry")}</Button>
        </Empty>
      </Window>
    );
  }

  if (state !== "loading" && entries.length === 0 && !nextBefore) {
    return (
      <Window title={t("history.title")} end={search}>
        {query ? (
          <Empty title={t("history.notFound")}>{t("history.notFoundHint", { query })}</Empty>
        ) : (
          <Empty icon={<WaveIcon />} title={t("history.empty")}>
            {withStrong((key) => t("history.emptyHint", { key }), "Fn")}
          </Empty>
        )}
      </Window>
    );
  }

  const retry = async (id: string) => {
    if (retrying.has(id)) return;
    setRetrying((old) => new Set(old).add(id));
    setRetryErrors((old) => { const next = new Map(old); next.delete(id); return next; });
    try {
      await api.history.retry(id);
      load(query);
    } catch {
      setRetryErrors((old) => new Map(old).set(id, t("history.retryFailed")));
    } finally {
      setRetrying((old) => { const next = new Set(old); next.delete(id); return next; });
    }
  };

  const groups: { day: string; label: string; items: HistoryEntry[] }[] = [];
  for (const e of entries) {
    const day = dayKey(e.at);
    if (groups.at(-1)?.day !== day) groups.push({ day, label: dayLabel(e.at, locale), items: [] });
    groups.at(-1)!.items.push(e);
  }

  return (
    <Window title={t("history.title")} end={search}>
      {groups.map((g) => (
        <section key={g.day}>
          <h2 className="kn-day">{g.label}</h2>
          <div className="kn-card">
            {g.items.map((e) => (
              <article className="kn-entry" key={e.id} data-new={fresh.has(e.id)}>
                <div className="kn-entry-meta">
                  <span className="kn-entry-time">{time(e.at, locale)}</span>
                  {e.app?.name ? <span>· {e.app.name}</span> : null}
                  <span className="kn-entry-actions">
                    {canSend && e.text.trim() ? (
                      <button
                        type="button"
                        className="kn-icon-button"
                        aria-label={t("history.sendToNote")}
                        aria-expanded={picking === e.id}
                        onClick={() => setPicking((p) => (p === e.id ? null : e.id))}
                      >
                        <NoteIcon />
                      </button>
                    ) : null}
                    {e.text.trim() ? <button type="button" className="kn-icon-button" aria-label={t("history.copy")} onClick={() => api.copy(e.text)}>
                      <CopyIcon />
                    </button> : null}
                    <button type="button" className="kn-icon-button" data-tone="danger" aria-label={t("history.delete")} onClick={() => remove(e.id)}>
                      <TrashIcon />
                    </button>
                  </span>
                </div>
                <div className="kn-entry-text">
                  {e.text.trim() ? <Highlight text={e.text} words={words} /> : t("history.unfinished")}
                </div>
                {canRetry && e.recoveryId ? (
                  <div className="kn-entry-recovery">
                    <Button disabled={retrying.has(e.id)} onClick={() => void retry(e.id)}>
                      {retrying.has(e.id) ? t("history.retrying") : t("history.retryAudio")}
                    </Button>
                    <small>{e.expiresAt
                      ? t("history.audioUntil", { date: audioUntil(e.expiresAt, locale) })
                      : t("history.audioKept")}</small>
                    {retryErrors.has(e.id) ? <p role="alert">{retryErrors.get(e.id)}</p> : null}
                  </div>
                ) : null}
                {e.raw.trim() && e.raw.trim() !== e.text.trim() ? (
                  <div className="kn-entry-raw">
                    <Highlight text={e.raw} words={words} />
                  </div>
                ) : null}
                {picking === e.id ? (
                  <SendToNote
                    entry={e}
                    onClose={() => setPicking(null)}
                    onSent={(message) => {
                      setPicking(null);
                      setSent((m) => new Map(m).set(e.id, message));
                    }}
                  />
                ) : null}
                {sent.has(e.id) ? <div className="kn-entry-sent">{sent.get(e.id)}</div> : null}
              </article>
            ))}
          </div>
        </section>
      ))}
      {nextBefore ? (
        <div className="kn-more">
          <Button disabled={more === "loading"} onClick={() => load(query, nextBefore)}>
            {more === "error" ? t("history.moreFailed") : t("history.more")}
          </Button>
        </div>
      ) : null}
    </Window>
  );
}

