// T5558: original Kiwi syntax for ==highlight==; ordinary Markdown escaping and code parsing still apply.
import type { MarkdownConfig } from "@lezer/markdown";
export const HIGHLIGHT_BACKGROUND = "color-mix(in srgb, #f6c945 32%, transparent)";
const delimiter = { resolve: "Highlight", mark: "HighlightMark" };
export const highlightSyntax: MarkdownConfig = {
  defineNodes: ["Highlight", "HighlightMark"],
  parseInline: [{ name: "Highlight", after: "Emphasis", parse(cx, next, pos) {
    if (next !== 61 || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61 || cx.char(pos - 1) === 61) return -1;
    const before = cx.slice(pos - 1, pos), after = cx.slice(pos + 2, pos + 3);
    return cx.addDelimiter(delimiter, pos, pos + 2, !!after && !/\s/.test(after), !!before && !/\s/.test(before));
  } }],
};
