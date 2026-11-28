// O cartão do hover e o painel largo da aba Calendário (T32155, spec #32129). A ideia é a do protótipo
// (`lab/calendario-propostas/proto.html`): o ⤢ no canto de cima do cartão o faz crescer até o painel largo, e o ⤡
// (ou o ✕) o leva de volta para dentro do item, tudo ao mesmo tempo (harry #32144): o painel encolhe e some no item, o
// item pisca, e o painel do Kiwi (T32156) contrai junto, pelo `data-wide` da raiz.

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { CALENDAR_NOTIFY, type CalendarItem, type CalendarNotify } from "../../src/shared/calendar.ts";
import { useT } from "../src/i18n.ts";
import { whenLine } from "./format.ts";
import { noteLine } from "./model.ts";
import type { CalendarSource } from "../../src/shared/calendar.ts";
import type { CalendarStore } from "./source.ts";

/** Ida, volta e a piscada do item, em ms (o protótipo: 550, 600 e 650). */
export const OPEN_MS = 550;
export const CLOSE_MS = 600;
export const PULSE_MS = 650;
/** Quanto o cartão espera antes de sumir quando o mouse sai do item (dá tempo de chegar nele). */
export const HIDE_MS = 250;
export const WIDE_PX = 540;

export type WideState = "opening" | "open" | "closing";
export type DetailTab = "item" | "note" | "links";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Um retângulo relativo à raiz da tela (o cartão e o painel são `position: absolute` nela). */
export function rectIn(el: Element, root: Element): Rect {
  const a = el.getBoundingClientRect();
  const r = root.getBoundingClientRect();
  return { left: a.left - r.left, top: a.top - r.top, width: a.width, height: a.height };
}

const px = (r: Rect) => ({ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });

/** O que o cartão e o painel podem fazer com o item. */
export interface DetailActions {
  openNote(item: CalendarItem): void;
  snooze(item: CalendarItem): void;
  toggleDone(item: CalendarItem): void;
  setNotify(item: CalendarItem, n: CalendarNotify): void;
}

function KindTags({ item }: { item: CalendarItem }) {
  const { t } = useT();
  return (
    <>
      <span className="kn-cal-tag" data-kind={item.kind}>{t(`calendar.kind.${item.kind}`)}</span>
      <span className="kn-cal-tag">{item.project ?? t("calendar.noProject")}</span>
    </>
  );
}

function NoteLink({ item, onOpen }: { item: CalendarItem; onOpen(): void }) {
  const { t } = useT();
  if (!item.source) return null;
  const line = noteLine(item);
  const path = item.source.path.replace(/\.md$/, "").split("/").join(" / ");
  return (
    <button type="button" className="kn-cal-link" data-note-link={item.source.path} onClick={onOpen}>
      {line ? t("calendar.lineOf", { path, line }) : path} ↗
    </button>
  );
}

function NotifyLine({ item, face }: { item: CalendarItem; face: string | null }) {
  const { t } = useT();
  return (
    <div className="kn-cal-kw">
      {face ? <img src={face} alt="" /> : null}
      <span>{item.notify === "none" ? t("calendar.notify.off") : t("calendar.notify.says", { when: t(`calendar.notify.${item.notify}`) })}</span>
    </div>
  );
}

/** O corpo do cartão: os mesmos dados na ida e no começo da animação (a camada que some enquanto o painel cresce). */
function CardBody({ item, a, face, onExpand }: { item: CalendarItem; a: DetailActions; face: string | null; onExpand?(): void }) {
  const { t, locale } = useT();
  return (
    <>
      <button type="button" className="kn-cal-expand" title={t("calendar.expand")} aria-label={t("calendar.expand")} onClick={onExpand} tabIndex={onExpand ? 0 : -1}>
        ⤢
      </button>
      <div className="kn-cal-tags">
        <KindTags item={item} />
      </div>
      <h3>{item.title}</h3>
      <div className="kn-cal-when">{whenLine(item, locale, t("calendar.allDay"), t("calendar.nextDay"))}</div>
      {item.detail ? (
        <div className="kn-cal-row-kv">
          <i>{t(item.kind === "meeting" ? "calendar.row.agenda" : "calendar.row.detail")}</i>
          <span>{item.detail}</span>
        </div>
      ) : null}
      {item.people?.length ? (
        <div className="kn-cal-row-kv">
          <i>{t("calendar.row.people")}</i>
          <span>{item.people.join(", ")}</span>
        </div>
      ) : null}
      {item.source ? (
        <div className="kn-cal-row-kv">
          <i>{t("calendar.row.note")}</i>
          <NoteLink item={item} onOpen={() => a.openNote(item)} />
        </div>
      ) : null}
      <NotifyLine item={item} face={face} />
      <div className="kn-cal-acts">
        {item.source ? (
          <button type="button" className="kn-cal-btn" onClick={() => a.openNote(item)}>
            {t("calendar.openNote")}
          </button>
        ) : null}
        {item.readOnly ? null : (
          <button type="button" className="kn-cal-btn" onClick={() => a.snooze(item)}>
            {t("calendar.snooze")}
          </button>
        )}
        {item.kind === "task" && !item.readOnly ? (
          <button type="button" className="kn-cal-btn" onClick={() => a.toggleDone(item)}>
            {t(item.done ? "calendar.undone" : "calendar.done")}
          </button>
        ) : null}
      </div>
    </>
  );
}

/** O cartão do hover, do lado do item que tem espaço; um só ⤢, no canto de cima (spec #32129). */
export function HoverCard({ item, at, face, a, onExpand, onEnter, onLeave }: { item: CalendarItem; at: Rect; face: string | null; a: DetailActions; onExpand(card: HTMLElement): void; onEnter(): void; onLeave(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className="kn-cal-card"
      role="dialog"
      aria-label={item.title}
      data-id={item.id}
      style={{ left: at.left, top: at.top }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <CardBody item={item} a={a} face={face} onExpand={() => ref.current && onExpand(ref.current)} />
    </div>
  );
}

/** A nota de onde o item veio, com a linha dele marcada; cada linha abre as Notas nela. */
function NoteTab({ item, text, onOpenLine }: { item: CalendarItem; text: CalendarSource | null | "loading"; onOpenLine(line?: number): void }) {
  const { t } = useT();
  if (!item.source) return <p className="kn-cal-muted">{t("calendar.noteEmpty")}</p>;
  if (text === "loading") return <p className="kn-cal-muted">{t("calendar.noteLoading")}</p>;
  const lines = (text?.text ?? "").split("\n");
  const mark = text?.line ?? item.source.line;
  return (
    <div className="kn-cal-doc">
      <div className="kn-cal-doc-head">
        <span>{item.source.path}</span>
        <button type="button" className="kn-cal-link" data-note-link={item.source.path} onClick={() => onOpenLine(noteLine(item))}>
          {t("calendar.openInNotes")}
        </button>
      </div>
      <div className="kn-cal-doc-body">
        {lines.map((l, i) => {
          const h = /^(#{1,6})\s+(.*)$/.exec(l);
          const box = /^(\s*)- \[( |x|X)\]\s+(.*)$/.exec(l);
          return (
            <button
              type="button"
              key={i}
              className="kn-cal-doc-line"
              data-line={i + 1}
              data-mark={i === mark ? "" : undefined}
              data-heading={h ? h[1]!.length : undefined}
              onClick={() => onOpenLine(i + 1)}
            >
              {box ? <span className="kn-cal-box" data-on={box[2] !== " " ? "" : undefined} /> : null}
              {h ? h[2] : box ? box[3] : l || " "}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface LinkRow {
  key: string;
  label: string;
  hint: string;
  kind?: CalendarItem["kind"];
  open(): void;
}

/** As ligações: os outros itens da mesma nota e as notas citadas nela por `[[link]]`. */
function useLinks(item: CalendarItem, text: CalendarSource | null | "loading", items: CalendarItem[], source: CalendarStore, openPath: (path: string, internal: boolean, line?: number) => void, openItem: (i: CalendarItem) => void): LinkRow[] {
  const { t } = useT();
  const [wiki, setWiki] = useState<LinkRow[]>([]);
  const body = text && text !== "loading" ? text.text : "";
  useEffect(() => {
    let alive = true;
    const names = [...new Set([...body.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)].map((m) => m[1]!.trim()))].slice(0, 12);
    void Promise.all(names.map((n) => source.resolve(n).catch(() => null).then((p) => [n, p] as const))).then((r) => {
      if (!alive) return;
      setWiki(r.filter((x): x is readonly [string, string] => !!x[1]).map(([n, p]) => ({ key: `w:${p}`, label: n, hint: t("calendar.linkWiki"), open: () => openPath(p, false) })));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, source]);
  const same = item.source
    ? items
        .filter((i) => i.id !== item.id && i.source?.path === item.source!.path)
        .map((i): LinkRow => ({ key: `i:${i.id}`, label: i.title, hint: t("calendar.linkSameNote"), kind: i.kind, open: () => openItem(i) }))
    : [];
  return [...same, ...wiki];
}

/**
 * O painel largo. Nasce do retângulo do cartão (`from`) e cresce até o lugar dele à direita; na volta, vai até o
 * retângulo do item (`back()`). O `data-state` (opening, open, closing) é o que os roteiros esperam (T32157).
 */
export function WidePanel(props: {
  item: CalendarItem;
  from: Rect;
  to: Rect;
  state: WideState;
  back(): Rect | null;
  face: string | null;
  a: DetailActions;
  items: CalendarItem[];
  source: CalendarStore;
  openPath(path: string, internal: boolean, line?: number): void;
  openItem(i: CalendarItem): void;
  onOpened(): void;
  onClosed(): void;
  onCollapse(): void;
}) {
  const { item, from, to, state, face, a } = props;
  const { t, locale } = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<DetailTab>("item");
  const [text, setText] = useState<CalendarSource | null | "loading">(item.source ? "loading" : null);

  useEffect(() => {
    let alive = true;
    if (!item.source) return setText(null);
    setText("loading");
    props.source.source(item.id).then(
      (r) => alive && setText(r),
      () => alive && setText(null),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const links = useLinks(item, text, props.items, props.source, props.openPath, props.openItem);

  // A ida: do cartão até o lugar do painel; o cartão some e o conteúdo largo aparece depois de 180 ms.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || state !== "opening") return;
    const quick = reducedMotion();
    const ease = "cubic-bezier(.2,.8,.2,1)";
    const grow = el.animate([{ ...px(from), borderRadius: "14px" }, { ...px(to), borderRadius: "14px" }], { duration: quick ? 0 : OPEN_MS, easing: ease, fill: "both" });
    el.querySelector(".kn-cal-wide-card")?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: quick ? 0 : 300, fill: "both" });
    el.querySelector(".kn-cal-wide-body")?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: quick ? 0 : 300, delay: quick ? 0 : 180, fill: "both" });
    let done = false;
    grow.finished.then(
      () => {
        if (done) return;
        done = true;
        grow.commitStyles?.();
        grow.cancel();
        props.onOpened();
      },
      () => {},
    );
    return () => {
      done = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // A volta: direto para dentro do item, encolhendo e sumindo, enquanto o painel do Kiwi contrai (pelo `data-wide`).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || state !== "closing") return;
    const quick = reducedMotion();
    const target = props.back();
    const ease = "cubic-bezier(.4,0,.2,1)";
    const now = rectIn(el, el.offsetParent ?? el.parentElement!);
    el.querySelector(".kn-cal-wide-body")?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: quick ? 0 : 300, fill: "both" });
    const shrink = el.animate(
      [
        { ...px(now), opacity: 1, borderRadius: "14px" },
        target ? { ...px(target), opacity: 0, borderRadius: "8px" } : { ...px(now), opacity: 0, borderRadius: "14px" },
      ],
      { duration: quick ? 0 : CLOSE_MS, easing: ease, fill: "both" },
    );
    let done = false;
    shrink.finished.then(
      () => {
        if (done) return;
        done = true;
        props.onClosed();
      },
      () => {},
    );
    return () => {
      done = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    if (state !== "open") return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onCollapse();
    };
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const tabs: { id: DetailTab; label: string }[] = [
    { id: "item", label: t("calendar.tab.item") },
    { id: "note", label: t("calendar.tab.note") },
    { id: "links", label: links.length ? t("calendar.tab.linksCount", { n: links.length }) : t("calendar.tab.links") },
  ];

  return (
    <div ref={ref} className="kn-cal-wide" role="dialog" aria-label={item.title} data-state={state} data-id={item.id} style={px(state === "opening" ? from : to)}>
      {state === "opening" ? (
        <div className="kn-cal-wide-card">
          <CardBody item={item} a={a} face={face} />
        </div>
      ) : null}
      <div className="kn-cal-wide-body" style={{ width: to.width }}>
        <div className="kn-cal-wide-top">
          <KindTags item={item} />
          <span className="kn-cal-sp" />
          <button type="button" className="kn-cal-ic kn-cal-collapse" title={t("calendar.collapse")} aria-label={t("calendar.collapse")} onClick={props.onCollapse}>
            ⤡
          </button>
          <button type="button" className="kn-cal-ic kn-cal-close" title={t("calendar.close")} aria-label={t("calendar.close")} onClick={props.onCollapse}>
            ✕
          </button>
        </div>
        <div>
          <h2 className="kn-cal-wide-title">{item.title}</h2>
          <div className="kn-cal-when">
            {whenLine(item, locale, t("calendar.allDay"), t("calendar.nextDay"))}
            {item.people?.length ? ` · ${item.people.join(", ")}` : ""}
          </div>
        </div>
        <div className="kn-cal-tabs" role="tablist">
          {tabs.map((x) => (
            <button type="button" role="tab" key={x.id} data-tab={x.id} aria-selected={tab === x.id} onClick={() => setTab(x.id)}>
              {x.label}
            </button>
          ))}
        </div>
        <div className="kn-cal-tabpanel" role="tabpanel" data-tab={tab}>
          {tab === "item" ? (
            <div className="kn-cal-fields">
              <div className="kn-cal-row-kv">
                <i>{t("calendar.row.kind")}</i>
                <span>{t(`calendar.kind.${item.kind}`)}</span>
              </div>
              <div className="kn-cal-row-kv">
                <i>{t("calendar.row.project")}</i>
                <span>{item.project ?? t("calendar.noProject")}</span>
              </div>
              <div className="kn-cal-row-kv">
                <i>{t("calendar.row.when")}</i>
                <span>{whenLine(item, locale, t("calendar.allDay"), t("calendar.nextDay"))}</span>
              </div>
              {item.repeat ? (
                <div className="kn-cal-row-kv">
                  <i>{t("calendar.row.repeat")}</i>
                  <span>{t(`calendar.repeat.${item.repeat}`)}</span>
                </div>
              ) : null}
              {item.detail ? (
                <div className="kn-cal-row-kv">
                  <i>{t(item.kind === "meeting" ? "calendar.row.agenda" : "calendar.row.detail")}</i>
                  <span>{item.detail}</span>
                </div>
              ) : null}
              {item.source ? (
                <div className="kn-cal-row-kv">
                  <i>{t("calendar.row.note")}</i>
                  <NoteLink item={item} onOpen={() => a.openNote(item)} />
                </div>
              ) : null}
              {item.readOnly ? <p className="kn-cal-muted">{t("calendar.readOnly")}</p> : null}
              <div className="kn-cal-acts">
                {item.readOnly ? null : (
                  <button type="button" className="kn-cal-btn" onClick={() => a.snooze(item)}>
                    {t("calendar.snooze")}
                  </button>
                )}
                {item.kind === "task" && !item.readOnly ? (
                  <button type="button" className="kn-cal-btn" onClick={() => a.toggleDone(item)}>
                    {t(item.done ? "calendar.undone" : "calendar.done")}
                  </button>
                ) : null}
              </div>
            </div>
          ) : tab === "note" ? (
            <NoteTab item={item} text={text} onOpenLine={(line) => item.source && props.openPath(item.source.path, item.source.internal, line)} />
          ) : links.length ? (
            <div className="kn-cal-links">
              {links.map((l) => (
                <button type="button" key={l.key} className="kn-cal-link-row" data-kind={l.kind} data-note-link={l.key.startsWith("w:") ? l.key.slice(2) : undefined} onClick={l.open}>
                  <span className="kn-cal-link">{l.label} ↗</span>
                  <small>{l.hint}</small>
                </button>
              ))}
            </div>
          ) : (
            <p className="kn-cal-muted">{t("calendar.linksEmpty")}</p>
          )}
        </div>
        <div className="kn-cal-notify">
          <h4>
            {face ? <img src={face} alt="" /> : null}
            {t("calendar.notify.title")}
          </h4>
          <div className="kn-cal-chips" role="radiogroup" aria-label={t("calendar.notify.title")}>
            {CALENDAR_NOTIFY.map((n) => (
              <button type="button" role="radio" key={n} data-notify={n} aria-checked={item.notify === n} disabled={item.readOnly} onClick={() => a.setNotify(item, n)}>
                {t(`calendar.notify.${n}`)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
