// Os dados da tela de Início (spec #15728, T15839 a tela, T15847 os dados): o que a tela lê do main. A tela só
// mostra; quem junta é o main (T15847). Tudo local: nada aqui chama o agente.
//
// As horas vão em epoch ms; a tela formata ("há 12 min", "10:40", "hoje, 14:00"). Lista vazia ou `null` é um dia
// sem aquilo: a tela esconde o bloco.

/** Uma nota do vault, como a tela mostra. `path` é o que o hub abre nas Notas. */
export interface HomeNote {
  path: string;
  title: string;
  /** A pasta onde a nota está (só o último nome), para o rótulo cinza; `null` na raiz. */
  folder: string | null;
  editedAt: number;
}

/** "Continuar de onde parou": a nota editada por último, com um trecho do texto (sem markdown, até ~140 caracteres). */
export interface HomeContinue extends HomeNote {
  excerpt: string;
}

/** Um ditado de hoje. `app` é o app onde o texto entrou (o nome, não o bundle id); `null` se não se sabe. */
export interface HomeDictation {
  id: string;
  text: string;
  app: string | null;
  at: number;
}

/**
 * A última reunião gravada (não só a de hoje), nunca a que está gravando agora. `startedAt`: o `start` da nota, ou o dia
 * dela à meia-noite. `durationMin`: `null` numa nota sem `duration` (escrita à mão).
 */
export interface HomeMeeting {
  path: string;
  title: string;
  startedAt: number;
  durationMin: number | null;
  people: string[];
  /** Até 3 itens do "Resumo" da ata (ou das "Decisões", sem resumo); vazio sem ata. */
  summary: string[];
  /** A ata que o agente escreveu (a nota com `reuniao: [[…]]`), para o "Abrir a ata"; `null` sem ata. */
  minutesPath: string | null;
  /**
   * A ata está na pasta interna (a das reuniões), e não na pasta aberta: o clique abre com `internal` igual a isto.
   * `false` sem ata. A reunião (`path`) está sempre na interna; o `continue` e as `editedToday`, sempre na aberta.
   */
  minutesInternal: boolean;
}

/** Quantos itens de cada bloco a tela mostra. */
export const HOME_LIMITS = { editedToday: 5, dictationsToday: 3, summary: 3, excerpt: 140 } as const;

export interface HomeToday {
  /** A nota editada por último, fora as notas de reunião (`type: meeting`, o texto cru da gravação). */
  continue: HomeContinue | null;
  /** As notas editadas hoje (dia local), da mais nova para a mais velha, sem a do `continue` nem as de reunião. Até 5. */
  editedToday: HomeNote[];
  /** Os ditados de hoje, do mais novo para o mais velho. Até 3. */
  dictationsToday: HomeDictation[];
  lastMeeting: HomeMeeting | null;
}

// ---------------------------------------------------------------- Pendências e Semana (T15875, harry #15873)
// As outras duas telas do menu da aba Início. Também só leem os arquivos do Mac: nada de rede nem de agente.

/** Um item aberto: um `- [ ]` de uma nota, ou um próximo passo de uma ata. `line` é a linha no arquivo (0-based). */
export interface PendingItem {
  text: string;
  line: number;
}

/** As pendências de uma nota. `origin: "meeting"` é uma ata (a nota com `reuniao: [[…]]`). */
export interface PendingGroup extends HomeNote {
  origin: "meeting" | "note";
  /** A nota está na pasta das reuniões (a interna), e não na pasta aberta: o hub abre lá. */
  internal: boolean;
  items: PendingItem[];
  /** Quantos itens abertos a nota tem além dos de `items` (o limite por nota). */
  more: number;
}

export interface HomePending {
  /** As notas com algo aberto, da editada por último para a mais velha. */
  groups: PendingGroup[];
  /** Os itens abertos de todas as notas, também os que ficaram fora do limite. */
  total: { meeting: number; note: number };
}

/** Uma reunião na linha do tempo da semana. */
export interface WeekMeeting {
  path: string;
  title: string;
  startedAt: number;
  durationMin: number | null;
  /** A reunião está na pasta das reuniões (a interna), e não na pasta aberta: o hub abre lá. */
  internal: boolean;
}

/** Um dia da semana: `date` é o dia local, `YYYY-MM-DD`. */
export interface WeekDay {
  date: string;
  /** As notas editadas no dia (a última edição de cada uma), da mais nova para a mais velha. Até 6. */
  notes: HomeNote[];
  /** Quantas notas do dia ficaram fora de `notes`. */
  moreNotes: number;
  meetings: WeekMeeting[];
  dictations: number;
  words: number;
}

export interface HomeWeek {
  /** Os 7 dias até hoje, de hoje para trás. */
  days: WeekDay[];
  totals: { notes: number; meetings: number; meetingMin: number; dictations: number; words: number };
}

export const PENDING_LIMITS = { groups: 40, itemsPerGroup: 8 } as const;
export const WEEK_LIMITS = { days: 7, notesPerDay: 6 } as const;
