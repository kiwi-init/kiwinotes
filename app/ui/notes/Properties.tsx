// O painel de propriedades (T6598, E14, issue 190): o frontmatter YAML da nota como linhas com tipo, como no Obsidian.
// Embaixo do título e da meta, recolhível. Cada edição muda só o trecho daquela chave no frontmatter (frontmatter-properties.ts),
// e o resto do arquivo fica como estava. Sem propriedades, o painel some; o "Adicionar" fica no menu e na paleta.
// Ideia do SilverBullet (`syntax/frontmatter_preview.ts`, MIT).

import { type KeyboardEvent, type ReactElement, useEffect, useMemo, useRef, useState } from "react";

import { Switch } from "../src/kit/index.tsx";
import { ContextMenu, type MenuItem } from "./ContextMenu.tsx";
import {
  convertValue,
  formatDate,
  linkLabel,
  linkTarget,
  PROPERTY_TYPES,
  type Property,
  type PropertyType,
  type PropertyValue,
  readProperties,
  removeProperty,
  renameProperty,
  setProperty,
} from "./frontmatter-properties.ts";
import { Twisty } from "./treeIcons.tsx";

const ICONS: Record<PropertyType | "tags", ReactElement> = {
  text: <path d="M3 4.5h10M3 8h10M3 11.5h6" />,
  list: (
    <>
      <path d="M6.5 4.5h6.5M6.5 8h6.5M6.5 11.5h6.5" />
      <circle cx="3.5" cy="4.5" r=".6" />
      <circle cx="3.5" cy="8" r=".6" />
      <circle cx="3.5" cy="11.5" r=".6" />
    </>
  ),
  tags: <path d="M6.5 2.5 5.5 13.5M10.5 2.5l-1 11M3 6h10.5M2.5 10H13" />,
  number: <path d="M6 5.2 8.5 3.5v9M6 12.5h5" />,
  checkbox: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
      <path d="m5.5 8.2 1.8 1.8 3.3-4" />
    </>
  ),
  date: (
    <>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
    </>
  ),
  datetime: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3l2 1.5" />
    </>
  ),
  link: <path d="M7 9a2.5 2.5 0 0 0 3.5 0l2-2A2.5 2.5 0 0 0 9 3.5l-.6.6M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.6-.6" />,
};

const label = (t: PropertyType) => PROPERTY_TYPES.find((p) => p.type === t)!.label;

/** O texto do campo ao editar, e o valor que ele vira ao gravar (`undefined`: o texto não serve para o tipo). */
function draftOf(type: PropertyType, value: PropertyValue): string {
  if (value === null) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (type === "link" && typeof value === "string") return value.replace(/^\[\[|\]\]$/g, "");
  if (type === "datetime" && typeof value === "string") return value.replace(" ", "T").slice(0, 16);
  return String(value);
}

function parseDraft(type: PropertyType, key: string, text: string): PropertyValue | undefined {
  const t = text.trim();
  switch (type) {
    case "list": {
      const items = t.split(",").map((s) => s.trim()).filter(Boolean);
      return key === "tags" ? items.map((s) => s.replace(/^#/, "")) : items;
    }
    case "number": {
      if (!t) return null;
      const n = Number(t.replace(",", "."));
      return Number.isFinite(n) ? n : undefined;
    }
    case "link":
      return t ? `[[${t.replace(/^\[\[|\]\]$/g, "")}]]` : null;
    case "checkbox":
      return t === "true";
    default:
      return t ? text : null;
  }
}

const INPUT: Partial<Record<PropertyType, string>> = { date: "date", datetime: "datetime-local" };
const OPEN_KEY = "kn-props-open";

function initiallyOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    // Sem armazenamento (janela privada, teste): o painel abre aberto.
    return true;
  }
}

export interface PropertiesProps {
  frontmatter: string;
  onChange(frontmatter: string): void;
  onAdd(): void;
  onOpenTag(tag: string): void;
  onOpenLink(target: string): void;
  /** A chave recém-criada: o painel abre com o nome dela em edição. */
  renaming?: string | null;
  onRenamingDone?(): void;
}

type Editing = { key: string; part: "key" | "value"; text: string; invalid?: boolean };

export function Properties({ frontmatter, onChange, onAdd, onOpenTag, onOpenLink, renaming, onRenamingDone }: PropertiesProps) {
  const props = useMemo(() => readProperties(frontmatter), [frontmatter]);
  const [open, setOpen] = useState(initiallyOpen);
  const [types, setTypes] = useState<Record<string, PropertyType>>({});
  const [menu, setMenu] = useState<{ x: number; y: number; key: string } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const latest = useRef(frontmatter);
  latest.current = frontmatter;

  useEffect(() => {
    if (!renaming) return;
    setOpen(true);
    setEditing({ key: renaming, part: "key", text: renaming });
    onRenamingDone?.();
  }, [renaming, onRenamingDone]);

  if (props === null)
    return (
      <section className="kn-props" aria-label="Propriedades">
        <div className="kn-props-bad">O frontmatter desta nota não é YAML válido. Ele fica como está no arquivo.</div>
      </section>
    );
  if (!props.length) return null;

  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(OPEN_KEY, o ? "0" : "1");
      } catch {
        // Sem armazenamento: o painel só não lembra da escolha na próxima vez.
      }
      return !o;
    });
  };
  const typeOf = (p: Property): PropertyType => (p.raw !== undefined ? "text" : (types[p.key] ?? p.type));
  const write = (key: string, value: PropertyValue) => onChange(setProperty(latest.current, key, value));

  const changeType = (p: Property, to: PropertyType) => {
    setTypes((t) => ({ ...t, [p.key]: to }));
    write(p.key, convertValue(p.value, to));
  };
  const commit = (p: Property) => {
    if (!editing || editing.key !== p.key) return;
    if (editing.part === "key") {
      const name = editing.text.trim();
      if (!name || name === p.key) return setEditing(null);
      const next = renameProperty(latest.current, p.key, name);
      if (next === null) return setEditing({ ...editing, invalid: true });
      setTypes(({ [p.key]: moved, ...rest }) => (moved ? { ...rest, [name]: moved } : rest));
      setEditing(null);
      return onChange(next);
    }
    const value = parseDraft(typeOf(p), p.key, editing.text);
    if (value === undefined) return setEditing({ ...editing, invalid: true });
    setEditing(null);
    write(p.key, value);
  };
  const keys = (p: Property) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(p);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setEditing(null);
    }
  };
  const edit = (p: Property) => {
    if (p.raw !== undefined) return;
    setEditing({ key: p.key, part: "value", text: draftOf(typeOf(p), p.value) });
  };
  const menuItems = (p: Property): MenuItem[] => [
    { kind: "title", label: "Tipo" },
    ...PROPERTY_TYPES.map(({ type, label: name }): MenuItem => ({
      label: name,
      checked: typeOf(p) === type,
      disabled: p.raw !== undefined,
      onSelect: () => changeType(p, type),
    })),
    { kind: "separator" },
    { label: "Renomear", onSelect: () => setEditing({ key: p.key, part: "key", text: p.key }) },
    { label: "Remover", danger: true, onSelect: () => onChange(removeProperty(latest.current, p.key)) },
  ];

  const value = (p: Property) => {
    const type = typeOf(p);
    if (editing?.key === p.key && editing.part === "value")
      return (
        <input
          className="kn-prop-input"
          autoFocus
          aria-label={`Valor de ${p.key}`}
          aria-invalid={editing.invalid || undefined}
          type={INPUT[type] ?? "text"}
          inputMode={type === "number" ? "decimal" : undefined}
          placeholder={type === "list" ? "itens separados por vírgula" : undefined}
          value={editing.text}
          spellCheck={false}
          onChange={(e) => setEditing({ ...editing, text: e.target.value, invalid: false })}
          onBlur={() => commit(p)}
          onKeyDown={keys(p)}
        />
      );
    if (p.raw !== undefined)
      return (
        <code className="kn-prop-raw" title="Um valor aninhado: o painel só mostra">
          {p.raw}
        </code>
      );
    if (type === "checkbox") return <Switch checked={p.value === true} label={p.key} onChange={(v) => write(p.key, v)} />;
    if (type === "list") {
      const items = Array.isArray(p.value) ? p.value : [];
      return (
        <div className="kn-prop-list" role="group" aria-label={p.key}>
          {items.map((item, i) =>
            p.key === "tags" ? (
              <button type="button" key={`${item}:${i}`} className="kn-prop-pill" data-tag="" title={`Notas com #${item}`} onClick={() => onOpenTag(item)}>
                #{item}
              </button>
            ) : /^\[\[[^\]]+\]\]$/.test(item) ? (
              <button type="button" key={`${item}:${i}`} className="kn-prop-pill" data-link="" onClick={() => onOpenLink(linkTarget(item))}>
                {linkLabel(item)}
              </button>
            ) : (
              <span key={`${item}:${i}`} className="kn-prop-pill">
                {item}
              </span>
            ),
          )}
          <button type="button" className="kn-prop-more" aria-label={`Editar ${p.key}`} onClick={() => edit(p)}>
            {items.length ? "editar" : "Vazio"}
          </button>
        </div>
      );
    }
    if (type === "link" && typeof p.value === "string" && p.value)
      return (
        <div className="kn-prop-list">
          <button type="button" className="kn-prop-link" onClick={() => onOpenLink(linkTarget(p.value as string))}>
            {linkLabel(p.value)}
          </button>
          <button type="button" className="kn-prop-more" aria-label={`Editar ${p.key}`} onClick={() => edit(p)}>
            editar
          </button>
        </div>
      );
    const shown =
      p.value === null || p.value === ""
        ? null
        : (type === "date" || type === "datetime") && typeof p.value === "string"
          ? formatDate(p.value)
          : String(p.value);
    return (
      <button
        type="button"
        className="kn-prop-val"
        data-mono={type === "number" || type === "date" || type === "datetime" || undefined}
        data-empty={shown === null || undefined}
        aria-label={`${p.key}: ${shown ?? "vazio"}. Editar`}
        onClick={() => edit(p)}
      >
        {shown ?? "Vazio"}
      </button>
    );
  };

  return (
    <section className="kn-props" aria-label="Propriedades">
      <button type="button" className="kn-props-head" aria-expanded={open} onClick={toggle}>
        <Twisty open={open} />
        Propriedades · {props.length}
      </button>
      {open ? (
        <>
          {props.map((p) => {
            const type = typeOf(p);
            return (
              <div className="kn-prop" key={p.key} data-type={type}>
                <button
                  type="button"
                  className="kn-prop-icon"
                  aria-label={`${label(type)}. Opções de ${p.key}`}
                  aria-haspopup="menu"
                  aria-expanded={menu?.key === p.key}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenu({ x: r.left, y: r.bottom + 4, key: p.key });
                  }}
                >
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
                    {ICONS[p.key === "tags" ? "tags" : type]}
                  </svg>
                </button>
                {editing?.key === p.key && editing.part === "key" ? (
                  <input
                    className="kn-prop-input kn-prop-key"
                    autoFocus
                    aria-label="Nome da propriedade"
                    aria-invalid={editing.invalid || undefined}
                    title={editing.invalid ? "Já existe uma propriedade com esse nome" : undefined}
                    value={editing.text}
                    spellCheck={false}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setEditing({ ...editing, text: e.target.value, invalid: false })}
                    onBlur={() => commit(p)}
                    onKeyDown={keys(p)}
                  />
                ) : (
                  <span className="kn-prop-key" title={p.key} onDoubleClick={() => setEditing({ key: p.key, part: "key", text: p.key })}>
                    {p.key}
                  </span>
                )}
                <div className="kn-prop-value">{value(p)}</div>
              </div>
            );
          })}
          <button type="button" className="kn-props-add" onClick={onAdd}>
            + Adicionar propriedade
          </button>
        </>
      ) : null}
      {menu
        ? (() => {
            const p = props.find((x) => x.key === menu.key);
            return p ? <ContextMenu x={menu.x} y={menu.y} items={menuItems(p)} onClose={() => setMenu(null)} /> : null;
          })()
        : null}
    </section>
  );
}
