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

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(import.meta.dir, "..");
const UI = path.join(ROOT, "ui");

/** As telas já no catálogo: um texto fixo aqui quebra o CI. Cada parte migrada entra na lista. */
export const MIGRATED = ["ui/settings/LanguageSection.tsx"];

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
  if (broken.length) {
    for (const r of broken) for (const t of r.texts) console.error(`✗ ${r.file}:${t.line} já está no catálogo e tem um texto fixo: ${t.text}`);
    process.exit(1);
  }
}
