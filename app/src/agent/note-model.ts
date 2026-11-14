// O Modelo de nota (spec #11102, T11223): o padrão que o agente segue quando cria ou organiza uma nota. A pessoa monta
// uma vez (Ajustes › Agente), e o Kiwi guarda num arquivo legível do cofre, `.kiwi/modelo-de-nota.md`.
//
// - Um modelo só por cofre. Mudar o modelo não reescreve nenhuma nota: vale para o que o agente fizer depois.
// - O mesmo modelo dá sempre os mesmos bytes, no arquivo e nas instruções do agente: o começo fixo do pedido não muda
//   entre dois pedidos (o cache do agente, #11084).
// - O formato (combinado com o #8360 em #11283): as linhas `- bloco: ligado|desligado` na ordem da nota, depois o
//   estilo do corpo, os títulos e até que nível o sumário desce. Sem o arquivo, ou com ele estragado, vale o padrão.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { BODY_STYLES, DEFAULT_NOTE_MODEL, NOTE_BLOCKS, sanitizeNoteModel, type BodyStyle, type NoteBlock, type NoteModel } from "../shared/note-model.ts";

export { BODY_STYLES, DEFAULT_NOTE_MODEL, NOTE_BLOCKS, sanitizeNoteModel, type BodyStyle, type NoteBlock, type NoteModel };

export const NOTE_MODEL_FILE = path.join(".kiwi", "modelo-de-nota.md");
const MARK = "<!-- kiwi:note-model v1 -->";

/** O arquivo `.kiwi/modelo-de-nota.md`: legível, e sempre os mesmos bytes para o mesmo modelo. */
export function formatNoteModel(model: NoteModel): string {
  const m = sanitizeNoteModel(model);
  return [
    "# Modelo de nota",
    "",
    "O padrão que o agente do Kiwi segue quando cria ou organiza uma nota. Mude em Ajustes › Agente › Modelo de nota.",
    "",
    MARK,
    ...m.blocks.map((b) => `- ${b.block}: ${b.on ? "ligado" : "desligado"}`),
    "",
    `corpo: ${m.body}`,
    `titulos: numerados=${m.numbered ? "sim" : "não"}`,
    `sumario-ate: ${m.tocDepth}`,
    "",
  ].join("\n");
}

/** Lê o arquivo; sem o marcador ou com linhas estranhas, o que não se entende cai no padrão. */
export function parseNoteModel(text: string): NoteModel {
  if (!text.includes(MARK)) return sanitizeNoteModel(DEFAULT_NOTE_MODEL);
  const after = text.slice(text.indexOf(MARK) + MARK.length);
  const blocks: { block: string; on: boolean }[] = [];
  let body: string | undefined;
  let numbered: boolean | undefined;
  let tocDepth: number | undefined;
  for (const raw of after.split("\n")) {
    const line = raw.trim();
    const b = /^- ([a-z]+):\s*(ligado|desligado)$/.exec(line);
    if (b) blocks.push({ block: b[1]!, on: b[2] === "ligado" });
    const c = /^corpo:\s*([a-z]+)$/.exec(line);
    if (c) body = c[1];
    const t = /^titulos:\s*numerados=(sim|não)$/.exec(line);
    if (t) numbered = t[1] === "sim";
    const s = /^sumario-ate:\s*([0-9])$/.exec(line);
    if (s) tocDepth = Number(s[1]);
  }
  return sanitizeNoteModel({ blocks, body, numbered, tocDepth });
}

/** O cofre já tem o arquivo do modelo (a pessoa montou ou pulou a tela). */
export function noteModelSaved(vaultRoot: string): boolean {
  return existsSync(path.join(vaultRoot, NOTE_MODEL_FILE));
}

/** O modelo do cofre; sem o arquivo, o padrão. */
export function readNoteModel(vaultRoot: string): NoteModel {
  const file = path.join(vaultRoot, NOTE_MODEL_FILE);
  if (!existsSync(file)) return sanitizeNoteModel(DEFAULT_NOTE_MODEL);
  try {
    return parseNoteModel(readFileSync(file, "utf8"));
  } catch {
    return sanitizeNoteModel(DEFAULT_NOTE_MODEL);
  }
}

/** Grava o modelo no cofre (escrita atômica). Não toca em nenhuma nota. */
export function writeNoteModel(vaultRoot: string, model: NoteModel): NoteModel {
  const m = sanitizeNoteModel(model);
  const file = path.join(vaultRoot, NOTE_MODEL_FILE);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, formatNoteModel(m));
  renameSync(tmp, file);
  return m;
}

const BLOCK_TEXT: Record<NoteBlock, string> = {
  titulo: "o título (# Título)",
  propriedades: "as propriedades (o frontmatter YAML entre ---: tags, data, projeto)",
  introducao: "uma introdução curta, de duas ou três frases, dizendo do que a nota trata",
  sumario: "o sumário (a lista dos títulos da nota, com links)",
  corpo: "o corpo",
  fechamento: "o fechamento: os próximos passos, em tópicos",
};
const BODY_TEXT: Record<BodyStyle, string> = {
  topicos: "em tópicos",
  curtos: "em parágrafos curtos",
  longos: "em parágrafos longos",
  misto: "misto: parágrafos curtos com tópicos onde ajudam",
};

/**
 * As instruções do modelo para o agente, no começo fixo do pedido. Sem nada da pessoa nem das notas dela, e os mesmos
 * bytes para o mesmo modelo.
 */
export function noteModelText(model: NoteModel): string {
  const m = sanitizeNoteModel(model);
  const on = m.blocks.filter((b) => b.on);
  const off = m.blocks.filter((b) => !b.on);
  const lines = [
    "[Modelo de nota do Kiwi: quando criar uma nota, ou quando a pessoa pedir para organizar uma nota, siga esta ordem de blocos:",
    ...on.map((b, i) => `${i + 1}. ${b.block === "corpo" ? `${BLOCK_TEXT.corpo}, ${BODY_TEXT[m.body]}` : BLOCK_TEXT[b.block]}`),
  ];
  if (off.length) lines.push(`Não crie: ${off.map((b) => BLOCK_TEXT[b.block].split(" (")[0]).join("; ")}.`);
  lines.push(`Títulos ${m.numbered ? "numerados (1., 1.1.)" : "sem numeração"}.`);
  if (on.some((b) => b.block === "sumario")) lines.push(`O sumário desce até o nível ${m.tocDepth} de título.`);
  lines.push("Ao organizar, mantenha todo o conteúdo da nota: só mude a ordem e a forma. Não reescreva notas que a pessoa não pediu.]");
  return `${lines.join("\n")}\n\n`;
}
