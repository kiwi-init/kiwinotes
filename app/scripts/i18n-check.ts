// Os textos fixos nas telas (spec #28171, T28190): todo texto visível escrito direto no JSX, fora do catálogo
// (`src/shared/i18n/`). Por enquanto é um aviso: a migração anda por partes (T28191, T28297), e o CI só conta.
// As telas já migradas (`MIGRATED`) não podem ter nenhum: ali o check barra.
//
//   bun scripts/i18n-check.ts            o total e os arquivos com mais textos fixos (sai 0)
//   bun scripts/i18n-check.ts --list F   cada texto fixo de um arquivo, com a linha
//
// O que conta: o texto entre as tags (`<p>Salvar</p>`) e as aspas dos atributos que aparecem (`label`, `hint`, `title`,
// `aria-label`, `placeholder`, `alt`), também num `{"…"}`, e as mesmas chaves num objeto (`{ label: "…" }`, as opções).
// Um texto sem letra (`·`, `›`, `%`) não conta. Ainda não conta: os textos dos `.ts` ao lado (`agentText.ts`).
//
// O main e o helper (T28192) também: no main (`src/bun`, a notificação do agente), o texto de um item de menu, de um
// diálogo (`label`, `title`, `message`, `detail`, `buttons`) e toda frase com acento, fora dos logs e dos erros; no
// helper Swift (`native/Sources`), o texto de um `Text(…)`, de um `label:`, de um `accessibilityLabel(…)` e toda
// frase com acento, fora dos logs. Os arquivos que já seguem o catálogo (`MIGRATED_MAIN`, todo o Swift na tela)
// barram. Um texto que não é da tela (uma lista de palavras, um rótulo da transcrição) leva `// i18n-ok: <motivo>`.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(import.meta.dir, "..");
const UI = path.join(ROOT, "ui");

/** As telas já no catálogo: um texto fixo aqui quebra o CI. Cada parte migrada entra na lista. */
export const MIGRATED = ["ui/settings/LanguageSection.tsx"];

/** O main e a notificação já no catálogo (T28192): menu, bandeja, status, diálogo do link, pílula e notificação. */
export const MIGRATED_MAIN = [
  "src/bun/menus.ts",
  "src/bun/session-status.ts",
  "src/bun/permissions.ts",
  "src/bun/dictation.ts",
  "src/bun/locale.ts",
  "src/bun/windows.ts",
  "src/bun/index.ts",
  "src/agent/notice.ts",
];
/** Todo o Swift do helper barra: as telas dele são poucas e já estão no `Localizable.xcstrings`. */
export const SWIFT_DIRS = ["../native/Sources/kiwi-helper", "../native/Sources/KiwiHelperCore"];

const VISIBLE_ATTRS = new Set(["label", "hint", "title", "aria-label", "placeholder", "alt", "caption", "description"]);
const hasLetter = (s: string) => /\p{L}/u.test(s);

export interface FixedText {
  line: number;
  text: string;
}

/** Os textos fixos de um .tsx. */
export function fixedTexts(file: string, source: string): FixedText[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: FixedText[] = [];
  const add = (node: ts.Node, text: string) => {
    const t = text.replace(/\s+/g, " ").trim();
    if (t && hasLetter(t)) out.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: t });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) add(node, node.text);
    else if (ts.isJsxAttribute(node) && VISIBLE_ATTRS.has(node.name.getText(sf)) && node.initializer) {
      const init = node.initializer;
      if (ts.isStringLiteral(init)) add(init, init.text);
      else if (ts.isJsxExpression(init) && init.expression && (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression))) {
        add(init.expression, init.expression.text);
      }
    } else if (ts.isPropertyAssignment(node) && VISIBLE_ATTRS.has(node.name.getText(sf).replace(/^["']|["']$/g, ""))) {
      // `{ value: "auto", label: "Automático" }`: as opções de um Segmented, de um menu.
      const e = node.initializer;
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) add(e, e.text);
    } else if (ts.isJsxExpression(node) && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) && node.expression) {
      const e = node.expression;
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) add(e, e.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}


// ---------------------------------------------------------------- O main (T28192)

const ACCENT = /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/;
const MAIN_PROPS = new Set(["label", "title", "message", "detail", "buttons"]);
/** As chamadas cujo texto é para o log, para o código ou para o agent control (depuração), nunca para a tela. */
const LOG_CALL = /(^|\.)(log|warn|error|info|debug|trace)$|^(Error|TypeError|RangeError|SidecarError)$|(^|\.)registerAction$/;

/** Os textos fixos de um .ts do main: os de menu e diálogo pela chave, e as frases com acento. */
export function mainFixedTexts(file: string, source: string): FixedText[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lines = source.split("\n");
  const out: FixedText[] = [];
  const inLog = (node: ts.Node): boolean => {
    for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
      if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && LOG_CALL.test(p.expression.getText(sf))) return true;
      if (ts.isThrowStatement(p) || ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p)) return true;
      if (ts.isCaseClause(p) && p.expression === node) return true;
    }
    return false;
  };
  const visibleProp = (node: ts.Node): boolean => {
    let p = node.parent;
    if (p && ts.isArrayLiteralExpression(p)) p = p.parent;
    return !!p && ts.isPropertyAssignment(p) && p.initializer !== node.parent?.parent && MAIN_PROPS.has(p.name.getText(sf).replace(/^["']|["']$/g, ""));
  };
  const visit = (node: ts.Node) => {
    let text: string | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateExpression(node)) text = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(" ");
    if (text !== null && hasLetter(text) && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const fixed = (ACCENT.test(text) || visibleProp(node)) && !inLog(node) && !/i18n-ok:/.test(lines[line - 1] ?? "");
      if (fixed) out.push({ line, text: text.replace(/\s+/g, " ").trim() });
    }
    if (!ts.isTemplateExpression(node)) ts.forEachChild(node, visit);
    else for (const span of node.templateSpans) visit(span.expression);
  };
  visit(sf);
  return out;
}

// ---------------------------------------------------------------- O helper Swift (T28192)

const SWIFT_VISIBLE = /(?:\bText|accessibilityLabel|help)\(\s*$|\b(?:label|title|placeholder):\s*$/;
const SWIFT_LOG = /\b(?:log|onLog|emit|print|NSLog|fputs|fatalError|precondition|assert|DispatchQueue)\s*\(/;

/** O código de uma linha do Swift, sem o comentário do fim (um `//` fora das aspas). */
function swiftCode(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") { i++; continue; }
    if (c === '"') inString = !inString;
    else if (!inString && c === "/" && line[i + 1] === "/") return line.slice(0, i);
  }
  return line;
}

/** Os textos fixos de um .swift: o de `Text(…)`, `label:`, `accessibilityLabel(…)` e as frases com acento. */
export function swiftFixedTexts(source: string): FixedText[] {
  const out: FixedText[] = [];
  source.split("\n").forEach((raw, i) => {
    if (/^\s*\/\//.test(raw) || /i18n-ok:/.test(raw)) return;
    const code = swiftCode(raw);
    if (SWIFT_LOG.test(code)) return;
    for (const m of code.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      const text = m[1]!.replace(/\\\([^)]*\)/g, " ");
      if (!hasLetter(text)) continue;
      const before = code.slice(0, m.index);
      if (ACCENT.test(text) || SWIFT_VISIBLE.test(before)) out.push({ line: i + 1, text: m[1]! });
    }
  });
  return out;
}

function filesUnder(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return filesUnder(p, ext);
    return name.endsWith(ext) && !name.includes(".test.") ? [p] : [];
  });
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return name === "node_modules" ? [] : tsxFiles(p);
    return name.endsWith(".tsx") && !name.endsWith(".test.tsx") ? [p] : [];
  });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const listAt = args.indexOf("--list");
  if (listAt >= 0) {
    const f = path.resolve(ROOT, args[listAt + 1] ?? "");
    for (const t of fixedTexts(f, readFileSync(f, "utf8"))) console.log(`${path.relative(ROOT, f)}:${t.line}  ${t.text}`);
    process.exit(0);
  }
  const counts = tsxFiles(UI)
    .map((f) => ({ file: path.relative(ROOT, f), texts: fixedTexts(f, readFileSync(f, "utf8")) }))
    .filter((r) => r.texts.length > 0)
    .sort((a, b) => b.texts.length - a.texts.length);
  const total = counts.reduce((n, r) => n + r.texts.length, 0);
  const broken = counts.filter((r) => MIGRATED.includes(r.file));
  console.log(`i18n: ${total} textos fixos em ${counts.length} telas (aviso; a migração é do spec #28171).`);
  for (const r of counts.slice(0, 15)) console.log(`  ${String(r.texts.length).padStart(4)}  ${r.file}`);
  if (counts.length > 15) console.log(`  … e mais ${counts.length - 15} telas. Um arquivo: bun scripts/i18n-check.ts --list <arquivo>`);
  if (process.env.GITHUB_ACTIONS) console.log(`::warning title=i18n::${total} textos fixos em ${counts.length} telas, fora do catálogo (spec #28171)`);
  // O main (T28192): avisa no resto de `src/bun`, barra nos migrados.
  const main = [...filesUnder(path.join(ROOT, "src/bun"), ".ts"), path.join(ROOT, "src/agent/notice.ts")]
    .map((f) => ({ file: path.relative(ROOT, f), texts: mainFixedTexts(f, readFileSync(f, "utf8")) }))
    .filter((r) => r.texts.length > 0);
  const mainTotal = main.reduce((n, r) => n + r.texts.length, 0);
  console.log(`i18n: ${mainTotal} textos fixos em ${main.length} arquivos do main (barra em ${MIGRATED_MAIN.length} já migrados).`);
  // O helper Swift (T28192): barra em tudo.
  const swift = SWIFT_DIRS.flatMap((d) => filesUnder(path.join(ROOT, d), ".swift"))
    .map((f) => ({ file: path.relative(ROOT, f), texts: swiftFixedTexts(readFileSync(f, "utf8")) }))
    .filter((r) => r.texts.length > 0);
  const failures = [...broken, ...main.filter((r) => MIGRATED_MAIN.includes(r.file)), ...swift];
  if (failures.length) {
    for (const r of failures) for (const t of r.texts) console.error(`✗ ${r.file}:${t.line} já está no catálogo e tem um texto fixo: ${t.text}`);
    process.exit(1);
  }
}
