// Conjunto de avaliação do LLM da limpeza (T270, #297): as fixtures do T52, as 7 frases do round 3, os casos que os
// reviews acharam e as frases sintéticas do T1208. Inventado, sem transcrição real. Os casos do tom literal (terminal,
// IDE) também entram, para conferir as regras, mas o `eval.ts` pula esses: nunca passam pelo LLM.

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

const NOTES = "com.apple.Notes";
const TERMINAL = "com.apple.Terminal";
const SAFARI = "com.apple.Safari";

/** As frases sintéticas do T1208 (#1227): muletas, autocorreção falada, listas e tom por app. */
export const synthCases: EvalCase[] = [
  // muletas
  { id: "s-mul1", raw: "então tipo eu tava pensando que a gente podia sabe adiantar a entrega", bundleId: SLACK },
  { id: "s-mul2", raw: "hum ahn o servidor caiu de novo e tipo ninguém viu", bundleId: SLACK },
  { id: "s-mul3", raw: "é então assim o orçamento ficou em torno de dez mil reais", bundleId: MAIL, watch: "não escrever 10,000" },
  { id: "s-mul4", raw: "um so basically we need to like ship this by friday", bundleId: SLACK },
  { id: "s-mul5", raw: "ahn bom dia a todos é hoje a pauta é o novo contrato", bundleId: MAIL },
  { id: "s-mul6", raw: "tipo assim eu não sei se vale a pena", bundleId: NOTES },
  // autocorreção falada no meio da frase
  { id: "s-ac1", raw: "manda pro joão não quer dizer pra maria o relatório", bundleId: SLACK, watch: "fica Maria" },
  { id: "s-ac2", raw: "a entrega é dia dez ou melhor dia doze", bundleId: MAIL, watch: "fica doze" },
  { id: "s-ac3", raw: "vamos usar postgres não espera mysql porque o time já conhece", bundleId: SLACK, watch: "fica mysql" },
  { id: "s-ac4", raw: "let's meet at three no wait at four", bundleId: SLACK, watch: "fica four" },
  { id: "s-ac5", raw: "o custo foi de cem reais digo duzentos reais", bundleId: MAIL, watch: "fica duzentos; não traduzir" },
  { id: "s-ac6", raw: "liga pra ela amanhã apaga isso manda um email pra ela amanhã", bundleId: NOTES, watch: "fica só o email" },
  // listas
  { id: "s-l1", raw: "as tarefas de hoje são primeiro revisar o pr segundo atualizar a doc terceiro responder o cliente", bundleId: NOTES },
  { id: "s-l2", raw: "pra festa precisamos de bolo refrigerante e copos", bundleId: MAIL },
  { id: "s-l3", raw: "first update the readme second bump the version third tag the release", bundleId: MAIL },
  { id: "s-l4", raw: "lista de compras arroz feijão nova linha café nova linha leite", bundleId: NOTES },
  // tom por app (o terminal nunca passa pelo LLM; fica para conferir que o eval pula)
  { id: "s-t1", raw: "beleza pode subir o deploy", bundleId: SLACK },
  { id: "s-t2", raw: "valeu pessoal até amanhã", bundleId: SLACK },
  { id: "s-t3", raw: "galera o pacs voltou mas o dicom store ainda tá lento então segura os envios grandes até eu confirmar que normalizou e se alguém vir erro de permissão na healthcare api me chama no privado que eu olho na hora", bundleId: SLACK, dictionary: WORK },
  { id: "s-t4", raw: "prezado carlos segue a proposta revisada aguardo seu retorno", bundleId: MAIL, watch: "manter 'segue'" },
  { id: "s-t5", raw: "olá equipe informo que o sistema ficará fora do ar sábado das oito às dez", bundleId: MAIL },
  { id: "s-t6", raw: "oi marina obrigado pelo retorno vou ver com o financeiro e te respondo até quinta", bundleId: MAIL, watch: "manter Marina e quinta" },
  { id: "s-t7", raw: "git commit menos m corrige login", bundleId: TERMINAL },
  { id: "s-t8", raw: "cube control get pods menos n pacs", bundleId: TERMINAL, dictionary: WORK },
  { id: "s-t9", raw: "como configurar o dicom store no google cloud", bundleId: SAFARI, dictionary: WORK },
];

export const evalCases: EvalCase[] = [
  // O tom literal (terminal, IDE) nunca passa pelo LLM; o eval pula esses.
  ...fixtures.map((f, i) => ({ id: `fx${String(i).padStart(2, "0")}`, raw: f.raw, bundleId: f.bundleId, dictionary: f.dictionary })),
  ...extraCases,
  ...synthCases,
];
