// A aba Calendário do hub (T32155, spec #32129): as vistas Dia · Semana · Mês · Agenda (a Semana é a padrão), o
// cartão do hover, o painel largo com a animação de ida e volta, e o arrastar e o esticar dos itens. Os itens vêm das
// notas pelo main (T32154, `calendar.*`); o painel do Kiwi à direita é da parte 3 (T32156), no `.kn-cal-side`.

import "./calendar.css";

import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { addDays, type CalendarItem, type CalendarItems, type CalendarNotify, type CalendarUndo, type CalendarUpdate } from "../../src/shared/calendar.ts";
import { kiwiFace } from "../notes/editor/kiwi-face.ts";
import { useT } from "../src/i18n.ts";
import { type DetailActions, HIDE_MS, HoverCard, PULSE_MS, type Rect, rectIn, WIDE_PX, WidePanel, type WideState } from "./Detail.tsx";
import { editable, isOccurrence, typing } from "./edit.ts";
import { type CalendarFilter, filterStorage, passes, readFilter, shownProjects, toggleAllProjects, toggleKind, toggleProject, writeFilter } from "./filter.ts";
import { periodTitle } from "./format.ts";
import { CALENDAR_VIEWS, type CalendarView, isCalendarView, moveItem, newItemDay, noteLine, onDay, resizeItem, stepAnchor, viewRange } from "./model.ts";
import { KiwiAskBox } from "./KiwiAsk.tsx";
import { KiwiPanel } from "./KiwiPanel.tsx";
import { NewItem } from "./NewItem.tsx";
import { apiStore, type CalendarStore, todayOf } from "./source.ts";
import { AgendaList, type DragMode, HOUR_PX, type ItemHandlers, type ItemState, MonthGrid, TimeGrid } from "./views.tsx";

type Load = { state: "loading" } | { state: "ready"; data: CalendarItems } | { state: "error" };

interface Drag {
  id: string;
  mode: DragMode;
  x: number;
  y: number;
  day: string;
  moved: boolean;
  /** A prévia, em minutos e dias desde o começo do arrastar. */
  dm: number;
  dd: number;
}

interface Open {
  item: CalendarItem;
  from: Rect;
  to: Rect;
  state: WideState;
}

const DRAG_START_PX = 4;
const KINDS = ["meeting", "reminder", "task", "note", "focus"] as const;

const initialView = (): CalendarView => {
  const q = typeof location !== "undefined" ? new URLSearchParams(location.search).get("view") : null;
  return isCalendarView(q) ? q : "week";
};

/** O dia sob o ponteiro: a coluna (ou a célula do Mês) que tem `data-day`. */
const dayAt = (x: number, y: number): string | null =>
  (document.elementFromPoint(x, y)?.closest("[data-day]") as HTMLElement | null)?.dataset.day ?? null;

const errCode = (e: unknown) => (e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "");

export function Calendar({ active, source: given, onOpenNote, catColor }: { active: boolean; source?: CalendarStore; onOpenNote(path: string, internal: boolean, line?: number): void; catColor?: unknown }) {
  const { t, locale } = useT();
  const [fallback] = useState(() => (given ? null : apiStore()));
  const source = given ?? fallback!;
  const [view, setView] = useState<CalendarView>(initialView);
  const [today, setToday] = useState(() => todayOf());
  const [anchor, setAnchor] = useState(today);
  const [now, setNow] = useState(() => Date.now());
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [notice, setNotice] = useState<string | null>(null);
  const [face, setFace] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // O filtro por tipo e por projeto (T32408): vale nas quatro vistas e no painel do Kiwi, e fica no aparelho.
  const [filter, setFilterState] = useState<CalendarFilter>(() => readFilter(filterStorage()));
  const setFilter = (f: CalendarFilter) => {
    setFilterState(f);
    writeFilter(filterStorage(), f);
  };
  const range = useMemo(() => viewRange(view, anchor), [view, anchor]);
  const root = useRef<HTMLDivElement>(null);
  const side = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    kiwiFace(catColor).then((u) => alive && setFace(u), () => {});
    return () => {
      alive = false;
    };
  }, [catColor]);

  // A linha do agora anda a cada minuto, e o "hoje" vira à meia-noite.
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      setNow(Date.now());
      setToday(todayOf());
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [active]);

  const seq = useRef(0);
  const reload = useCallback(() => {
    const mine = ++seq.current;
    source.items(range.from, range.to).then(
      (data) => mine === seq.current && setLoad({ state: "ready", data }),
      (e) => {
        console.error("[calendar]", e);
        if (mine === seq.current) setLoad((l) => (l.state === "ready" ? l : { state: "error" }));
      },
    );
  }, [source, range.from, range.to]);
  useEffect(() => {
    reload();
    return source.onChanged(reload);
  }, [reload, source]);

  const items = load.state === "ready" ? load.data.items : [];

  // ---------------------------------------------------------------- o cartão do hover

  const [hover, setHover] = useState<{ item: CalendarItem; at: Rect } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState<Open | null>(null);
  const [pulse, setPulse] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const [dragView, setDragView] = useState<Drag | null>(null);

  const keepCard = () => clearTimeout(hideTimer.current);
  const hideCard = () => {
    // Editando no cartão (T34745): ele fica enquanto o foco está nele, mesmo com o mouse fora.
    if (root.current?.querySelector(".kn-cal-card")?.contains(document.activeElement)) return;
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setHover(null), HIDE_MS);
  };

  const showCard = (item: CalendarItem, el: HTMLElement) => {
    if (open || drag.current?.moved || !root.current) return;
    keepCard();
    const r = rectIn(el, root.current);
    const W = 300;
    const box = root.current.getBoundingClientRect();
    // À esquerda do item, como no protótipo; sem espaço, à direita.
    const left = r.left - W - 12 >= 8 ? r.left - W - 12 : Math.min(r.left + r.width + 12, box.width - W - 8);
    const top = Math.max(8, Math.min(r.top - 20, box.height - 330));
    setHover({ item, at: { left, top, width: W, height: 0 } });
  };

  // ---------------------------------------------------------------- o painel largo

  /** O lugar do painel largo: à direita, do topo da grade até o fim da tela. */
  const wideRect = (): Rect => {
    const r = root.current!.getBoundingClientRect();
    const body = root.current!.querySelector(".kn-cal-body");
    const top = body ? body.getBoundingClientRect().top - r.top : 64;
    const width = Math.min(WIDE_PX, r.width - 40);
    return { left: r.width - 20 - width, top, width, height: r.height - top - 18 };
  };
  const itemEl = (id: string) => root.current?.querySelector<HTMLElement>(`.kn-cal-item[data-id="${CSS.escape(id)}"]`) ?? null;

  /**
   * O retângulo do item quando a grade terminar de crescer: na volta, a grade e o painel do Kiwi mudam junto com o
   * painel largo, então a medida é a do fim. Corta a transição só para medir e a recomeça de onde estava.
   */
  const finalRect = (id: string): Rect | null => {
    const r = root.current;
    const main = r?.querySelector<HTMLElement>(".kn-cal-main");
    if (!r || !main) return null;
    const was = getComputedStyle(main).marginRight;
    main.style.transition = "none";
    const el = itemEl(id);
    const rect = el ? rectIn(el, r) : null;
    main.style.marginRight = was;
    void main.offsetWidth;
    main.style.transition = "";
    main.style.marginRight = "";
    return rect;
  };

  const expand = (item: CalendarItem, from: HTMLElement) => {
    if (open || !root.current) return;
    clearTimeout(hideTimer.current);
    setHover(null);
    setOpen({ item, from: rectIn(from, root.current), to: wideRect(), state: "opening" });
  };
  const collapse = () => setOpen((o) => (o && o.state === "open" ? { ...o, state: "closing" } : o));
  const closed = () => {
    setOpen((o) => {
      if (o) {
        setPulse(o.item.id);
        setTimeout(() => setPulse((p) => (p === o.item.id ? null : p)), PULSE_MS);
      }
      return null;
    });
  };
  // O item aberto acompanha o que o main devolve (o aviso mudado, o Feito).
  useEffect(() => {
    if (!open) return;
    const fresh = items.find((i) => i.id === open.item.id);
    if (fresh && fresh !== open.item) setOpen((o) => (o ? { ...o, item: fresh } : o));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // ---------------------------------------------------------------- escrever

  const save = async (u: CalendarUpdate) => {
    try {
      const fresh = await source.update(u);
      // A pendência sem data que ganhou dia (o arrasto do painel do Kiwi, T32156) ainda não está na grade: entra agora.
      setLoad((l) =>
        l.state !== "ready"
          ? l
          : l.data.items.some((i) => i.id === u.id)
            ? { state: "ready", data: { ...l.data, items: l.data.items.map((i) => (i.id === u.id ? fresh : i)) } }
            : { state: "ready", data: { ...l.data, items: [...l.data.items, fresh], undated: l.data.undated.filter((i) => i.id !== u.id) } },
      );
      setOpen((o) => (o && o.item.id === u.id ? { ...o, item: fresh } : o));
      setHover((h) => (h && h.item.id === u.id ? { ...h, item: fresh } : h));
    } catch (e) {
      setNotice(t(errCode(e) === "E_CONFLICT" ? "calendar.conflict" : "calendar.saveFailed"));
      reload();
    }
  };

  // ---------------------------------------------------------------- apagar e desfazer (T34745)

  const [undo, setUndo] = useState<{ token: CalendarUndo; title: string; once: boolean } | null>(null);
  const undoBtn = useRef<HTMLButtonElement>(null);

  const remove = async (item: CalendarItem, only?: boolean) => {
    if (!editable(item).any) return;
    try {
      const token = await source.remove({ id: item.id, ...(only ? { only: true } : {}) });
      setHover((h) => (h && h.item.id === item.id ? null : h));
      // O painel fecha sem a volta: o item para onde ela iria não existe mais.
      setOpen((o) => (o && o.item.id === item.id ? null : o));
      setNotice(null);
      setUndo({ token, title: item.title, once: !!only });
      reload();
    } catch (e) {
      setNotice(t(errCode(e) === "E_CONFLICT" ? "calendar.conflict" : "calendar.saveFailed"));
      reload();
    }
  };
  const doUndo = async () => {
    const u = undo;
    if (!u) return;
    setUndo(null);
    try {
      await source.restore(u.token);
      setNotice(t("calendar.restored", { title: u.title }));
      reload();
    } catch {
      setNotice(t("calendar.undoFailed"));
      reload();
    }
  };
  // O Desfazer recebe o foco: Enter desfaz, e o leitor de tela lê o aviso.
  useEffect(() => {
    if (undo) undoBtn.current?.focus();
  }, [undo]);

  const actions: DetailActions = {
    edit: (item, patch) => save({ id: item.id, ...patch }),
    remove: (item, only) => void remove(item, only),
    openNote: (item) => item.source && onOpenNote(item.source.path, item.source.internal, noteLine(item)),
    snooze: (item) => {
      const m = moveItem(item, 0, 1);
      if (m) void save({ id: item.id, ...m });
    },
    toggleDone: (item) => void save({ id: item.id, done: !item.done }),
    setNotify: (item, notify: CalendarNotify) => void save({ id: item.id, notify }),
  };

  // A tecla Delete (ou ⌫) apaga o item com o foco, o do painel largo ou o do cartão; numa repetição, só aquela vez. O
  // ⌘Z desfaz o último apagar. Nunca dentro de um campo, onde as duas são do texto.
  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => {
      if (typing(e.target) || e.altKey) return;
      if ((e.key === "z" || e.key === "Z") && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        if (!undo) return;
        e.preventDefault();
        void doUndo();
        return;
      }
      if ((e.key !== "Delete" && e.key !== "Backspace") || e.metaKey || e.ctrlKey || creating) return;
      const el = e.target instanceof Element ? e.target : null;
      const focused = el?.closest<HTMLElement>(".kn-cal-item[data-id]")?.dataset.id;
      const item = focused
        ? items.find((i) => i.id === focused)
        : open && open.state === "open" && el?.closest(".kn-cal-wide")
          ? open.item
          : hover && el?.closest(".kn-cal-card")
            ? hover.item
            : open && open.state === "open"
              ? open.item
              : undefined;
      if (!item || !editable(item).any) return;
      e.preventDefault();
      void remove(item, isOccurrence(item.id));
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, items, open, hover, undo, creating]);

  // ---------------------------------------------------------------- arrastar e esticar

  const startDrag = (e: ReactPointerEvent<HTMLElement>, item: CalendarItem, mode: DragMode) => {
    if (e.button !== 0 || item.readOnly || open) return;
    const day = dayAt(e.clientX, e.clientY) ?? item.start.slice(0, 10);
    drag.current = { id: item.id, mode, x: e.clientX, y: e.clientY, day, moved: false, dm: 0, dd: 0 };
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_START_PX) return;
      if (!d.moved) {
        d.moved = true;
        clearTimeout(hideTimer.current);
        setHover(null);
      }
      const minutes = view === "month" || view === "agenda" ? 0 : ((e.clientY - d.y) / HOUR_PX) * 60;
      const over = d.mode === "move" ? dayAt(e.clientX, e.clientY) : null;
      const dd = over ? Math.round((Date.parse(`${over}T12:00`) - Date.parse(`${d.day}T12:00`)) / 86_400_000) : d.dd;
      const next = { ...d, dm: minutes, dd: d.mode === "move" ? dd : 0 };
      drag.current = next;
      setDragView(next);
    };
    const up = () => {
      const d = drag.current;
      drag.current = null;
      setDragView(null);
      if (!d?.moved) return;
      const item = items.find((i) => i.id === d.id);
      if (!item) return;
      const patch = d.mode === "move" ? moveItem(item, d.dm, d.dd) : resizeItem(item, d.dm);
      if (patch) void save({ id: item.id, ...patch });
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", up);
    return () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, view]);

  /** Os itens com a prévia do arrastar aplicada (o item vai junto com o ponteiro, em passos de 15 min). */
  const visible = useMemo(() => items.filter((i) => passes(filter, i)), [items, filter]);
  const shown = useMemo(() => {
    if (!dragView?.moved) return visible;
    return visible.map((i) => {
      if (i.id !== dragView.id) return i;
      const p = dragView.mode === "move" ? moveItem(i, dragView.dm, dragView.dd) : resizeItem(i, dragView.dm);
      return p ? { ...i, ...p } : i;
    });
  }, [visible, dragView]);

  const handlers: ItemHandlers = {
    onEnter: showCard,
    onLeave: hideCard,
    onPointerDown: startDrag,
    onOpen: (item, el) => expand(item, el),
  };
  const st: ItemState = { openId: open?.item.id ?? null, dragId: dragView?.moved ? dragView.id : null, pulseId: pulse, kiwiFace: face };

  const goDay = (d: string) => {
    setAnchor(d);
    setView("day");
  };

  // Com o painel largo aberto na Semana, o fim de semana vazio sai da grade, para os dias úteis caberem (lead #32229).
  const wide = !!open && open.state !== "closing";
  const gridDays = useMemo(
    () => (wide && view === "week" ? range.days.filter((d, i) => i < 5 || shown.some((it) => onDay(it, d))) : range.days),
    [wide, view, range.days, shown],
  );

  // A conta de cada tipo segue o filtro de projeto, não o de tipo: o tipo escondido ainda mostra quantos tem.
  const counts = useMemo(() => {
    const inProjects = items.filter((i) => passes({ kinds: [], projects: filter.projects }, i));
    return Object.fromEntries(KINDS.map((k) => [k, inProjects.filter((i) => i.kind === k).length]));
  }, [items, filter.projects]);
  const projects = load.state === "ready" ? load.data.projects : [];

  return (
    <div className="kn-cal" ref={root} data-view={view} data-wide={wide ? "" : undefined} aria-label={t("calendar.aria")}>
      <div className="kn-cal-tool">
        <h1 className="kn-cal-title">{periodTitle(view, range.days, anchor, locale)}</h1>
        <button type="button" className="kn-cal-ic" aria-label={t("calendar.prev")} onClick={() => setAnchor((a) => stepAnchor(view, a, -1))}>
          ‹
        </button>
        <button type="button" className="kn-cal-btn" onClick={() => setAnchor(today)}>
          {t("calendar.today")}
        </button>
        <button type="button" className="kn-cal-ic" aria-label={t("calendar.next")} onClick={() => setAnchor((a) => stepAnchor(view, a, 1))}>
          ›
        </button>
        <span className="kn-cal-sp" />
        {/* A busca do Kiwi (⌘K), entre o período e as vistas, como no protótipo (T32156). */}
        <div className="kn-cal-ask-slot">
          <KiwiAskBox active={active} face={face} />
        </div>
        <span className="kn-cal-sp" />
        <div className="kn-cal-views" role="radiogroup" aria-label={t("calendar.views")}>
          {CALENDAR_VIEWS.map((v) => (
            <button type="button" role="radio" key={v} data-view={v} aria-checked={view === v} onClick={() => setView(v)}>
              {t(`calendar.view.${v}`)}
            </button>
          ))}
        </div>
        <button type="button" className="kn-cal-btn kn-cal-primary kn-cal-new" onClick={() => setCreating(true)}>
          {t("calendar.new")}
        </button>
      </div>
      <div className="kn-cal-legend">
        {KINDS.map((k) => (
          <button
            type="button"
            key={k}
            data-kind={k}
            aria-pressed={!filter.kinds.includes(k)}
            title={t(filter.kinds.includes(k) ? "calendar.filter.show" : "calendar.filter.hide", { kind: t(`calendar.kind.${k}`) })}
            onClick={() => setFilter(toggleKind(filter, k))}
          >
            <i />
            {t(`calendar.kind.${k}`)}
            {counts[k] ? <em>{counts[k]}</em> : null}
          </button>
        ))}
        {projects.length ? <ProjectPicker projects={projects} filter={filter} onChange={setFilter} /> : null}
        <span className="kn-cal-legend-kiwi">
          {face ? <img src={face} alt="" /> : null}
          {t("calendar.legend.kiwi")}
        </span>
      </div>
      {undo ? (
        <div className="kn-cal-notice" role="status" data-undo="">
          {t(undo.once ? "calendar.deletedOnce" : "calendar.deleted", { title: undo.title })}
          <button type="button" className="kn-cal-btn kn-cal-undo" ref={undoBtn} onClick={() => void doUndo()}>
            {t("calendar.undoDelete")}
          </button>
          <button type="button" className="kn-cal-ic" aria-label={t("calendar.close")} onClick={() => setUndo(null)}>
            ✕
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="kn-cal-notice" role="status">
          {notice}
          <button type="button" className="kn-cal-ic" aria-label={t("calendar.close")} onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      ) : null}
      <div className="kn-cal-body">
        <div className="kn-cal-main">
          {load.state === "loading" ? (
            <p className="kn-cal-empty">{t("calendar.loading")}</p>
          ) : load.state === "error" ? (
            <p className="kn-cal-empty">
              {t("calendar.loadFailed")}{" "}
              <button type="button" className="kn-cal-btn" onClick={reload}>
                {t("calendar.retry")}
              </button>
            </p>
          ) : view === "month" ? (
            <MonthGrid days={range.days} anchor={anchor} items={shown} today={today} h={handlers} s={st} onDay={goDay} />
          ) : view === "agenda" ? (
            <AgendaList days={range.days} items={shown} today={today} h={handlers} s={st} />
          ) : (
            <TimeGrid days={gridDays} items={shown} today={today} now={now} h={handlers} s={st} />
          )}
        </div>
        {/* O lugar do painel do Kiwi (T32156): ele estica embaixo do painel largo e contrai junto na volta. */}
        <aside className="kn-cal-side" ref={side}>
          <KiwiPanel source={source} today={today} now={now} face={face} save={save} filter={filter} />
        </aside>
      </div>
      {hover && !open ? (
        <HoverCard key={hover.item.id} item={hover.item} at={hover.at} face={face} a={actions} ctx={{ projects, source }} onExpand={(card) => expand(hover.item, card)} onEnter={keepCard} onLeave={hideCard} />
      ) : null}
      {open ? (
        <WidePanel
          key={open.item.id}
          item={open.item}
          from={open.from}
          to={open.to}
          state={open.state}
          back={() => finalRect(open.item.id)}
          face={face}
          a={actions}
          items={items}
          projects={projects}
          source={source}
          openPath={onOpenNote}
          openItem={(i) => {
            const el = itemEl(i.id);
            setOpen((o) => (o ? { ...o, item: i, ...(el && root.current ? {} : {}) } : o));
          }}
          onOpened={() => setOpen((o) => (o && o.state === "opening" ? { ...o, state: "open" } : o))}
          onClosed={closed}
          onCollapse={collapse}
        />
      ) : null}
      {creating ? (
        <NewItem
          day={newItemDay(view, anchor, today)}
          projects={load.state === "ready" ? load.data.projects : []}
          onCancel={() => setCreating(false)}
          onCreate={async (c) => {
            try {
              await source.create(c);
              setCreating(false);
              if (c.start.slice(0, 10) < range.from || c.start.slice(0, 10) >= range.to) setAnchor(c.start.slice(0, 10));
              reload();
            } catch {
              setNotice(t("calendar.saveFailed"));
            }
          }}
        />
      ) : null}
    </div>
  );
}

/** O seletor de projetos ao lado da legenda: uma caixa por pasta de primeiro nível, e o "Todos". */
function ProjectPicker({ projects, filter, onChange }: { projects: readonly string[]; filter: CalendarFilter; onChange(f: CalendarFilter): void }) {
  const { t } = useT();
  const [isOpen, setIsOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const n = shownProjects(filter, projects);
  const all = n === projects.length;

  // Fecha com o clique fora e com o Esc.
  useEffect(() => {
    if (!isOpen) return;
    const down = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setIsOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    addEventListener("pointerdown", down, true);
    addEventListener("keydown", key);
    return () => {
      removeEventListener("pointerdown", down, true);
      removeEventListener("keydown", key);
    };
  }, [isOpen]);

  return (
    <div className="kn-cal-projects" ref={box} data-open={isOpen ? "" : undefined} data-filtered={all ? undefined : ""}>
      <button type="button" className="kn-cal-projects-bt" aria-haspopup="true" aria-expanded={isOpen} onClick={() => setIsOpen((o) => !o)}>
        {all ? t("calendar.projects.all") : t("calendar.projects.some", { n, total: projects.length })}
        <span aria-hidden="true">▾</span>
      </button>
      {isOpen ? (
        <div className="kn-cal-projects-pop" role="group" aria-label={t("calendar.projects")}>
          <label data-project-all="">
            <input type="checkbox" checked={all} ref={(el) => {
              if (el) el.indeterminate = !all && n > 0;
            }} onChange={() => onChange(toggleAllProjects(filter, projects))} />
            {t("calendar.projects.allOption")}
          </label>
          {projects.map((p) => (
            <label key={p} data-project={p}>
              <input type="checkbox" checked={!filter.projects.includes(p)} onChange={() => onChange(toggleProject(filter, p))} />
              {p}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** O fim do dia de hoje (o "+ Novo" sugere a próxima hora cheia). */
export const nextHour = (now = new Date()) => `${String(Math.min(23, now.getHours() + 1)).padStart(2, "0")}:00`;
export { addDays };
