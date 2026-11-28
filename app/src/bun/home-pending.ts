// As Pendências da aba Início (T15875, harry #15873): os `- [ ]` abertos das notas e os próximos passos das atas, por
// nota, da editada por último para a mais velha. Só lê os arquivos do Mac: nada chama o agente.
import { type HomePending, type PendingGroup, type PendingItem, PENDING_LIMITS } from "../shared/home.ts";
import { withoutSkips } from "../shared/calendar.ts";
import { frontmatterOf } from "../shared/meetings.ts";
import { isMeetingNote } from "../shared/meeting-note.ts";
import type { NoteMeta } from "../notes/vault.ts";
import type { HomeNotes, HomeSources } from "./home.ts";

/** As seções de uma ata cujos tópicos sem caixa contam como abertos. */
const NEXT_STEPS = /^#{2,3}\s+(\d+\.\s+)?(Próximos passos|Ações)\s*$/i;

export async function homePending(src: Pick<HomeSources, "notes" | "meetings">): Promise<HomePending> {
  const vaults: HomeNotes[] = src.notes === src.meetings ? [src.notes] : [src.notes, src.meetings];
  const groups: PendingGroup[] = [];
  const total = { meeting: 0, note: 0 };
  const seen = new Set<string>();
  for (const v of vaults) {
    // Só lê as notas que podem ter algo aberto: uma caixa vazia, ou o `reuniao:` de uma ata.
    const candidates = new Map<string, NoteMeta>();
    for (const m of [...v.notesContaining("[ ]"), ...v.notesContaining("reuniao:")]) candidates.set(m.path, m);
    for (const meta of candidates.values()) {
      if (seen.has(meta.path)) continue;
      seen.add(meta.path);
      const note = await v.get(meta.path).catch(() => null);
      if (!note) continue; // sumiu entre o índice e a leitura
      // A nota da gravação é o texto cru; o que ficou combinado está na ata.
      if (isMeetingNote(note.content)) continue;
      const origin = isMinutes(note.content) ? "meeting" : "note";
      const items = openItems(note.content, origin === "meeting");
      if (!items.length) continue;
      total[origin] += items.length;
      const editedAt = Date.parse(note.mtime);
      groups.push({
        path: meta.path,
        title: meta.title,
        folder: meta.folder.split("/").filter(Boolean).at(-1) ?? null,
        editedAt: Number.isNaN(editedAt) ? 0 : editedAt,
        origin,
        internal: v !== src.notes,
        items: items.slice(0, PENDING_LIMITS.itemsPerGroup),
        more: Math.max(0, items.length - PENDING_LIMITS.itemsPerGroup),
      });
    }
  }
  groups.sort((a, b) => b.editedAt - a.editedAt || a.path.localeCompare(b.path));
  return { groups: groups.slice(0, PENDING_LIMITS.groups), total };
}

/** Uma ata: a nota cujo `reuniao:` aponta para uma reunião (`[[…]]`). */
export function isMinutes(content: string): boolean {
  const link = frontmatterOf(content)?.reuniao;
  return typeof link === "string" && /^\s*\[\[[^\]]+\]\]/.test(link);
}

/**
 * Os itens abertos de uma nota, na ordem do arquivo: as caixas vazias (`- [ ]`) em qualquer lugar e, numa ata, também
 * os tópicos sem caixa das seções "Próximos passos" e "Ações". Fora: o frontmatter, os blocos de código e o `[x]`.
 */
export function openItems(content: string, minutes: boolean): PendingItem[] {
  const out: PendingItem[] = [];
  for (const it of listItems(content, minutes)) {
    if (it.box === "x" || (it.box === null && !it.inNextSteps)) continue;
    const text = plain(it.rest);
    if (text) out.push({ text, line: it.line });
  }
  return out;
}

/** Um item de lista de uma nota: a linha (0-based), a caixa (`" "`, `"x"` ou `null` sem caixa) e o texto depois dela. */
export interface ListItem {
  line: number;
  box: " " | "x" | null;
  rest: string;
  /** Um tópico das seções "Próximos passos" ou "Ações" de uma ata. */
  inNextSteps: boolean;
}

/**
 * Os itens de lista de uma nota, na ordem do arquivo, fora do frontmatter e dos blocos de código: o mesmo leitor das
 * Pendências da Início e do Calendário (spec #32129), para os dois verem as mesmas linhas.
 */
export function listItems(content: string, minutes: boolean): ListItem[] {
  // Os comentários `%%…%%` (o id do ditado, notas escondidas) somem, mas as quebras ficam: a linha de cada item não muda.
  const lines = withoutComments(content).split(/\r?\n/);
  const out: ListItem[] = [];
  let i = 0;
  if (/^---\s*$/.test(lines[0] ?? "")) {
    const end = lines.findIndex((l, n) => n > 0 && /^---\s*$/.test(l));
    if (end > 0) i = end + 1;
  }
  let fence: string | null = null;
  /** O nível do título dos Próximos passos em que estamos (0: fora deles). */
  let nextSteps = 0;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    // A cerca fecha com o mesmo caractere e pelo menos o mesmo tamanho: ``` não fecha um bloco aberto com ````.
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1]!;
      else if (f[1]![0] === fence[0] && f[1]!.length >= fence.length && !line.trim().slice(f[1]!.length).trim()) fence = null;
      continue;
    }
    if (fence) continue;
    const t = line.trim();
    const heading = /^(#{1,6})\s/.exec(t);
    if (heading) {
      // Só um título do mesmo nível ou mais alto fecha os Próximos passos; um sub-título dentro deles, não.
      const level = heading[1]!.length;
      if (minutes && NEXT_STEPS.test(t)) nextSteps = level;
      else if (nextSteps && level <= nextSteps) nextSteps = 0;
      continue;
    }
    const inNextSteps = nextSteps > 0;
    // A caixa também vale dentro de uma citação ou de um callout (`> - [ ] …`).
    const box = /^\s*(?:>\s?)*\s*(?:[-*+]|\d+[.)])\s+\[( |x|X)\]\s+(.*)$/.exec(line);
    if (box) {
      out.push({ line: i, box: box[1] === " " ? " " : "x", rest: box[2]!, inNextSteps });
      continue;
    }
    const bullet = /^\s*(?:>\s?)*\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    // Sem caixa, fora dos Próximos passos, só os tópicos da margem (até 3 espaços) contavam: o mesmo vale aqui.
    if (bullet && (inNextSteps ? /^\s{0,3}(?:[-*+]|\d+[.)])\s/.test(line) : true)) out.push({ line: i, box: null, rest: bullet[1]!, inNextSteps });
  }
  return out;
}

/** O texto sem os comentários `%%…%%` do Markdown, como no `notes/export.ts`, mantendo as quebras de linha. */
export const withoutComments = (s: string) => s.replace(/%%[\s\S]*?%%/g, (m) => m.replace(/[^\n]/g, " "));

/** O texto do item sem a marcação: links viram o nome, ênfase e código saem. */
export function plain(s: string): string {
  return withoutSkips(s)
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|==|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
