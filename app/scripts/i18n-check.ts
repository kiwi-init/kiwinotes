// Os textos fixos (spec #28171): todo texto visível escrito direto no código, fora do catálogo (`src/shared/i18n/`).
// Barra em todo arquivo da tela e do main (T30630): um texto novo fora do catálogo quebra o CI.
//
//   bun scripts/i18n-check.ts            os textos fixos que sobraram, com o arquivo e a linha (sai 1 se houver)
//   bun scripts/i18n-check.ts --list F   cada texto fixo de um arquivo, com a linha (sai 0)
//
// O que conta, em todo `.tsx` da UI: o texto entre as tags (`<p>Salvar</p>`) e as aspas dos atributos que aparecem
// (`label`, `hint`, `title`, `aria-label`, `placeholder`, `alt`), também num `{"…"}`, e as mesmas chaves num objeto
// (`{ label: "…" }`, as opções). Em todo `.ts` e `.tsx` da UI e do main (`src/bun`, a notificação do agente, as frases
// do Info.plist): o texto de um item de menu, de um diálogo (`label`, `title`, `message`, `detail`, `buttons`) e toda
// frase com acento, também a que está num ternário ou numa variável, fora dos logs e dos erros. No helper Swift
// (`native/Sources`): o texto de um `Text(…)`, de um `label:`, de um `accessibilityLabel(…)` e toda frase com acento,
// fora dos logs. Um texto sem letra (`·`, `›`, `%`) não conta, nem uma chave do catálogo (`"editor.menu.cut"`).
//
// O nome do mascote (spec #31199): na tela ele é o Kiwi, e o app é o Kiwi Notes. Um texto do catálogo com "gato",
// "cat" ou "Kiwi Cat" também barra.
//
// O falso positivo (um nome próprio, um log, uma lista de palavras da busca) leva `// i18n-ok: <motivo>` na linha. Um
// arquivo que já traz as duas línguas lado a lado (o `showcaseText.ts`) leva `// i18n-ok-file: <motivo>` no começo.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

import { en } from "../src/shared/i18n/en.ts";
import { pt } from "../src/shared/i18n/pt.ts";

// `KIWI_I18N_ROOT`: só o teste, que roda o check numa árvore falsa para provar o `exit 1`.
const ROOT = process.env.KIWI_I18N_ROOT ?? path.resolve(import.meta.dir, "..");

/** O main que o check lê: todo o `src/bun` e os arquivos de fora dele que escrevem na tela ou no pedido do macOS. */
export const MAIN_DIRS = ["src/bun"];
export const MAIN_FILES = ["src/agent/notice.ts", "scripts/info-plist.ts", "scripts/app-plist.ts", "scripts/usage-strings.ts"];
/** O Swift do helper: as telas dele são poucas e já estão no `Localizable.xcstrings`. */
export const SWIFT_DIRS = ["../native/Sources/kiwi-helper", "../native/Sources/KiwiHelperCore"];

const VISIBLE_ATTRS = new Set(["label", "hint", "title", "aria-label", "placeholder", "alt", "caption", "description"]);
const hasLetter = (s: string) => /\p{L}/u.test(s);

/** As linhas liberadas: a que tem `// i18n-ok: <motivo>`, e a de baixo quando o comentário está sozinho na linha. */
function okLines(source: string): Set<number> {
  const ok = new Set<number>();
  source.split("\n").forEach((l, i) => {
    if (!/\/\/\s*i18n-ok:/.test(l)) return;
    ok.add(i + 1);
    if (/^\s*\/\/\s*i18n-ok:/.test(l)) ok.add(i + 2);
  });
  return ok;
}

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
  visit(sf);
  // Um nome próprio (a fonte "Inter", um tema) leva `// i18n-ok: <motivo>` na linha, como no main.
  const ok = okLines(source);
  return out.filter((t) => !ok.has(t.line));

  function visit(node: ts.Node) {
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
  }
}


// ---------------------------------------------------------------- O main (T28192)

const ACCENT = /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/;
const MAIN_PROPS = new Set(["label", "title", "message", "detail", "buttons"]);
/** As chamadas cujo texto é para o log, para o código ou para o agent control (depuração), nunca para a tela. */
const LOG_CALL = /(^|\.)(log|warn|error|info|debug|trace)$|^\w*Error$|(^|\.)registerAction$/;

/** Os textos fixos de um .ts do main: os de menu e diálogo pela chave, e as frases com acento. */
export function mainFixedTexts(file: string, source: string): FixedText[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const ok = okLines(source);
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
    if (text !== null && hasLetter(text) && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node) && !Object.hasOwn(pt, text)) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const fixed = (ACCENT.test(text) || visibleProp(node)) && !inLog(node) && !ok.has(line);
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

/** Um arquivo com as duas línguas lado a lado: `// i18n-ok-file: <motivo>` nas primeiras linhas. */
const okFile = (source: string) => /^(?:\s*\/\/.*\n|\s*\n)*\s*\/\/\s*i18n-ok-file:\s*\S/.test(source);

/** Os textos fixos de um arquivo da tela ou do main: no `.tsx`, as duas réguas juntas, sem repetir a mesma linha. */
export function fileTexts(file: string, source: string): FixedText[] {
  if (okFile(source)) return [];
  const texts = file.endsWith(".tsx") ? [...fixedTexts(file, source), ...mainFixedTexts(file, source)] : mainFixedTexts(file, source);
  const seen = new Set<string>();
  return texts
    .filter((t) => !seen.has(`${t.line}\u0000${t.text}`) && !!seen.add(`${t.line}\u0000${t.text}`))
    .sort((x, y) => x.line - y.line);
}

function filesUnder(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return name === "node_modules" ? [] : filesUnder(p, ext);
    return name.endsWith(ext) && !name.includes(".test.") && !name.endsWith(".d.ts") ? [p] : [];
  });
}

/** O que o mascote não se chama na tela (spec #31199): em pt, "gato" e afins; em en, "cat"; nas duas, "Kiwi Cat". */
// As bordas são de letra Unicode, não o \b: com o \b, o "á" de "catálogo" deixaria o "cat" sozinho.
export const NOT_MASCOT_NAME = {
  pt: /(?<!\p{L})gat(?:[oa]s?|inh[oa]s?)(?!\p{L})|Kiwi[ -]?Cat/iu,
  en: /(?<!\p{L})(?:cats?|kitt(?:y|ies|ens?))(?!\p{L})|Kiwi[ -]?Cat/iu,
} as const;

/** Os textos de um catálogo que chamam o mascote de gato (os plurais `{ one, other }` contam cada forma). */
export function mascotNameHits(catalog: Record<string, unknown>, lang: keyof typeof NOT_MASCOT_NAME): { key: string; text: string }[] {
  const texts = (v: unknown): string[] => (typeof v === "string" ? [v] : v && typeof v === "object" ? Object.values(v).flatMap(texts) : []);
  return Object.entries(catalog).flatMap(([key, v]) => texts(v).filter((text) => NOT_MASCOT_NAME[lang].test(text)).map((text) => ({ key, text })));
}

/** O texto fixo de uma página (`ui/<janela>/index.html`) que chama o mascote de gato: o texto entre as tags e os
 *  atributos que a tela mostra ou lê em voz alta (`title`, `aria-label`, `alt`, `placeholder`), fora de script e style. */
export function htmlMascotHits(html: string): string[] {
  const bare = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  const attrs = [...bare.matchAll(/\b(?:title|aria-label|alt|placeholder)="([^"]*)"/gi)].map((m) => m[1]!);
  const text = [...bare.matchAll(/>([^<]+)</g)].map((m) => m[1]!.trim()).filter(Boolean);
  return [...attrs, ...text].filter((t) => NOT_MASCOT_NAME.pt.test(t) || NOT_MASCOT_NAME.en.test(t));
}

/** Os arquivos da tela e do main que o check lê, relativos a `root`. */
export function checkedFiles(root: string): string[] {
  const under = (d: string) => [...filesUnder(path.join(root, d), ".ts"), ...filesUnder(path.join(root, d), ".tsx")];
  return [...under("ui"), ...MAIN_DIRS.flatMap(under), ...MAIN_FILES.map((f) => path.join(root, f))].map((f) => path.relative(root, f)).sort();
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const listAt = args.indexOf("--list");
  if (listAt >= 0) {
    const f = path.resolve(ROOT, args[listAt + 1] ?? "");
    const source = readFileSync(f, "utf8");
    const texts = f.endsWith(".swift") ? swiftFixedTexts(source) : fileTexts(f, source);
    for (const t of texts) console.log(`${path.relative(ROOT, f)}:${t.line}  ${t.text}`);
    process.exit(0);
  }
  const app = checkedFiles(ROOT).map((file) => ({ file, texts: fileTexts(file, readFileSync(path.join(ROOT, file), "utf8")) }));
  const swift = SWIFT_DIRS.flatMap((d) => filesUnder(path.join(ROOT, d), ".swift")).map((f) => ({ file: path.relative(ROOT, f), texts: swiftFixedTexts(readFileSync(f, "utf8")) }));
  const failures = [...app, ...swift].filter((r) => r.texts.length > 0);
  const mascot = [...mascotNameHits(pt, "pt").map((h) => ({ ...h, lang: "pt" })), ...mascotNameHits(en, "en").map((h) => ({ ...h, lang: "en" }))];
  for (const f of filesUnder(path.join(ROOT, "ui"), ".html")) {
    for (const text of htmlMascotHits(readFileSync(f, "utf8"))) mascot.push({ lang: "html", key: path.relative(ROOT, f), text });
  }
  for (const h of mascot) console.error(`✗ ${h.lang} ${h.key}: o mascote se chama Kiwi na tela, não gato nem cat (spec #31199): ${h.text}`);
  console.log(`i18n: ${app.length} arquivos da tela e do main e ${swift.length} do helper lidos; ${failures.length} com texto fixo.`);
  if (mascot.length) process.exitCode = 1;
  if (failures.length) {
    for (const r of failures) for (const t of r.texts) console.error(`✗ ${r.file}:${t.line} texto fixo fora do catálogo: ${t.text}`);
    console.error("Ponha o texto no catálogo (src/shared/i18n/) e use o t(); um falso positivo leva // i18n-ok: <motivo> na linha.");
    process.exit(1);
  }
}
