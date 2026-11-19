// A fórmula como a pessoa digita e lê (o Excel em português: `=SOMA(C2:C9;2,5)`) e como o arquivo grava (o inglês, sem
// o "=": `SUM(C2:C9,2.5)`). T21108, spec #21065 parte 3. Leve, sem o motor: só o dicionário de funções em português do
// HyperFormula, que tem os nomes do Excel brasileiro (PROCV, CONT.SE, NÚM.CARACT, ARRUMAR).
//
// O que muda: o nome da função, VERDADEIRO/FALSO, o separador de argumentos (`;` ↔ `,`) e a vírgula decimal dentro de
// um número. O texto entre aspas, o nome de aba entre apóstrofos e as referências passam iguais.

import ptPT from "hyperformula/i18n/languages/ptPT";

const PT: Record<string, string> = (ptPT as unknown as { functions: Record<string, string> }).functions;
const TO_EN = new Map(Object.entries(PT).map(([en, pt]) => [pt.toUpperCase(), en]));
const TO_PT = new Map(Object.entries(PT).map(([en, pt]) => [en.toUpperCase(), pt]));
const BOOL_EN: Record<string, string> = { VERDADEIRO: "TRUE", FALSO: "FALSE" };
const BOOL_PT: Record<string, string> = { TRUE: "VERDADEIRO", FALSE: "FALSO" };

/** As funções que o Excel grava com o prefixo `_xlfn.` (as que vieram depois do Excel 2007). */
const XLFN = new Set(
  "XLOOKUP XMATCH IFS SWITCH MAXIFS MINIFS CONCAT TEXTJOIN IFNA FILTER SORT SORTBY UNIQUE SEQUENCE RANDARRAY LET XOR DAYS ISOWEEKNUM STDEV.S STDEV.P VAR.S VAR.P FLOOR.MATH CEILING.MATH".split(" "),
);

type Token = { kind: "text" | "name" | "number" | "sep" | "other"; s: string };

const NAME = /[A-Za-zÀ-ÿ_\\][A-Za-z0-9À-ÿ_.]*/y;

function tokens(f: string, decimal: "," | "."): Token[] {
  const out: Token[] = [];
  const number = decimal === "," ? /\d+(?:,\d+)?(?:[eE][+-]?\d+)?/y : /\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  let i = 0;
  while (i < f.length) {
    const ch = f[i]!;
    if (ch === '"' || ch === "'") {
      // Texto ou nome de aba: até a aspa que fecha (a dobrada é a aspa escapada).
      let j = i + 1;
      while (j < f.length && !(f[j] === ch && f[j + 1] !== ch)) j += f[j] === ch ? 2 : 1;
      out.push({ kind: "text", s: f.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    let matched = false;
    for (const [re, kind] of [[NAME, "name"], [number, "number"]] as const) {
      re.lastIndex = i;
      const m = re.exec(f);
      if (m) {
        out.push({ kind, s: m[0] });
        i += m[0].length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    out.push({ kind: ch === (decimal === "," ? ";" : ",") ? "sep" : "other", s: ch });
    i++;
  }
  return out;
}

/** O que vem depois de um nome, sem os espaços: `(` é função; `!` é nome de aba. */
const nextChar = (ts: Token[], k: number) => {
  for (let j = k + 1; j < ts.length; j++) if (ts[j]!.s.trim()) return ts[j]!.s[0];
  return "";
};

/** O que a pessoa digitou (com ou sem o "=") para a fórmula do arquivo: em inglês e sem o "=". */
export function toEnglish(typed: string): string {
  const ts = tokens(typed.replace(/^\s*=/, ""), ",");
  return ts
    .map((t, k) => {
      if (t.kind === "sep") return ",";
      if (t.kind === "number") return t.s.replace(",", ".");
      if (t.kind !== "name") return t.s;
      const up = t.s.toUpperCase();
      const next = nextChar(ts, k);
      if (next === "(") {
        const en = TO_EN.get(up) ?? (TO_PT.has(up) ? up : null);
        if (!en) return t.s;
        return XLFN.has(en) ? `_xlfn.${en}` : en;
      }
      return next !== "!" && BOOL_EN[up] ? BOOL_EN[up] : t.s;
    })
    .join("");
}

/** A fórmula do arquivo (em inglês, sem o "=") como a pessoa lê, com o "=". */
export function toPtBr(formula: string): string {
  const ts = tokens(formula.replace(/^\s*=/, ""), ".");
  const body = ts
    .map((t, k) => {
      if (t.kind === "sep") return ";";
      if (t.kind === "number") return t.s.replace(".", ",");
      if (t.kind !== "name") return t.s;
      const up = t.s.toUpperCase().replace(/^_XL(?:FN|WS)\./, "");
      const next = nextChar(ts, k);
      if (next === "(") return TO_PT.get(up) ?? t.s.replace(/^_xl(?:fn|ws)\./i, "");
      return next !== "!" && BOOL_PT[up] ? BOOL_PT[up] : t.s;
    })
    .join("");
  return `=${body}`;
}
