// O recuo de um arquivo de texto ou de código (T19403, da revisão do T19312): o Tab recua como o arquivo já recua. Um
// .py recuado com 4 espaços que ganhasse 2 no Tab quebraria (IndentationError).
//
// A regra: conta as linhas que começam com tab e as que começam com espaço. Ganha o tab se for a maioria. Senão, o passo
// é o aumento de recuo mais comum entre uma linha e a seguinte (de 2 a 8). Sem nada recuado, 4 no .py e 2 no resto.
// As linhas de comentário de bloco (` * …`) ficam de fora: o espaço antes do `*` não é recuo.

export type Indent = { unit: string; tabSize: number };

const MAX_LINES = 2000;

export function detectIndent(text: string, name = ""): Indent {
  const ext = /\.([a-z0-9]+)$/i.exec(name.split("/").at(-1) ?? "")?.[1]?.toLowerCase();
  const fallback = ext === "py" ? 4 : 2;
  let tabs = 0;
  let spaced = 0;
  const steps = new Map<number, number>();
  let prev = 0;
  const lines = text.split("\n", MAX_LINES);
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim()) continue;
    const lead = /^[ \t]*/.exec(line)![0];
    if (line.slice(lead.length).startsWith("*")) continue;
    if (lead.startsWith("\t")) {
      tabs++;
      continue;
    }
    const n = lead.length;
    if (n > 0) spaced++;
    const step = n - prev;
    if (step >= 2 && step <= 8) steps.set(step, (steps.get(step) ?? 0) + 1);
    prev = n;
  }
  if (tabs > spaced) return { unit: "\t", tabSize: 4 };
  let best = 0;
  let count = 0;
  for (const [step, c] of steps) if (c > count || (c === count && step < best)) [best, count] = [step, c];
  const size = best || fallback;
  return { unit: " ".repeat(size), tabSize: size };
}
