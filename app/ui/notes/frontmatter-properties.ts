import { Document, isMap, isScalar, isSeq, parseDocument, stringify, type Pair, type Scalar, type YAMLMap } from "yaml";

export type PropertyType = "text" | "list" | "number" | "checkbox" | "date" | "datetime" | "link";
export type PropertyValue = string | number | boolean | string[] | null;

export interface Property {
  key: string;
  type: PropertyType;
  value: PropertyValue;
  raw?: string;
}

export const PROPERTY_TYPES: { type: PropertyType; label: string }[] = [
  { type: "text", label: "Texto" },
  { type: "list", label: "Lista" },
  { type: "number", label: "Número" },
  { type: "checkbox", label: "Caixa de seleção" },
  { type: "date", label: "Data" },
  { type: "datetime", label: "Data e hora" },
  { type: "link", label: "Link" },
];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const LINK = /^\[\[[^\]\n]+\]\]$/;
const LIST_KEYS = new Set(["tags", "aliases", "cssclasses"]);
const BLOCK = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/;

export function inferType(key: string, value: PropertyValue): PropertyType {
  if (Array.isArray(value) || LIST_KEYS.has(key)) return "list";
  if (typeof value === "boolean") return "checkbox";
  if (typeof value === "number") return "number";
  if (typeof value === "string") {
    if (DATE.test(value)) return "date";
    if (DATETIME.test(value)) return "datetime";
    if (LINK.test(value)) return "link";
  }
  return "text";
}

const scalarText = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

function plain(key: string, node: unknown): { value: PropertyValue; raw?: string } {
  if (isSeq(node)) {
    if (!node.items.every((i) => isScalar(i))) return { value: null, raw: stringify(node).trim() };
    return { value: node.items.map((i) => scalarText((i as Scalar).value)).filter((s) => s !== "") };
  }
  if (isMap(node)) return { value: null, raw: stringify(node).trim() };
  const v: unknown = isScalar(node) ? node.value : null;
  if (v instanceof Date) return { value: v.toISOString() };
  if (typeof v === "string" && LIST_KEYS.has(key)) return { value: v.split(/[,\s]+/).filter(Boolean) };
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return { value: v };
  return { value: null };
}

interface Parsed {
  doc: Document;
  inner: string;
  before: string;
  after: string;
}

function parse(frontmatter: string): Parsed | null {
  if (!frontmatter.trim()) return { doc: new Document({}), inner: "", before: "", after: "" };
  const m = BLOCK.exec(frontmatter);
  if (!m) return null;
  const inner = m[1]!;
  const at = frontmatter.indexOf("\n") + 1;
  const doc = parseDocument(inner);
  if (doc.errors.length) return null;
  if (doc.contents !== null && (!isMap(doc.contents) || doc.contents.flow)) return null;
  return { doc, inner, before: frontmatter.slice(0, at), after: frontmatter.slice(at + inner.length) };
}

const pairs = (doc: Document): Pair[] => (isMap(doc.contents) ? (doc.contents.items as Pair[]) : []);
const keyOf = (p: Pair): string => scalarText(isScalar(p.key) ? p.key.value : p.key);
const range = (n: unknown): [number, number, number] | undefined =>
  isScalar(n) || isSeq(n) || isMap(n) ? (n.range ?? undefined) : undefined;

/** As propriedades do frontmatter, na ordem do arquivo. `null` quando ele não é um mapa YAML válido. */
export function readProperties(frontmatter: string): Property[] | null {
  const parsed = parse(frontmatter);
  if (!parsed) return null;
  return pairs(parsed.doc).map((p) => {
    const key = keyOf(p);
    const { value, raw } = plain(key, p.value);
    return raw === undefined ? { key, type: inferType(key, value), value } : { key, type: "text", value, raw };
  });
}

/** `chave: valor` como o YAML escreve, mantendo as aspas da chave e do texto e o estilo da lista de antes. */
function piece(oldKey: unknown, key: string, oldValue: unknown, value: PropertyValue): string {
  const doc = new Document({});
  const k = doc.createNode(key);
  if (isScalar(oldKey) && isScalar(k)) k.type = oldKey.type;
  const v = doc.createNode(value);
  if (isSeq(oldValue) && isSeq(v)) v.flow = oldValue.flow;
  if (isScalar(oldValue) && isScalar(v) && typeof value === "string" && typeof oldValue.value === "string") v.type = oldValue.type;
  (doc.contents as YAMLMap).add({ key: k, value: v });
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false, nullStr: "" }).replace(/\n$/, "");
}

/** Monta o frontmatter com o miolo novo; os `---` e o resto ficam como vieram. */
function rebuild(parsed: Parsed, original: string, inner: string): string {
  const crlf = original.includes("\r\n");
  const text = crlf ? inner.replace(/\r?\n/g, "\r\n") : inner;
  if (!parsed.before) return crlf ? `---\r\n${text}\r\n---\r\n` : `---\n${text}\n---\n`;
  return parsed.before + text + parsed.after;
}

/** Grava o valor na chave (cria no fim se não existe). Só o trecho daquela chave muda; o resto fica byte a byte. */
export function setProperty(frontmatter: string, key: string, value: PropertyValue): string {
  const parsed = parse(frontmatter);
  if (!parsed) return frontmatter;
  const { inner } = parsed;
  const pair = pairs(parsed.doc).find((p) => keyOf(p) === key);
  if (!pair) {
    const line = piece(null, key, null, value);
    return rebuild(parsed, frontmatter, inner ? `${inner.replace(/\r?\n$/, "")}\n${line}` : line);
  }
  const now = plain(key, pair.value);
  if (now.raw === undefined && JSON.stringify(now.value) === JSON.stringify(value)) return frontmatter;
  const from = range(pair.key)![0];
  const to = range(pair.value)?.[1] ?? range(pair.key)![1];
  const newline = inner[to - 1] === "\n" ? "\n" : "";
  return rebuild(parsed, frontmatter, inner.slice(0, from) + piece(pair.key, key, pair.value, value) + newline + inner.slice(to));
}

/** Troca o nome da chave no mesmo lugar. `null` quando o nome novo é vazio ou já existe. */
export function renameProperty(frontmatter: string, from: string, to: string): string | null {
  const name = to.trim();
  if (!name) return null;
  if (name === from) return frontmatter;
  const parsed = parse(frontmatter);
  if (!parsed) return null;
  if (pairs(parsed.doc).some((p) => keyOf(p) === name)) return null;
  const pair = pairs(parsed.doc).find((p) => keyOf(p) === from);
  if (!pair) return null;
  const [start, end] = range(pair.key)!;
  const text = piece(pair.key, name, null, null).replace(/:$/, "");
  return rebuild(parsed, frontmatter, parsed.inner.slice(0, start) + text + parsed.inner.slice(end));
}

export function removeProperty(frontmatter: string, key: string): string {
  const parsed = parse(frontmatter);
  if (!parsed) return frontmatter;
  const items = pairs(parsed.doc);
  const pair = items.find((p) => keyOf(p) === key);
  if (!pair) return frontmatter;
  if (items.length === 1) return "";
  const { inner } = parsed;
  const from = range(pair.key)![0];
  let to = range(pair.value)?.[2] ?? range(pair.key)![2];
  if (to > 0 && inner[to - 1] !== "\n") {
    const eol = inner.indexOf("\n", to);
    to = eol === -1 ? inner.length : eol + 1;
  }
  return rebuild(parsed, frontmatter, (inner.slice(0, from) + inner.slice(to)).replace(/\r?\n$/, ""));
}

/** Uma propriedade nova e vazia no fim, com um nome que ainda não existe. */
export function addProperty(frontmatter: string): { frontmatter: string; key: string } | null {
  const props = readProperties(frontmatter);
  if (!props) return null;
  const taken = new Set(props.map((p) => p.key));
  let key = "propriedade";
  for (let n = 2; taken.has(key); n++) key = `propriedade ${n}`;
  return { frontmatter: setProperty(frontmatter, key, null), key };
}

const asText = (v: PropertyValue): string => (Array.isArray(v) ? v.join(", ") : scalarText(v));

/** O valor levado para outro tipo, sem perder o que dá para manter. Vazio (`null`) quando não há como. */
export function convertValue(value: PropertyValue, to: PropertyType): PropertyValue {
  const text = asText(value).trim();
  switch (to) {
    case "text":
      return text || null;
    case "list":
      return Array.isArray(value) ? value : text ? [text] : [];
    case "number": {
      const n = typeof value === "number" ? value : Number(text.replace(",", "."));
      return text && Number.isFinite(n) ? n : null;
    }
    case "checkbox":
      return value === true || /^(true|sim|yes|1)$/i.test(text);
    case "date":
      return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
    case "datetime":
      return DATETIME.test(text) ? text : DATE.test(text) ? `${text}T00:00` : null;
    case "link": {
      const first = Array.isArray(value) ? (value[0] ?? "") : text;
      return first ? (LINK.test(first) ? first : `[[${first.replace(/^\[\[|\]\]$/g, "")}]]`) : null;
    }
  }
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** `2026-11-06` → "6 nov 2026"; com hora, "6 nov 2026, 14:30". O que não é data volta como está. */
export function formatDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value);
  if (!m) return value;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return value;
  const day = `${Number(m[3])} ${month} ${m[1]}`;
  return m[4] ? `${day}, ${m[4]}:${m[5]}` : day;
}

/** O alvo de um `[[alvo|apelido]]`, para abrir a nota. */
export const linkTarget = (value: string): string => value.replace(/^\[\[|\]\]$/g, "").split("|")[0]!.trim();
export const linkLabel = (value: string): string => {
  const inner = value.replace(/^\[\[|\]\]$/g, "");
  const bar = inner.indexOf("|");
  return (bar === -1 ? inner : inner.slice(bar + 1)).trim();
};
