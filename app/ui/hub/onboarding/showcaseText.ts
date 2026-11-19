// A tela do que o Kiwi faz (T20838, spec #20828): os 4 exemplos encenados, com dados inventados, e a linha do tempo de
// cada um. Nada aqui chama o agente: é texto e tempo. Cada exemplo corresponde a uma função que o agente já tem
// (escrever na nota, criar arquivo, a proposta depois da reunião, a busca).
//
// Nas telas do mascote, o nome dele é **Kiwi** (#20828); "Kiwi Cat" fica para os Ajustes.

export const SHOWCASE_TITLE = "O que o Kiwi faz por você";
export const SHOWCASE_HINT = "Peça com a voz ou escrevendo. Ele trabalha nas suas notas, aqui no seu Mac.";
export const SHOWCASE_STAGED = "Exemplos encenados, com notas de mentira.";

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

export const EXAMPLES: readonly Example[] = [
  {
    id: "organizar",
    label: "Organizar uma nota",
    ask: "Organiza essa nota.",
    working: "Organizando…",
    done: "Pronto: títulos, tópicos e as tarefas separadas.",
  },
  {
    id: "documento",
    label: "Gerar um documento",
    ask: "Monta uma planilha com os gastos da viagem.",
    working: "Criando a planilha…",
    done: "Criei gastos-viagem.csv na pasta Viagem.",
  },
  {
    id: "reuniao",
    label: "Resumir uma reunião",
    ask: null,
    working: "Resumindo a reunião…",
    done: "Quer que eu ponha isto na nota do Projeto X?",
  },
  {
    id: "achar",
    label: "Achar e lembrar",
    ask: "Onde eu falei do prazo do Projeto X?",
    working: "Procurando nas notas…",
    done: "Achei, na nota Cronograma:",
  },
];

/** A nota bagunçada do exemplo 1, e ela organizada. */
export const MESSY_NOTE = [
  "reuniao c/ ana terça",
  "revisar orçamento antes de sexta",
  "ligar pro fornecedor!!",
  "ideia: newsletter mensal",
  "ana pediu o relatório",
];
export const TIDY_NOTE: readonly { kind: "h" | "li" | "todo"; text: string }[] = [
  { kind: "h", text: "Reunião com a Ana (terça)" },
  { kind: "li", text: "Revisar o orçamento antes de sexta" },
  { kind: "li", text: "Enviar o relatório para a Ana" },
  { kind: "h", text: "Tarefas" },
  { kind: "todo", text: "Ligar para o fornecedor" },
  { kind: "h", text: "Ideias" },
  { kind: "li", text: "Newsletter mensal" },
];

/** A pasta e a planilha do exemplo 2. */
export const FOLDER = { name: "Viagem", before: ["roteiro.md", "hotel.md"], created: "gastos-viagem.csv" };
export const SHEET: readonly (readonly string[])[] = [
  ["Item", "Valor"],
  ["Passagens", "R$ 920"],
  ["Hotel (3 noites)", "R$ 480"],
  ["Comida", "R$ 310"],
  ["Total", "R$ 1.710"],
];

/** A reunião do exemplo 3 e a proposta. */
export const MEETING = { title: "Reunião do Projeto X", length: "32 min" };
export const PROPOSAL = {
  note: "Projeto X",
  summary: ["A entrega passa para 12 de março.", "Bruno revisa o layout até quinta."],
  todos: ["Mandar o cronograma novo para o time"],
  approve: "Pôr na nota",
  dismiss: "Agora não",
};

/** A busca do exemplo 4. */
export const FOUND = {
  path: "Projeto X › Cronograma",
  before: "Na conversa de segunda, ",
  hit: "o prazo ficou para 12 de março",
  after: ", com a revisão na semana anterior.",
  also: ["Projeto X › Reuniões", "Projeto X › Ideias"],
};

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
  const e = EXAMPLES[index]!;
  const ask = e.ask;
  if (ms < askMs(e)) return { index, phase: "pedido", typed: ask ? Math.min(ask.length, Math.floor(ms / TYPE_MS)) : 0, ask };
  if (ms < askMs(e) + WORK_MS) return { index, phase: "trabalhando", typed: ask?.length ?? 0, ask };
  return { index, phase: "resultado", typed: ask?.length ?? 0, ask };
}

/** A cena parada de um exemplo (Reduzir movimento, ou a pessoa escolheu pelos pontos sem animação): o resultado. */
export const stillScene = (index: number): Scene => sceneAt(index, exampleMs(EXAMPLES[index]!));

/** O próximo exemplo, voltando ao primeiro depois do último. */
export const nextIndex = (index: number) => (index + 1) % EXAMPLES.length;

/** O estado do gato em cada fase: ouve o pedido, pensa, mostra que terminou. */
export const catState = (phase: Phase): "ouvindo" | "thinking" | "pronto" =>
  phase === "pedido" ? "ouvindo" : phase === "trabalhando" ? "thinking" : "pronto";

/** O texto do ponto, para o leitor de tela. */
export const dotLabel = (index: number) => `Exemplo ${index + 1} de ${EXAMPLES.length}: ${EXAMPLES[index]!.label}`;
