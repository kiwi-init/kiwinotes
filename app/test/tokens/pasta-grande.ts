// A pasta falsa grande da bateria da Bússola (ADR 0013, T13702): umas 20 mil notas em muitas subpastas, sempre iguais
// pela semente. Projetos marcados, reuniões gravadas, notas .md e .txt, nomes parecidos entre si ("Relatório Q1",
// "relatorio-q1-final"), apelidos e links. Nada disso vai para o repo: só este gerador. Os alvos dos 30 pedidos
// (`pedidos.ts`) estão aqui com o nome certo; o resto é volume.

import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { readerFromCapabilities, type VaultReader } from "../../src/agent/tools/reader.ts";
import { writerFromCapabilities, type VaultWriter } from "../../src/agent/tools/writer.ts";
import { uiCapabilities } from "../../src/bun/ui-capabilities.ts";
import { Vault } from "../../src/notes/vault.ts";
import { DEFAULT_SETTINGS } from "../../src/store/settings.ts";

/** Um gerador pseudoaleatório fixo (mulberry32): a mesma semente dá a mesma pasta. */
export function aleatorio(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Os projetos marcados: a pasta e a nota principal, com nomes que a pessoa fala de vários jeitos. */
export const PROJETOS = ["Legacy PR", "Portal Clientes", "Kiwi Notes", "Projeto Atlas", "Arquivo Morto", "Contrato Fornecedor", "Mudança Beta", "Rede Norte", "Painel Vendas", "Documentos Antigos", "Orçamento 2027", "Site Institucional"];

/** As notas que os pedidos procuram, com o texto delas (o resto da pasta é volume). */
export const ALVOS: Record<string, string> = {
  "Projetos/Legacy PR/Plano de Mudança.md": "# Plano de Mudança\n\n## Fases\n\n- Fase 1: empacotar as caixas por sala\n- Fase 2: o caminhão leva tudo no sábado\n- Fase 3: montar as mesas no andar novo\n\n## Prazo\n\nO prazo é março de 2027, com a vistoria do prédio em fevereiro.\n\n## Riscos\n\n- O elevador de carga só funciona de manhã\n- As chaves do andar novo ainda não chegaram\n",
  "Projetos/Portal Clientes/Relatório Q1.md": "# Relatório Q1\n\n## Números\n\n- 1,2 milhão de arquivos enviados\n- 3 falhas de envio por semana\n\n## Pendências\n\n- [ ] Rever o Projeto Atlas\n- [ ] Fechar o contrato\n",
  "Projetos/Portal Clientes/relatorio-q1-final.md": "# relatorio-q1-final\n\nA versão final do relatório, com os números revisados.\n",
  "Projetos/Portal Clientes/Relatório Q1 rascunho.txt": "Rascunho do relatório Q1.\nNúmeros ainda por conferir.\n",
  "Projetos/Projeto Atlas/Regras.md": "---\naliases: [regras de arquivamento, regras do atlas]\n---\n# Regras\n\n## Campos\n\n- O nome do cliente vira um código\n- As datas andam 30 dias\n\n## Exceções\n\nOs contratos ativos guardam a data original.\n",
  "Pessoal/Lista de compras.md": "# Lista de compras\n\n- café\n- pão\n- queijo\n",
  "Pessoal/Ideias de viagem.txt": "Ideias de viagem\n- Chapada Diamantina\n- Jalapão\n",
  "Trabalho/Rotina da equipe.md": "# Rotina da equipe\n\n## Segunda\n\nReunião de planejamento às 9h.\n\n## Sexta\n\nRevisão das entregas e da semana.\n",
  "Trabalho/Contatos do escritório.md": "# Contatos do escritório\n\n- TI: ramal 2040\n- Financeiro: ramal 3110\n",
  "Estudos/Fotografia/Anotações do curso.md": "# Anotações do curso\n\n## Módulo 1\n\nAbertura, velocidade e ISO.\n\n## Módulo 2\n\nLuz natural e composição.\n",
  "Projetos/Kiwi Notes/Ideias do gato.md": "# Ideias do gato\n\n- o gato pisca quando acha a nota\n- o balão some sozinho\n",
};

/** As pastas que os pedidos citam, e a reunião mais nova (a "última reunião"). */
export const PASTAS = ["Projetos/Legacy PR", "Pessoal", "Trabalho", "Estudos/Fotografia", "Projetos/Portal Clientes"];
export const ULTIMA_REUNIAO = "Reuniões/2026-11-13 · Alinhamento Rede.md";

const PALAVRAS = "arquivo documento mudança envio conferência contrato revisão equipe semana prazo resumo ideia relatório plano pendência cliente pedido planilha servidor nuvem custo backup teste rotina lista".split(" ");
const AREAS = ["Áreas", "Arquivo", "Trabalho", "Pessoal", "Estudos", "Leituras", "Clientes", "Diário"];

/**
 * Escreve a pasta em `root`: os projetos (cada um com a nota principal e umas 30 notas), 400 reuniões, os alvos, e o
 * volume até `notas` (notas .md e .txt em subpastas de dois a quatro níveis). Devolve quantas notas escreveu.
 */
export function gerarPasta(root: string, o: { notas?: number; semente?: number } = {}): number {
  const total = o.notas ?? 20_000;
  const r = aleatorio(o.semente ?? 13435);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const frase = (n: number) => Array.from({ length: n }, () => pick(PALAVRAS)).join(" ");
  let escritas = 0;
  const escrever = (rel: string, texto: string) => {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, texto);
    escritas++;
  };
  // Os projetos, com a nota principal marcada.
  const marcados: { folder: string; main: string }[] = [];
  for (const p of PROJETOS) {
    const main = `Projetos/${p}/${p}.md`;
    escrever(main, `# ${p}\n\n## Objetivo\n\n${frase(30)}.\n\n## Andamento\n\n${Array.from({ length: 8 }, () => `- ${frase(8)}`).join("\n")}\n\n## Próximos passos\n\n- [ ] ${frase(5)}\n- [ ] ${frase(5)}\n`);
    marcados.push({ folder: `Projetos/${p}`, main });
    for (let i = 0; i < 30; i++) escrever(`Projetos/${p}/${i % 3 ? "" : "Notas/"}${pick(PALAVRAS)} ${pick(PALAVRAS)} ${i + 1}.md`, `# ${frase(3)}\n\n${frase(60)}.\n\nVer [[${p}]].\n`);
  }
  // As reuniões: uma por dia útil, a mais nova é a última.
  for (let i = 0; i < 400; i++) {
    const d = new Date(Date.UTC(2026, 10, 13) - i * 86_400_000);
    const day = d.toISOString().slice(0, 10);
    const tema = i === 0 ? "Alinhamento Rede" : `${pick(["Alinhamento", "Revisão", "Planejamento", "Status"])} ${pick(PROJETOS)}`;
    escrever(`Reuniões/${day} · ${tema}.md`, `---\ntype: meeting\ndate: ${day}\nstart: ${day}T14:00:00.000Z\nend: ${day}T14:40:00.000Z\nduration: 2400\napp: Teams\nparticipants:\n  - Ana\n  - Bruno\n---\n\n## Minhas notas\n\n${frase(20)}\n\n## Transcrição\n\n${Array.from({ length: 30 }, (_, k) => `**${k % 2 ? "Bruno" : "Ana"}** (00:${String(k).padStart(2, "0")}): ${frase(14)}.`).join("\n")}\n`);
  }
  for (const [rel, texto] of Object.entries(ALVOS)) escrever(rel, texto);
  // O volume: subpastas de dois a quatro níveis, notas .md (algumas com apelido e link) e algumas .txt.
  const pastas: string[] = [];
  for (const a of AREAS) for (let i = 0; i < 40; i++) {
    const nivel2 = `${a}/${pick(PALAVRAS)} ${i}`;
    pastas.push(nivel2, `${nivel2}/${pick(PALAVRAS)}`, `${nivel2}/${pick(PALAVRAS)}/${pick(PALAVRAS)} ${i % 5}`);
  }
  for (let i = 0; escritas < total; i++) {
    const titulo = `${pick(PALAVRAS)} ${pick(PALAVRAS)} ${i}`;
    const txt = i % 9 === 0;
    const pasta = pick(pastas);
    const apelido = i % 11 === 0 ? `---\naliases: [${pick(PALAVRAS)} ${i}]\n---\n` : "";
    const link = i % 4 === 0 ? `\n\nVer [[${pick(PALAVRAS)} ${pick(PALAVRAS)} ${Math.floor(r() * i)}]].` : "";
    escrever(`${pasta}/${titulo}.${txt ? "txt" : "md"}`, txt ? `${frase(40)}\n` : `${apelido}# ${titulo}\n\n${frase(50)}.${link}\n`);
  }
  mkdirSync(path.join(root, ".kiwi"), { recursive: true });
  const projects = marcados.map((m) => ({ ...m, mainIno: statSync(path.join(root, m.main)).ino, folderIno: statSync(path.join(root, m.folder)).ino }));
  writeFileSync(path.join(root, ".kiwi/projects.json"), `${JSON.stringify({ version: 1, projects }, null, 2)}\n`);
  return escritas;
}

/** A pasta aberta pelo Kiwi, com o leitor e o escritor das ferramentas do agente. */
export async function abrirPasta(root: string): Promise<{ vault: Vault; reader: VaultReader; writer: VaultWriter }> {
  const vault = new Vault({ root, debounceMs: 20, trash: async () => {} });
  await vault.open();
  const caps = uiCapabilities({
    dictionary: { load: async () => [], save: async (t) => t },
    snippets: { load: async () => [], save: async (s) => s },
    history: { search: async () => ({ entries: [] }), delete: async () => true, get: async () => null },
    dictationNotes: { toNew: async () => { throw new Error("not used"); }, append: async () => { throw new Error("not used"); } },
    settings: { load: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }), save: async () => ({ ...DEFAULT_SETTINGS, notesShortcut: null }) },
    clipboardWrite: () => {},
    notes: vault,
  });
  return { vault, reader: readerFromCapabilities(caps as never), writer: writerFromCapabilities(caps as never) };
}
