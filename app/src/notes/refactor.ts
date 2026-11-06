// T6014: original Kiwi refactoring. Foam is a behavior reference; no Foam code or telemetry is included.
import { isMap, isScalar, isSeq, parseDocument, type Scalar } from "yaml";
import { applyTextEdits, headingFor, markdownStructure, type NoteHeading, type TextEdit } from "../shared/markdown-structure.ts";
import { cleanTag, tagKey, tagsInLine } from "../shared/tags.ts";
import { noteName, type Resolver } from "../shared/wikilinks.ts";
export interface LinkWarning {
    path: string;
    target: string;
    reason: "note" | "heading";
    line: number;
}
export interface RefactorResult {
    updatedNotes: number;
    updatedReferences: number;
    skippedPaths: string[];
    warnings: LinkWarning[];
}
interface Reference {
    from: number;
    to: number;
    target: string;
    fragment: string;
    fragmentFrom: number;
    fragmentTo: number;
    kind: "wiki" | "markdown";
    targetFrom: number;
    targetTo: number;
}
export function noteReferences(content: string): Reference[] {
    const context = markdownStructure(content), out: Reference[] = [];
    for (const m of content.matchAll(/(!?)\[\[([^\[\]\n|]*)(\|[^\]\n]*)?\]\]/g)) {
        const escaped = (/\\+$/.exec(content.slice(0, m.index!))?.[0].length ?? 0) % 2 === 1;
        if (!context.prose(m.index!) || escaped)
            continue;
        const raw = m[2]!, hash = raw.indexOf("#"), start = m.index! + m[1]!.length + 2;
        const target = (hash < 0 ? raw : raw.slice(0, hash)).trim(), fragment = hash < 0 ? "" : raw.slice(hash + 1);
        if (!target && !fragment)
            continue;
        out.push({ from: m.index!, to: m.index! + m[0].length, target, fragment, fragmentFrom: hash < 0 ? start + raw.length : start + hash + 1, fragmentTo: start + raw.length, kind: "wiki", targetFrom: start, targetTo: hash < 0 ? start + raw.length : start + hash });
    }
    context.tree.iterate({ enter(node) {
            if (!["Link", "LinkReference"].includes(node.name) || !context.prose(node.from))
                return;
            const url = node.node.getChild("URL");
            if (!url)
                return;
            let from = url.from, to = url.to, raw = content.slice(from, to);
            if (raw.startsWith("<") && raw.endsWith(">")) {
                from++;
                to--;
                raw = raw.slice(1, -1);
            }
            if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(raw))
                return;
            const hash = raw.indexOf("#"), path = hash < 0 ? raw : raw.slice(0, hash);
            let target: string;
            try {
                target = decodeURIComponent(path);
            }
            catch {
                return;
            }
            if (target && /\.[^/]+$/.test(target) && !target.toLowerCase().endsWith(".md"))
                return;
            if (!target && hash < 0)
                return;
            out.push({ from: node.from, to: node.to, target, fragment: hash < 0 ? "" : raw.slice(hash + 1), fragmentFrom: hash < 0 ? to : from + hash + 1, fragmentTo: to, kind: "markdown", targetFrom: from, targetTo: hash < 0 ? to : from + hash });
            return false;
        } });
    return out.sort((a, b) => a.from - b.from);
}
export function referenceTarget(ref: Reference, source: string, resolve: Resolver): string | null {
    if (!ref.target)
        return source;
    if (ref.kind === "wiki")
        return resolve(ref.target);
    const parts = ref.target.startsWith("/") ? [] : source.split("/").slice(0, -1);
    for (const part of ref.target.split("/")) {
        if (!part || part === ".")
            continue;
        if (part === "..") {
            if (!parts.length)
                return null;
            parts.pop();
        }
        else
            parts.push(part);
    }
    const joined = parts.join("/"), resolved = resolve(joined);
    const key = (s: string) => s.replace(/\.md$/i, "").normalize("NFC").toLowerCase();
    return resolved && key(resolved) === key(joined) ? resolved : null;
}
export function rewriteHeadingReferences(content: string, source: string, target: string, selected: NoteHeading, oldHeadings: NoteHeading[], newTitle: string, resolve: Resolver) {
    const edits: TextEdit[] = [];
    for (const ref of noteReferences(content)) {
        if (!ref.fragment || referenceTarget(ref, source, resolve) !== target || headingFor(oldHeadings, ref.fragment)?.from !== selected.from)
            continue;
        edits.push({ from: ref.fragmentFrom, to: ref.fragmentTo, insert: ref.kind === "wiki" ? newTitle : encodeURIComponent(newTitle) });
    }
    return { content: applyTextEdits(content, edits), count: edits.length };
}
/** File title renames also preserve standard relative Markdown links and leave code/comments untouched. */
export function rewriteNoteReferences(content: string, sourceBefore: string, sourceAfter: string, from: string, to: string, before: Resolver, after: Resolver) {
    const edits: TextEdit[] = [];
    for (const ref of noteReferences(content)) {
        const old = referenceTarget(ref, sourceBefore, before);
        if (!old)
            continue;
        const destination = old === from ? to : old;
        if (ref.kind === "wiki") {
            if (old !== from || !ref.target)
                continue;
            if (after(ref.target) === to && ref.target.normalize("NFC").toLowerCase() !== noteName(from).normalize("NFC").toLowerCase() && !ref.target.includes("/"))
                continue;
            const name = noteName(to), value = after(name) === to ? name : to.replace(/\.md$/i, "");
            if (content.slice(ref.targetFrom, ref.targetTo) !== value)
                edits.push({ from: ref.targetFrom, to: ref.targetTo, insert: value });
        }
        else {
            if (!ref.target || old !== from && sourceBefore === sourceAfter)
                continue;
            const directory = sourceAfter.split("/").slice(0, -1), parts = destination.split("/");
            while (directory.length && parts.length && directory[0] === parts[0]) {
                directory.shift();
                parts.shift();
            }
            const relative = [...directory.map(() => ".."), ...parts].join("/");
            edits.push({ from: ref.targetFrom, to: ref.targetTo, insert: relative.split("/").map(encodeURIComponent).join("/") });
        }
    }
    return { content: applyTextEdits(content, edits), count: edits.length };
}
export function validTag(value: unknown): value is string { return typeof value === "string" && value.length <= 200 && !!cleanTag(value) && /^#?[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*$/u.test(value); }
export function rewriteTag(content: string, from: string, to: string) {
    const context = markdownStructure(content), edits: TextEdit[] = [], old = tagKey(from);
    const replace = (tag: string) => tagKey(tag) === old ? to : tagKey(tag).startsWith(old + "/") ? to + tag.slice(from.length) : tag;
    let offset = 0;
    for (const line of content.split("\n")) {
        for (const tag of tagsInLine(line)) {
            const pos = offset + tag.from;
            if (!context.prose(pos))
                continue;
            let node = context.tree.resolveInner(pos, 1), linked = false;
            for (; node; node = node.parent!)
                if (["URL", "Link", "Image"].includes(node.name)) {
                    linked = true;
                    break;
                }
            if (linked)
                continue;
            const next = replace(tag.tag);
            if (next !== tag.tag)
                edits.push({ from: pos, to: offset + tag.to, insert: "#" + next });
        }
        offset += line.length + 1;
    }
    let unsupported = false;
    const fm = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
    if (fm) {
        const base = fm[0].indexOf("\n") + 1, doc = parseDocument(fm[1]!, { prettyErrors: false, strict: true });
        if (doc.errors.length)
            unsupported = true;
        else if (isMap(doc.contents))
            for (const key of ["tags", "tag"]) {
                const node = doc.get(key, true);
                if (!node)
                    continue;
                const items = isSeq(node) ? node.items : [node];
                for (const item of items) {
                    if (!isScalar(item) || typeof item.value !== "string" || !item.range || item.anchor || ["BLOCK_LITERAL", "BLOCK_FOLDED"].includes(item.type ?? "")) {
                        unsupported = true;
                        continue;
                    }
                    const next = item.value.split(/([,\s]+)/).map(part => {
                        const raw = part.startsWith("#") ? part.slice(1) : part, changed = replace(raw);
                        return changed === raw ? part : (part.startsWith("#") ? "#" : "") + changed;
                    }).join("");
                    if (next === item.value)
                        continue;
                    const scalar = item as Scalar<string>;
                    const parsed = parseDocument(next).contents;
                    const needsQuotes = !isScalar(parsed) || typeof parsed.value !== "string" || parsed.value !== next || /^[?!&*{}[\],#>|%@`"']/.test(next);
                    const value = scalar.type === "QUOTE_SINGLE" ? "'" + next.replace(/'/g, "''") + "'" : scalar.type === "QUOTE_DOUBLE" || needsQuotes ? JSON.stringify(next) : next;
                    edits.push({ from: base + item.range[0], to: base + item.range[1], insert: value });
                }
            }
    }
    return { content: applyTextEdits(content, edits), count: edits.length, unsupported };
}
