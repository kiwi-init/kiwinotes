// T6014: original Kiwi Markdown structure shared by refactors and the editor. Offsets always refer to source.
import { parser, GFM } from "@lezer/markdown";
const markdown = parser.configure(GFM);
export interface TextEdit {
    from: number;
    to: number;
    insert: string;
}
export interface NoteHeading {
    from: number;
    to: number;
    textFrom: number;
    textTo: number;
    level: number;
    title: string;
    slug: string;
}
const normalize = (text: string) => text.normalize("NFC").toLocaleLowerCase("pt-BR");
export function headingSlug(text: string): string { return normalize(text).replace(/[^\p{L}\p{N}_\-\s]/gu, "").trim().replace(/\s+/g, "-"); }
export function headingKey(text: string): string { try {
    text = decodeURIComponent(text);
}
catch { } return normalize(text.replace(/^#/, "").trim()); }
export function headingFor(headings: readonly NoteHeading[], fragment: string): NoteHeading | undefined {
    const key = headingKey(fragment);
    return headings.find(h => normalize(h.title) === key || h.slug === key);
}
export function applyTextEdits(text: string, edits: TextEdit[]): string {
    let limit = text.length;
    for (const edit of [...edits].sort((a, b) => b.from - a.from)) {
        if (edit.from < 0 || edit.to > limit || edit.from > edit.to)
            throw new Error("overlapping text edits");
        text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
        limit = edit.from;
    }
    return text;
}
function mergeRanges(ranges: {
    from: number;
    to: number;
}[]) {
    const out: {
        from: number;
        to: number;
    }[] = [];
    for (const r of ranges.sort((a, b) => a.from - b.from || b.to - a.to)) {
        const last = out.at(-1);
        if (last && r.from <= last.to)
            last.to = Math.max(last.to, r.to);
        else
            out.push({ ...r });
    }
    return out;
}
function contains(ranges: {
    from: number;
    to: number;
}[], pos: number) {
    let low = 0, high = ranges.length;
    while (low < high) {
        const mid = (low + high) >>> 1;
        if (ranges[mid]!.from <= pos)
            low = mid + 1;
        else
            high = mid;
    }
    return low > 0 && pos < ranges[low - 1]!.to;
}
function plainTitle(raw: string) {
    return raw.replace(/!?(?:\[\[([^\]|]+)(?:\|([^\]]+))?\]\])/g, (_m, target, alias) => alias ?? target)
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/<[^>]*>/g, "")
        .replace(/`+([^`]+)`+/g, "$1").replace(/(\*\*|__|~~|==)(.*?)\1/g, "$2")
        .replace(/(?<!\w)(\*|_)([^\n]+?)\1(?!\w)/g, "$2").replace(/\\([\\`*_[\]#~])/g, "$1")
        .replace(/\s+/g, " ").trim();
}
export function markdownStructure(content: string) {
    const fm = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
    const frontmatterEnd = fm?.[0].length ?? 0;
    const tree = markdown.parse(content.slice(0, frontmatterEnd).replace(/[^\r\n]/g, " ") + content.slice(frontmatterEnd));
    const excluded: {
        from: number;
        to: number;
    }[] = frontmatterEnd ? [{ from: 0, to: frontmatterEnd }] : [];
    tree.iterate({ enter(node) {
            if (["InlineCode", "FencedCode", "CodeBlock", "HTMLBlock", "HTMLTag", "Comment", "CommentBlock"].includes(node.name)) {
                excluded.push({ from: node.from, to: node.to });
                return false;
            }
        } });
    const code = mergeRanges(excluded);
    let comment: number | undefined;
    for (const m of content.matchAll(/%%/g)) {
        if (comment !== undefined) {
            excluded.push({ from: comment, to: m.index! + 2 });
            comment = undefined;
        }
        else if (!contains(code, m.index!))
            comment = m.index!;
    }
    if (comment !== undefined)
        excluded.push({ from: comment, to: content.length });
    const ranges = mergeRanges(excluded);
    const prose = (pos: number) => !contains(ranges, pos);
    const headings: NoteHeading[] = [];
    tree.iterate({ enter(node) {
            const match = /^(ATX|Setext)Heading([1-6])$/.exec(node.name);
            if (!match || !prose(node.from))
                return;
            const raw = content.slice(node.from, node.to);
            let from = node.from, to = node.to;
            if (match[1] === "ATX") {
                from += /^[ \t]*#{1,6}[ \t]*/.exec(raw)![0].length;
                const suffix = /[ \t]+#+[ \t]*$/.exec(raw);
                to = suffix ? node.from + suffix.index : node.to - (/[ \t\r]*$/.exec(raw)![0].length);
            }
            else {
                const underline = /(?:\r?\n)[ \t]*[=-]+[ \t]*\r?$/.exec(raw);
                if (!underline)
                    return;
                to = node.from + underline.index;
            }
            const title = plainTitle(content.slice(from, to));
            headings.push({ from: node.from, to: node.to, textFrom: from, textTo: to, level: Number(match[2]), title, slug: headingSlug(title) });
        } });
    return { tree, headings, prose, frontmatterEnd };
}
