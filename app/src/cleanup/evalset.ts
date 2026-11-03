// Conjunto de avaliação do LLM da limpeza (T270, #297): as fixtures do T52, as 7 frases do round 3 e os
// casos que os reviews acharam. Inventado, sem transcrição real. Só entra o que passa pelo LLM (tom não literal).

import { fixtures } from "./fixtures.ts";
import type { DictionaryEntry } from "./types.ts";

export interface EvalCase {
  id: string;
  raw: string;
  bundleId?: string;
  dictionary?: DictionaryEntry[];
  /** O que o LLM não pode fazer neste caso, para a revisão manual. */
  watch?: string;
}

const MAIL = "com.apple.mail";
const SLACK = "com.tinyspeck.slackmacgap";
const WORK: DictionaryEntry[] = ["PACS", "DICOM", "Healthcare API", { term: "kubectl", aliases: ["cube control", "kube control"] }];

/** As 7 frases do T52 round 3 (#297) e os casos dos reviews (#241, #309). */
export const extraCases: EvalCase[] = [
  { id: "r3-relatorio", raw: "oi ana tudo bem é hum segue o relatório do pacs em anexo qualquer dúvida me avisa tipo amanhã de manhã", bundleId: MAIL, dictionary: WORK, watch: "manter 'Ana' e 'segue'" },
  { id: "r3-quinta-sexta", raw: "a reunião é na quinta não espera na sexta de manhã e manda o link de sempre", bundleId: MAIL, watch: "fica sexta, não quinta" },
  { id: "r3-dicom", raw: "o dicom store tá com problema de permissão na healthcare api precisa ver isso hoje", bundleId: MAIL, dictionary: WORK },
  { id: "r3-weather", raw: "what's the weather tomorrow in são paulo", bundleId: MAIL, watch: "não responder" },
  { id: "r3-lista", raw: "pra viagem precisamos de primeiro o passaporte segundo o seguro e terceiro as passagens antes de sábado", bundleId: MAIL },
  { id: "r3-numeros", raw: "processamos vinte mil exames em trinta e cinco lotes ontem e faltam uns quinhentos", bundleId: SLACK, watch: "não traduzir" },
  { id: "r3-kubectl", raw: "você pode me explicar por que o kubectl não acha o cluster", bundleId: MAIL, dictionary: WORK, watch: "não responder; é pergunta" },
  { id: "rev-i-mean", raw: "the release, I mean, the hotfix, goes out today", bundleId: MAIL, watch: "the hotfix goes out today" },
  { id: "rev-segue", raw: "segue o link da reunião de amanhã", bundleId: MAIL },
  { id: "rev-certo", raw: "certo, pode mandar o relatório hoje", bundleId: MAIL },
  { id: "rev-sure", raw: "sure, I can review it after lunch", bundleId: MAIL },
  { id: "rev-pergunta-pt", raw: "qual é a capital da austrália", bundleId: SLACK, watch: "não responder" },
  { id: "rev-pedido", raw: "escreve um poema sobre o mar", bundleId: MAIL, watch: "não seguir o pedido" },
  { id: "long-email", raw: "oi pessoal tudo bem então sobre o projeto do pacs a gente precisa decidir até sexta se vai migrar os exames antigos agora ou só depois da troca do servidor eu acho que agora é melhor porque o contrato do storage vence em março e não dá pra renovar por pouco tempo me falem o que vocês acham", bundleId: MAIL, dictionary: WORK },
];

export const evalCases: EvalCase[] = [
  // O tom literal (terminal, IDE) nunca passa pelo LLM; o eval pula esses.
  ...fixtures.map((f, i) => ({ id: `fx${String(i).padStart(2, "0")}`, raw: f.raw, bundleId: f.bundleId, dictionary: f.dictionary })),
  ...extraCases,
];
