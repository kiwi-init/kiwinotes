// Os anexos no editor (T2594): colar (⌘V) ou arrastar uma imagem ou um PDF grava o arquivo pelo engine
// (`attachments.save`) e põe o `![[foto.png]]` numa linha só dele, como o Obsidian. Fora da linha do cursor, essa linha
// aparece como a imagem (ou um cartão do PDF), com o arquivo vindo do engine como `data:` URL: nada de `file://`.

import { type EditorState, Prec, type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";

import { ATTACHMENT_TYPES, extOf, isAttachmentName, MAX_ATTACHMENT_BYTES } from "../../../src/shared/attachments.ts";

export interface AttachmentFile {
  path: string;
  mime: string;
  dataUrl: string;
}

/** O que o editor pede ao engine. */
export interface AttachmentSource {
  save(name: string, data: string): Promise<{ embed: string }>;
  read(link: string): Promise<AttachmentFile>;
}

// ---------------------------------------------------------------- funções puras (testadas)

/** Uma linha que é só um embed de anexo: `![[foto.png]]` ou `![[foto.png|300]]` (a largura, como no Obsidian). */
export function embedLine(text: string): { target: string; width: number | null } | null {
  const m = /^\s*!\[\[([^\[\]|#\n]+)(?:\|(\d{1,4}))?\]\]\s*$/.exec(text);
  if (!m || !isAttachmentName(m[1]!.trim())) return null;
  return { target: m[1]!.trim(), width: m[2] ? Number(m[2]) : null };
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * O nome do arquivo colado. Um print colado chega como "image.png" (o WebKit não sabe o nome): vira
 * "Colado 2026-11-04 14.32.10.png", como o Obsidian faz com "Pasted image …". Um arquivo de verdade fica com o nome dele.
 */
export function pastedName(name: string, mime: string, now: Date): string {
  const ext = extOf(name) || Object.entries(ATTACHMENT_TYPES).find(([, m]) => m === mime)?.[0] || "";
  const generic = !name || /^image\.(png|jpe?g|gif|webp|heic)$/i.test(name);
  if (!generic && extOf(name)) return name;
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
  return `Colado ${stamp}.${ext || "png"}`;
}

/** Os arquivos que dá para anexar, e os que não (pelo tipo ou pelo tamanho), com o motivo. */
export function sortFiles(files: readonly { name: string; type: string; size: number }[]): {
  ok: number[];
  refused: { name: string; why: string }[];
} {
  const ok: number[] = [];
  const refused: { name: string; why: string }[] = [];
  files.forEach((f, i) => {
    const known = isAttachmentName(f.name) || Object.values(ATTACHMENT_TYPES).includes(f.type);
    if (!known) refused.push({ name: f.name || "arquivo", why: "só imagem ou PDF" });
    else if (f.size > MAX_ATTACHMENT_BYTES) refused.push({ name: f.name || "arquivo", why: "maior que 25 MB" });
    else ok.push(i);
  });
  return { ok, refused };
}

/**
 * Onde o embed entra para ficar numa linha só dele: no meio de um texto, quebra a linha antes e depois. Devolve o
 * texto a inserir e onde o cursor fica (no fim do embed).
 */
export function insertionAt(doc: string, pos: number, embed: string): { insert: string; anchor: number } {
  const before = pos > 0 ? doc[pos - 1] : "\n";
  const after = pos < doc.length ? doc[pos] : "\n";
  const lead = before === "\n" ? "" : "\n";
  const tail = after === "\n" ? "" : "\n";
  const insert = `${lead}${embed}${tail}`;
  return { insert, anchor: pos + lead.length + embed.length };
}

/** O base64 de um arquivo (sem o "data:…;base64,"). */
export function fileBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.onerror = () => reject(r.error ?? new Error("não deu para ler o arquivo"));
    r.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------- o desenho

/** Um anexo leu (ou falhou): os widgets que esperavam por ele se redesenham. */
const attachmentLoaded = StateEffect.define<null>();

class AttachmentCache {
  private known = new Map<string, AttachmentFile | null>();
  private asking = new Set<string>();
  constructor(private source: AttachmentSource) {}

  get(target: string, view: EditorView): AttachmentFile | null | undefined {
    const key = target.toLocaleLowerCase("pt-BR");
    if (this.known.has(key)) return this.known.get(key);
    if (!this.asking.has(key)) {
      this.asking.add(key);
      this.source.read(target).then(
        (f) => this.settle(key, f, view),
        () => this.settle(key, null, view),
      );
    }
    return undefined;
  }

  private settle(key: string, file: AttachmentFile | null, view: EditorView) {
    this.asking.delete(key);
    this.known.set(key, file);
    queueMicrotask(() => view.dispatch({ effects: attachmentLoaded.of(null) }));
  }
}

class AttachmentWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly width: number | null,
    readonly file: AttachmentFile | null | undefined,
    readonly from: number,
  ) {
    super();
  }
  eq(o: AttachmentWidget) {
    return o.target === this.target && o.width === this.width && o.file === this.file && o.from === this.from;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-attachment";
    // Clicar no anexo põe o cursor na linha dele: o embed vira texto para editar (como a tabela).
    wrap.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });
    const name = this.target.split("/").at(-1)!;
    if (this.file === undefined) {
      wrap.classList.add("cm-attachment-loading");
      wrap.textContent = name;
      return wrap;
    }
    if (this.file === null) {
      wrap.classList.add("cm-attachment-missing");
      wrap.textContent = `${name} não está no vault`;
      return wrap;
    }
    if (this.file.mime === "application/pdf") {
      wrap.classList.add("cm-attachment-file");
      const label = document.createElement("span");
      label.className = "cm-attachment-name";
      label.textContent = name;
      const kind = document.createElement("span");
      kind.className = "cm-attachment-kind";
      kind.textContent = "PDF";
      wrap.append(label, kind);
      return wrap;
    }
    const img = document.createElement("img");
    img.src = this.file.dataUrl;
    img.alt = name;
    img.draggable = false;
    if (this.width) img.style.width = `${this.width}px`;
    // A altura só existe depois de a imagem carregar: o editor mede de novo, senão o clique cai na linha errada.
    img.addEventListener("load", () => view.requestMeasure());
    wrap.append(img);
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

function buildAttachments(state: EditorState, cache: AttachmentCache, view: EditorView | null): DecorationSet {
  const out: Range<Decoration>[] = [];
  if (!view) return Decoration.none;
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    if (!line.text.includes("![[")) continue;
    const e = embedLine(line.text);
    if (!e) continue;
    const file = cache.get(e.target, view);
    const widget = new AttachmentWidget(e.target, e.width, file, line.from);
    // Com o cursor na linha, o embed fica como texto para editar e o anexo continua à vista logo abaixo (T2984).
    if (state.selection.ranges.some((r) => r.to >= line.from && r.from <= line.to)) out.push(Decoration.widget({ widget, block: true, side: 1 }).range(line.to));
    else out.push(Decoration.replace({ widget, block: true }).range(line.from, line.to));
  }
  return Decoration.set(out);
}

/**
 * As linhas `![[anexo]]` aparecem como o anexo; com o cursor nelas, voltam a ser texto, com o anexo embaixo. Decoração de bloco, então
 * vem de um StateField (como a tabela), que precisa da view para pedir o arquivo: ela chega pelo plugin abaixo.
 */
export function attachmentPreview(source: AttachmentSource) {
  const cache = new AttachmentCache(source);
  let current: EditorView | null = null;
  const field = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, tr) {
      if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(attachmentLoaded))) return buildAttachments(tr.state, cache, current);
      return value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  // O plugin nasce com a view (e de novo a cada `setState`, quando outra nota abre): daí o campo já pode pedir arquivos.
  const bind = ViewPlugin.define((view) => {
    current = view;
    queueMicrotask(() => view.dispatch({ effects: attachmentLoaded.of(null) }));
    return {
      destroy() {
        if (current === view) current = null;
      },
    };
  });
  return [field, bind];
}

// ---------------------------------------------------------------- colar e arrastar

/**
 * ⌘V com uma imagem e arrastar arquivos para a nota. Cada arquivo vai ao engine e o embed entra onde o cursor estava
 * (colar) ou onde soltou (arrastar). O que não é imagem nem PDF, ou passa de 25 MB, não entra e a janela avisa.
 */
export function attachmentInput(source: AttachmentSource, onError: (text: string) => void, now: () => Date = () => new Date()) {
  const add = async (view: EditorView, files: File[], at: number) => {
    const { ok, refused } = sortFiles(files);
    if (refused.length) onError(refused.length === 1 ? `${refused[0]!.name}: ${refused[0]!.why}` : `${refused.length} arquivos não entraram (${refused[0]!.why})`);
    let pos = at;
    for (const i of ok) {
      const f = files[i]!;
      try {
        const saved = await source.save(pastedName(f.name, f.type, now()), await fileBase64(f));
        // O documento pode ter mudado enquanto o arquivo gravava: o ponto não passa do fim.
        pos = Math.min(pos, view.state.doc.length);
        const ins = insertionAt(view.state.doc.toString(), pos, saved.embed);
        view.dispatch({ changes: { from: pos, insert: ins.insert }, selection: { anchor: ins.anchor }, userEvent: "input.paste", scrollIntoView: true });
        pos = ins.anchor;
      } catch (e) {
        onError(`${f.name || "O anexo"} não entrou: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };
  return Prec.high(
    EditorView.domEventHandlers({
      paste(e, view) {
        const files = [...(e.clipboardData?.files ?? [])];
        if (!files.length) return false;
        e.preventDefault();
        void add(view, files, view.state.selection.main.head);
        return true;
      },
      dragover(e) {
        if (!e.dataTransfer?.types.includes("Files")) return false;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        return true;
      },
      drop(e, view) {
        const files = [...(e.dataTransfer?.files ?? [])];
        if (!files.length) return false;
        e.preventDefault();
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
        void add(view, files, pos);
        return true;
      },
    }),
  );
}

/** Os estilos dos anexos no editor, com os tokens do app. */
export const attachmentTheme = EditorView.theme({
  ".cm-attachment": { padding: "6px 0 10px", cursor: "pointer" },
  ".cm-attachment img": { display: "block", maxWidth: "100%", maxHeight: "70vh", borderRadius: "var(--r-ctl, 10px)" },
  ".cm-attachment-loading, .cm-attachment-missing": { color: "var(--text-3)", fontSize: "13px" },
  ".cm-attachment-file": {
    display: "inline-flex",
    alignItems: "center",
    gap: "10px",
    margin: "4px 0 8px",
    padding: "8px 12px",
    borderRadius: "var(--r-ctl, 10px)",
    background: "var(--bg-3, var(--surface-2))",
  },
  ".cm-attachment-name": { color: "var(--text)" },
  ".cm-attachment-kind": { fontFamily: "var(--mono, var(--font-mono))", fontSize: "11px", color: "var(--text-3)" },
});
