// O código com cor nas Notas (spec #19277, T19312): a linguagem do CodeMirror de cada extensão de `CODE_TYPES`, e as
// cores do realce. Cada linguagem só carrega quando um arquivo dela abre (import dinâmico): o .py não traz o parser de
// TypeScript. JavaScript, TypeScript, CSS e HTML usam os parsers completos (`@codemirror/lang-*`); o resto, os modos
// do `@codemirror/legacy-modes` (MIT), que só pintam.
//
// As cores vêm do tema da pessoa (`--c-violet`, `--c-green`…, os tokens do Channels em `themes.ts`): cada tema, claro
// ou escuro, pinta o código na própria paleta.

import { HighlightStyle, type StreamParser, StreamLanguage } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";

export type LanguageLoader = () => Promise<Extension>;

const legacy =
  <T>(load: () => Promise<StreamParser<T>>): LanguageLoader =>
  async () =>
    StreamLanguage.define(await load());

const js = (o: { jsx?: boolean; typescript?: boolean } = {}): LanguageLoader => async () => (await import("@codemirror/lang-javascript")).javascript(o);
const css = (): LanguageLoader => async () => (await import("@codemirror/lang-css")).css();
const html = (): LanguageLoader => async () => (await import("@codemirror/lang-html")).html();

const python = legacy(async () => (await import("@codemirror/legacy-modes/mode/python")).python);
const shell = legacy(async () => (await import("@codemirror/legacy-modes/mode/shell")).shell);
const clike = (name: "c" | "cpp" | "java" | "kotlin" | "csharp" | "scala" | "dart") =>
  legacy(async () => (await import("@codemirror/legacy-modes/mode/clike"))[name]);
const properties = legacy(async () => (await import("@codemirror/legacy-modes/mode/properties")).properties);
const diff = legacy(async () => (await import("@codemirror/legacy-modes/mode/diff")).diff);
const dockerfile = legacy(async () => (await import("@codemirror/legacy-modes/mode/dockerfile")).dockerFile);

/** Por extensão, em minúsculas e sem o ponto: as mesmas de `CODE_TYPES`, e o json e o yaml, que já abriam sem cor. */
export const CODE_LANGUAGES: Record<string, LanguageLoader> = {
  py: python,
  js: js(),
  mjs: js(),
  cjs: js(),
  jsx: js({ jsx: true }),
  ts: js({ typescript: true }),
  mts: js({ typescript: true }),
  cts: js({ typescript: true }),
  tsx: js({ jsx: true, typescript: true }),
  css: css(),
  scss: legacy(async () => (await import("@codemirror/legacy-modes/mode/css")).sCSS),
  less: legacy(async () => (await import("@codemirror/legacy-modes/mode/css")).less),
  html: html(),
  htm: html(),
  xml: legacy(async () => (await import("@codemirror/legacy-modes/mode/xml")).xml),
  sql: legacy(async () => (await import("@codemirror/legacy-modes/mode/sql")).standardSQL),
  sh: shell,
  bash: shell,
  zsh: shell,
  swift: legacy(async () => (await import("@codemirror/legacy-modes/mode/swift")).swift),
  rb: legacy(async () => (await import("@codemirror/legacy-modes/mode/ruby")).ruby),
  go: legacy(async () => (await import("@codemirror/legacy-modes/mode/go")).go),
  rs: legacy(async () => (await import("@codemirror/legacy-modes/mode/rust")).rust),
  c: clike("c"),
  h: clike("c"),
  cpp: clike("cpp"),
  cc: clike("cpp"),
  hpp: clike("cpp"),
  java: clike("java"),
  kt: clike("kotlin"),
  kts: clike("kotlin"),
  cs: clike("csharp"),
  scala: clike("scala"),
  dart: clike("dart"),
  lua: legacy(async () => (await import("@codemirror/legacy-modes/mode/lua")).lua),
  r: legacy(async () => (await import("@codemirror/legacy-modes/mode/r")).r),
  pl: legacy(async () => (await import("@codemirror/legacy-modes/mode/perl")).perl),
  ps1: legacy(async () => (await import("@codemirror/legacy-modes/mode/powershell")).powerShell),
  toml: legacy(async () => (await import("@codemirror/legacy-modes/mode/toml")).toml),
  tex: legacy(async () => (await import("@codemirror/legacy-modes/mode/stex")).stex),
  ini: properties,
  cfg: properties,
  env: properties,
  conf: properties,
  properties,
  proto: legacy(async () => (await import("@codemirror/legacy-modes/mode/protobuf")).protobuf),
  diff,
  patch: diff,
  dockerfile,
  // O legacy-modes não tem modo de Make (o `cmake` é do CMake): o do shell pinta o comentário, o `$(VAR)` e as receitas.
  mk: shell,
  json: legacy(async () => (await import("@codemirror/legacy-modes/mode/javascript")).json),
  yaml: legacy(async () => (await import("@codemirror/legacy-modes/mode/yaml")).yaml),
  yml: legacy(async () => (await import("@codemirror/legacy-modes/mode/yaml")).yaml),
};

/** O código que abre editável sem cor: o legacy-modes não tem modo de PHP. */
export const CODE_WITHOUT_COLOR: ReadonlySet<string> = new Set(["php"]);

/** Pelo nome inteiro, os arquivos que não têm extensão (T19313). O `Dockerfile.dev` conta como `Dockerfile`. */
const NAME_LANGUAGES: Record<string, LanguageLoader> = { dockerfile, containerfile: dockerfile, makefile: shell, gnumakefile: shell };

const extOf = (name: string) => /\.([a-z0-9]+)$/i.exec(name.split("/").at(-1) ?? "")?.[1]?.toLowerCase();

/** A linguagem de um arquivo pelo nome, ou `undefined` (o .txt e o .log seguem sem cor, e o .php também). */
export function codeLanguageFor(name: string): LanguageLoader | undefined {
  const base = (name.split("/").at(-1) ?? "").toLowerCase();
  const ext = extOf(name);
  const byExt = ext ? CODE_LANGUAGES[ext] : undefined;
  return NAME_LANGUAGES[base] ?? byExt ?? (base.startsWith("dockerfile.") ? dockerfile : undefined);
}

/** É código (os números de linha e o menu sem Markdown): tem cor, ou é de `CODE_TYPES` mesmo sem ela (o .php). */
export const isCodeFile = (name: string): boolean => codeLanguageFor(name) !== undefined || CODE_WITHOUT_COLOR.has(extOf(name) ?? "");

/** As cores do código, na paleta do tema. Sem fundo nem negrito pesado: a cor sozinha separa as partes. */
export const codeHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.modifier], color: "var(--c-violet, #7a4fd6)" },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], color: "var(--c-green, #1f9a55)" },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit], color: "var(--c-orange, #c75a00)" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: "var(--ink-3, var(--text-3))", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))], color: "var(--c-blue, #2f6fe4)" },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.variableName)], color: "var(--c-teal, #0f8a78)" },
  { tag: [t.tagName, t.heading], color: "var(--c-pink, #c2386f)" },
  { tag: [t.attributeName, t.propertyName, t.labelName], color: "var(--c-indigo, #4a55d6)" },
  { tag: [t.meta, t.processingInstruction, t.annotation], color: "var(--ink-3, var(--text-3))" },
  { tag: [t.inserted], color: "var(--c-green, #1f9a55)" },
  { tag: [t.deleted, t.invalid], color: "var(--c-red, #d1342a)" },
]);
