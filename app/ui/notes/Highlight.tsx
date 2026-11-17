// As letras que casaram com a busca, destacadas (T2966, spec #2934): no ⌘K e na busca da árvore.

import type { Range } from "../../src/shared/fuzzy.ts";

export function Highlight({ text, ranges }: { text: string; ranges: readonly Range[] }) {
  if (!ranges.length) return <>{text}</>;
  const out: (string | React.ReactElement)[] = [];
  let at = 0;
  for (const [from, to] of ranges) {
    if (from > at) out.push(text.slice(at, from));
    out.push(
      <mark key={from} className="kn-hit">
        {text.slice(from, to)}
      </mark>,
    );
    at = to;
  }
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}
