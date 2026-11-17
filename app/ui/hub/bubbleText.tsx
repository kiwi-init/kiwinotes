// O texto do agente no balão (spec #9495): sempre como texto, nunca como HTML. A marcação simples aparece legível:
// **negrito**, `código`, blocos ``` e listas com "- " ou "1. ". Uma marcação pela metade (um ** sem par, um ``` sem
// fim) fica como está, em texto. Nada aqui usa innerHTML: o React escapa tudo.

import type { ReactNode } from "react";

/** O negrito e o código de uma linha. */
function inline(line: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*\n]+?)\*\*|`([^`\n]+?)`/g;
  let at = 0;
  let n = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > at) out.push(line.slice(at, m.index));
    out.push(m[1] !== undefined ? <strong key={`${key}b${n++}`}>{m[1]}</strong> : <code key={`${key}c${n++}`}>{m[2]}</code>);
    at = m.index + m[0].length;
  }
  if (at < line.length) out.push(line.slice(at));
  return out;
}

/** O texto do agente em elementos do React (texto escapado), com a marcação simples. */
export function renderLite(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trimStart().startsWith("```")) {
      const end = lines.findIndex((l, j) => j > i && l.trimStart().startsWith("```"));
      if (end > i) {
        out.push(<pre key={`p${i}`} className="kn-bubble-pre">{lines.slice(i + 1, end).join("\n")}</pre>);
        i = end;
        continue;
      }
    }
    const item = /^\s*(?:[-*•]|\d+[.)])\s+/.exec(line);
    if (item) {
      out.push(
        <span key={`l${i}`} className="kn-bubble-li">
          <span className="kn-bubble-mark">{item[0].trim().replace(/^[-*]$/, "•")}</span> {inline(line.slice(item[0].length), `l${i}`)}
        </span>,
      );
      continue;
    }
    out.push(<span key={`t${i}`} className="kn-bubble-line">{inline(line, `t${i}`)}</span>);
  }
  return out;
}
