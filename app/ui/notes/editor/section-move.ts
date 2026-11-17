import { markdownStructure } from "../../../src/shared/markdown-structure.ts";

export function moveSection(content: string, headingFrom: number, direction: "up" | "down"): string {
  const headings = markdownStructure(content).headings.filter(heading =>
    /^[ \t]*$/.test(content.slice(content.lastIndexOf("\n", heading.from - 1) + 1, heading.from))
  );
  const index = headings.findIndex(heading => heading.from === headingFrom);
  if (index < 0) return content;
  const heading = headings[index]!;
  let previous = -1;
  for (let i = index - 1; i >= 0; i--) {
    if (headings[i]!.level < heading.level) break;
    if (headings[i]!.level === heading.level) {
      previous = i;
      break;
    }
  }
  let next = index + 1;
  while (next < headings.length && headings[next]!.level > heading.level) next++;
  const sibling = direction === "up" ? previous : next < headings.length && headings[next]!.level === heading.level ? next : -1;
  if (sibling < 0) return content;
  const first = Math.min(index, sibling);
  const second = Math.max(index, sibling);
  let end = second + 1;
  while (end < headings.length && headings[end]!.level > heading.level) end++;
  const lineStart = (from: number): number => content.lastIndexOf("\n", from - 1) + 1;
  const start = lineStart(headings[first]!.from);
  const middle = lineStart(headings[second]!.from);
  const finish = end < headings.length ? lineStart(headings[end]!.from) : content.length;
  let left = content.slice(start, middle);
  let right = content.slice(middle, finish);
  if (finish === content.length) {
    const leftNewlines = /(?:\r?\n)+$/.exec(left)?.[0] ?? "";
    const rightNewlines = /(?:\r?\n)+$/.exec(right)?.[0] ?? "";
    left = left.slice(0, left.length - leftNewlines.length) + rightNewlines;
    right = right.slice(0, right.length - rightNewlines.length) + leftNewlines;
  }
  return content.slice(0, start) + right + left + content.slice(finish);
}
