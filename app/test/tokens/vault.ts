// O cofre de exemplo da bateria de tokens (spec #12137): um projeto com a nota principal grande, notas soltas, uma
// reunião gravada com transcrição e uma planilha grande. Sempre o mesmo conteúdo, para o número só mudar quando o
// Kiwi mudar o que devolve.

import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { uiCapabilities } from "../../src/bun/ui-capabilities.ts";
import { buildFile } from "../../src/agent/tools/files-create.ts";
import { readerFromCapabilities, type VaultReader } from "../../src/agent/tools/reader.ts";
import { Vault } from "../../src/notes/vault.ts";
import { DEFAULT_SETTINGS } from "../../src/store/settings.ts";

const SEG = (n: number, who: string) => `%%meeting-segment:${n.toString(16).padStart(24, "0")} {"s":${n},"e":${n + 1},"c":"system","l":"${who}"}%%`;

/** A nota principal do projeto: seções de verdade, umas 30 mil letras no total. */
const MAIN = [
  "---\ntags: [projeto, atlas]\n---",
  "# Atlas na nuvem",
  "A mudança do escritório para o andar novo, com as caixas, por fases.",
  ...Array.from({ length: 12 }, (_, s) =>
    [`## Fase ${s + 1}`, ...Array.from({ length: 20 }, (_, l) => `- Item ${l + 1} da fase ${s + 1}: conferir as caixas, o selo e o número da sala.`)].join("\n"),
  ),
  "## Prazo\n\nO prazo da mudança é abril, com a revisão de segurança antes.",
  "## Pendências\n\n- [ ] Rever as regras de arquivo\n- [ ] Fechar o contrato do fornecedor\n- [x] Pedir o caminhão",
].join("\n\n");

const MEETING = [
  "---\ntype: meeting\ndate: 2026-11-10\nstart: 2026-11-10T14:00:00.000Z\nend: 2026-11-10T14:45:00.000Z\nduration: 2700\napp: Teams\nparticipants:\n  - Ana\n  - Bruno\n---",
  "## Minhas notas\n\nlembrar do orçamento e do prazo da mudança",
  "## Transcrição",
  Array.from({ length: 80 }, (_, i) => {
    const who = i % 2 ? "Bruno" : "Ana";
    return `**${who}** (${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}): Falamos da fase ${(i % 12) + 1}, da obra e do orçamento. ${SEG(i + 1, who)}`;
  }).join("\n"),
].join("\n\n");

/** Um cofre de exemplo num tmp, com o leitor das ferramentas do agente. */
export async function sampleVault(base: string): Promise<{ root: string; reader: VaultReader }> {
  const root = path.join(base, "KiwiNotes");
  const files: Record<string, string> = {
    "Projetos/Atlas/Atlas.md": `${MAIN}\n`,
    "Projetos/Atlas/Regras.md": "# Regras\n\nAs regras trocam o nome do cliente e as datas antes do envio.\n",
    "Projetos/Atlas/Arquivo frio.md": "# Arquivo frio\n\nO arquivo frio guarda os documentos com mais de dois anos.\n",
    "Ideias.md": "# Ideias\n\n- um gato que pensa\n- o resumo do dia\n",
    "Reuniões/2026-11-10 · Orçamento.md": `${MEETING}\n`,
  };
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  // A planilha grande: 400 linhas de vendas, em duas abas.
  const rows = (n: number) => [["Mês", "Região", "Produto", "Unidades", "Receita"], ...Array.from({ length: n }, (_, i) => [`2026-${String((i % 12) + 1).padStart(2, "0")}`, ["Sul", "Sudeste", "Norte"][i % 3]!, `Produto ${i % 17}`, String(100 + i), String(1000 + i * 7)])];
  writeFileSync(path.join(root, "Projetos/Atlas/vendas.xlsx"), await buildFile("xlsx", { abas: [{ nome: "2026", tabela: rows(300) }, { nome: "Metas", tabela: rows(100) }] }));
  // O projeto marcado, como o `projects.mark` grava.
  const main = "Projetos/Atlas/Atlas.md";
  mkdirSync(path.join(root, ".kiwi"), { recursive: true });
  const projects = [{ folder: "Projetos/Atlas", main, mainIno: statSync(path.join(root, main)).ino, folderIno: statSync(path.join(root, "Projetos/Atlas")).ino }];
  writeFileSync(path.join(root, ".kiwi/projects.json"), `${JSON.stringify({ version: 1, projects }, null, 2)}\n`);
  const v = new Vault({ root, debounceMs: 20, trash: async () => {} });
  const caps = uiCapabilities({
    dictionary: { load: async () => [], save: async (t) => t },
    snippets: { load: async () => [], save: async (s) => s },
    history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
    dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
    settings: { load: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }), save: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }) },
    clipboardWrite: () => {},
    notes: v,
  });
  return { root, reader: readerFromCapabilities(caps as never) };
}
