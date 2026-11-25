// A tela do que o Kiwi faz (T20838, spec #20828): os 4 exemplos encenados, com dados inventados, e a linha do tempo de
// cada um. Nada aqui chama o agente: é texto e tempo. Cada exemplo corresponde a uma função que o agente já tem
// (escrever na nota, criar arquivo, a proposta depois da reunião, a busca).
//
// Nas telas do mascote, o nome dele é **Kiwi** (#20828); "Kiwi Cat" fica para os Ajustes.

import type { Locale } from "../../../src/shared/i18n/index.ts";
import { appLocale } from "../../src/i18n.ts";

export type ExampleId = "organizar" | "documento" | "reuniao" | "achar";

export type Example = {
  id: ExampleId;
  /** O nome curto do ponto e do leitor de tela. */
  label: string;
  /** O pedido, como se fosse falado. A reunião não tem pedido: ela termina, e o Kiwi propõe. */
  ask: string | null;
  /** A linha do Kiwi enquanto trabalha. */
  working: string;
  /** A linha do Kiwi no fim. */
  done: string;
};

/**
 * Tudo o que a tela encena, numa língua: os textos e as notas de mentira. Fica aqui, um objeto por língua, e não no
 * catálogo (spec #28171): são dados de exemplo que andam juntos (a nota bagunçada e a organizada, a planilha), e o
 * tipo barra uma língua com um campo a menos.
 */
export interface ShowcaseContent {
  title: string;
  hint: string;
  staged: string;
  examples: readonly Example[];
  /** A nota bagunçada do exemplo 1, e ela organizada. */
  noteTitle: string;
  messy: readonly string[];
  tidy: readonly { kind: "h" | "li" | "todo"; text: string }[];
  /** A pasta e a planilha do exemplo 2. */
  folder: { name: string; before: readonly string[]; created: string };
  sheet: readonly (readonly string[])[];
  /** A reunião do exemplo 3 e a proposta. */
  meeting: { title: string; length: string; ended: string };
  proposal: { to: string; note: string; summaryTitle: string; summary: readonly string[]; todosTitle: string; todos: readonly string[]; approve: string; dismiss: string };
  /** A busca do exemplo 4. */
  found: { path: string; before: string; hit: string; after: string; alsoTitle: string; also: readonly string[]; searching: readonly string[] };
  /** A linha do Kiwi antes de trabalhar: ouvindo o pedido, ou a reunião que terminou. */
  listening: string;
  meetingEnded: string;
  dots: string;
  dot: (n: number, total: number, label: string) => string;
}

export const SHOWCASE: Record<Locale, ShowcaseContent> = {
  pt: {
    title: "O que o Kiwi faz por você",
    hint: "Peça com a voz ou escrevendo. Ele trabalha nas suas notas, aqui no seu Mac.",
    staged: "Exemplos encenados, com notas de mentira.",
    examples: [
      { id: "organizar", label: "Organizar uma nota", ask: "Organiza essa nota.", working: "Organizando…", done: "Pronto: títulos, tópicos e as tarefas separadas." },
      { id: "documento", label: "Gerar um documento", ask: "Monta uma planilha com os gastos da viagem.", working: "Criando a planilha…", done: "Criei gastos-viagem.csv na pasta Viagem." },
      { id: "reuniao", label: "Resumir uma reunião", ask: null, working: "Resumindo a reunião…", done: "Quer que eu ponha isto na nota do Projeto X?" },
      { id: "achar", label: "Achar e lembrar", ask: "Onde eu falei do prazo do Projeto X?", working: "Procurando nas notas…", done: "Achei, na nota Cronograma:" },
    ],
    noteTitle: "Anotações da semana",
    messy: ["reuniao c/ ana terça", "revisar orçamento antes de sexta", "ligar pro fornecedor!!", "ideia: newsletter mensal", "ana pediu o relatório"],
    tidy: [
      { kind: "h", text: "Reunião com a Ana (terça)" },
      { kind: "li", text: "Revisar o orçamento antes de sexta" },
      { kind: "li", text: "Enviar o relatório para a Ana" },
      { kind: "h", text: "Tarefas" },
      { kind: "todo", text: "Ligar para o fornecedor" },
      { kind: "h", text: "Ideias" },
      { kind: "li", text: "Newsletter mensal" },
    ],
    folder: { name: "Viagem", before: ["roteiro.md", "hotel.md"], created: "gastos-viagem.csv" },
    sheet: [
      ["Item", "Valor"],
      ["Passagens", "R$ 920"],
      ["Hotel (3 noites)", "R$ 480"],
      ["Comida", "R$ 310"],
      ["Total", "R$ 1.710"],
    ],
    meeting: { title: "Reunião do Projeto X", length: "32 min", ended: "terminou" },
    proposal: {
      to: "Para a nota",
      note: "Projeto X",
      summaryTitle: "Resumo",
      summary: ["A entrega passa para 12 de março.", "Bruno revisa o layout até quinta."],
      todosTitle: "Tarefas",
      todos: ["Mandar o cronograma novo para o time"],
      approve: "Pôr na nota",
      dismiss: "Agora não",
    },
    found: {
      path: "Projeto X › Cronograma",
      before: "Na conversa de segunda, ",
      hit: "o prazo ficou para 12 de março",
      after: ", com a revisão na semana anterior.",
      alsoTitle: "Também fala do prazo:",
      also: ["Projeto X › Reuniões", "Projeto X › Ideias"],
      searching: ["Projeto X › Ideias", "Projeto X › Cronograma", "Projeto X › Reuniões"],
    },
    listening: "Ouvindo…",
    meetingEnded: "A reunião terminou.",
    dots: "Exemplos",
    dot: (n, total, label) => `Exemplo ${n} de ${total}: ${label}`,
  },
  en: {
    title: "What Kiwi does for you",
    hint: "Ask by voice or in writing. It works on your notes, right here on your Mac.",
    staged: "Staged examples, with made-up notes.",
    examples: [
      { id: "organizar", label: "Organize a note", ask: "Organize this note.", working: "Organizing…", done: "Done: headings, bullet points and the tasks split out." },
      { id: "documento", label: "Create a document", ask: "Make a spreadsheet with the trip expenses.", working: "Creating the spreadsheet…", done: "I created trip-expenses.csv in the Trip folder." },
      { id: "reuniao", label: "Summarize a meeting", ask: null, working: "Summarizing the meeting…", done: "Want me to put this in the Project X note?" },
      { id: "achar", label: "Find and remember", ask: "Where did I mention the Project X deadline?", working: "Searching the notes…", done: "Found it, in the Schedule note:" },
    ],
    noteTitle: "This week's notes",
    messy: ["mtg w/ ana tues", "review budget before fri", "call the supplier!!", "idea: monthly newsletter", "ana asked for the report"],
    tidy: [
      { kind: "h", text: "Meeting with Ana (Tuesday)" },
      { kind: "li", text: "Review the budget before Friday" },
      { kind: "li", text: "Send the report to Ana" },
      { kind: "h", text: "Tasks" },
      { kind: "todo", text: "Call the supplier" },
      { kind: "h", text: "Ideas" },
      { kind: "li", text: "Monthly newsletter" },
    ],
    folder: { name: "Trip", before: ["itinerary.md", "hotel.md"], created: "trip-expenses.csv" },
    sheet: [
      ["Item", "Amount"],
      ["Flights", "$920"],
      ["Hotel (3 nights)", "$480"],
      ["Food", "$310"],
      ["Total", "$1,710"],
    ],
    meeting: { title: "Project X meeting", length: "32 min", ended: "ended" },
    proposal: {
      to: "To the note",
      note: "Project X",
      summaryTitle: "Summary",
      summary: ["Delivery moves to March 12.", "Bruno reviews the layout by Thursday."],
      todosTitle: "Tasks",
      todos: ["Send the new schedule to the team"],
      approve: "Add to note",
      dismiss: "Not now",
    },
    found: {
      path: "Project X › Schedule",
      before: "In Monday's conversation, ",
      hit: "the deadline moved to March 12",
      after: ", with the review the week before.",
      alsoTitle: "Also mentions the deadline:",
      also: ["Project X › Meetings", "Project X › Ideas"],
      searching: ["Project X › Ideas", "Project X › Schedule", "Project X › Meetings"],
    },
    listening: "Listening…",
    meetingEnded: "The meeting ended.",
    dots: "Examples",
    dot: (n, total, label) => `Example ${n} of ${total}: ${label}`,
  },
};

/** O que a tela encena, na língua do app. */
export const showcase = (): ShowcaseContent => SHOWCASE[appLocale().locale];

// A linha do tempo de um exemplo, em ms. O pedido é digitado letra a letra, o Kiwi trabalha, o resultado aparece e
// fica um tempo na tela antes do próximo.
export const TYPE_MS = 38;
export const PAUSE_MS = 500;
export const WORK_MS = 1400;
export const HOLD_MS = 3800;

export type Phase = "pedido" | "trabalhando" | "resultado";
export type Scene = { index: number; phase: Phase; typed: number; ask: string | null };

const askMs = (e: Example) => (e.ask ? e.ask.length * TYPE_MS + PAUSE_MS : PAUSE_MS);
/** Quanto um exemplo dura, do pedido ao fim do resultado. */
export const exampleMs = (e: Example) => askMs(e) + WORK_MS + HOLD_MS;

/** O que a tela mostra `ms` depois de o exemplo `index` começar. Depois do fim, o resultado fica. */
export function sceneAt(index: number, ms: number): Scene {
  const e = showcase().examples[index]!;
  const ask = e.ask;
  if (ms < askMs(e)) return { index, phase: "pedido", typed: ask ? Math.min(ask.length, Math.floor(ms / TYPE_MS)) : 0, ask };
  if (ms < askMs(e) + WORK_MS) return { index, phase: "trabalhando", typed: ask?.length ?? 0, ask };
  return { index, phase: "resultado", typed: ask?.length ?? 0, ask };
}

/** A cena parada de um exemplo (Reduzir movimento, ou a pessoa escolheu pelos pontos sem animação): o resultado. */
export const stillScene = (index: number): Scene => sceneAt(index, exampleMs(showcase().examples[index]!));

/** O próximo exemplo, voltando ao primeiro depois do último. */
export const nextIndex = (index: number) => (index + 1) % showcase().examples.length;

/** O estado do gato em cada fase: ouve o pedido, pensa, mostra que terminou. */
export const catState = (phase: Phase): "ouvindo" | "thinking" | "pronto" =>
  phase === "pedido" ? "ouvindo" : phase === "trabalhando" ? "thinking" : "pronto";

/** O texto do ponto, para o leitor de tela. */
export const dotLabel = (index: number) => {
  const c = showcase();
  return c.dot(index + 1, c.examples.length, c.examples[index]!.label);
};
