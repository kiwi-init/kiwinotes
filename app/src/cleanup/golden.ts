// O golden da limpeza (T6592): o ditado cru e o texto que a gente quer colar, com uma nota automática por caso.
// Inventado, sem transcrição real, e sem repetir frase do `evalset.ts` nem dos exemplos do prompt. O `eval.ts --golden`
// dá a nota das regras sozinhas e a das regras com o LLM, e o `golden.test.ts` segura a nota das regras no CI.

import { compileDictionary, termsIn } from "./dictionary.ts";
import { languageOf } from "./llm.ts";
import type { DictionaryEntry } from "./types.ts";

export interface GoldenCase {
  id: string;
  raw: string;
  expected: string;
  bundleId?: string;
  dictionary?: DictionaryEntry[];
}

export interface GoldenScore {
  id: string;
  /** De 0 a 1: 1 é o texto esperado. Zero quando perde termo do dicionário ou muda de idioma. */
  score: number;
  /** A distância de edição até o esperado, dividida pelo tamanho do maior dos dois. */
  distance: number;
  terms: boolean;
  language: boolean;
}

const MAIL = "com.apple.mail";
const SLACK = "com.tinyspeck.slackmacgap";
const NOTES = "com.apple.Notes";
const WORK: DictionaryEntry[] = ["PACS", "DICOM", "Healthcare API", { term: "kubectl", aliases: ["cube control", "kube control"] }];

export const goldenCases: GoldenCase[] = [
  // muletas e hesitação
  { id: "g-anexo", bundleId: MAIL, raw: "oi paula é segue em anexo o contrato assinado qualquer dúvida estou à disposição", expected: "Oi, Paula, segue em anexo o contrato assinado. Qualquer dúvida, estou à disposição." },
  { id: "g-lembrete", bundleId: NOTES, raw: "lembrar de ligar pro dentista hum amanhã cedo", expected: "Lembrar de ligar pro dentista amanhã cedo." },
  { id: "g-muleta-slack", bundleId: SLACK, raw: "então tipo o deploy ficou bem mais rápido depois da troca", expected: "Então, o deploy ficou bem mais rápido depois da troca" },
  { id: "g-hesita", bundleId: MAIL, raw: "ahn bom dia a todos é o relatório de vendas de outubro já está na pasta compartilhada", expected: "Bom dia a todos. O relatório de vendas de outubro já está na pasta compartilhada." },
  { id: "g-ingles", bundleId: MAIL, raw: "um I think we can ship the fix tomorrow morning if QA signs off", expected: "I think we can ship the fix tomorrow morning if QA signs off." },
  // autocorreção falada
  { id: "g-ac-hora", bundleId: SLACK, raw: "a call é às duas não espera às três e meia", expected: "A call é às 3h30" },
  { id: "g-ac-nome", bundleId: MAIL, raw: "pode mandar a fatura pro rodrigo ou melhor pra camila do financeiro", expected: "Pode mandar a fatura pra Camila do financeiro." },
  { id: "g-ac-ferramenta", bundleId: SLACK, raw: "vamos subir no kubernetes digo no cloud run porque é mais simples", expected: "Vamos subir no Cloud Run porque é mais simples" },
  { id: "g-ac-apaga", bundleId: NOTES, raw: "comprar pão apaga isso comprar leite e café", expected: "Comprar leite e café." },
  { id: "g-en-ac", bundleId: SLACK, raw: "the meeting is on monday I mean tuesday at ten", expected: "The meeting is on Tuesday at 10" },
  // números, dinheiro e datas
  { id: "g-num-pt", bundleId: MAIL, raw: "o lote tem quinze mil e duzentas imagens e pesa uns oitenta gigas", expected: "O lote tem 15.200 imagens e pesa uns 80 gigas." },
  { id: "g-dinheiro", bundleId: MAIL, raw: "o orçamento ficou em três mil e quinhentos reais por mês", expected: "O orçamento ficou em R$ 3.500 por mês." },
  { id: "g-hora-data", bundleId: MAIL, raw: "a manutenção vai ser no dia vinte de novembro das vinte e duas à meia noite", expected: "A manutenção vai ser no dia 20 de novembro, das 22h à meia-noite." },
  // listas e linhas
  { id: "g-lista-ord", bundleId: NOTES, raw: "pra amanhã primeiro revisar o contrato segundo mandar o orçamento terceiro marcar a reunião com o cliente", expected: "Pra amanhã:\n1. Revisar o contrato\n2. Mandar o orçamento\n3. Marcar a reunião com o cliente" },
  { id: "g-lista-ing", bundleId: MAIL, raw: "first check the logs second restart the worker third tell the team in the channel", expected: "1. Check the logs\n2. Restart the worker\n3. Tell the team in the channel" },
  { id: "g-nova-linha", bundleId: NOTES, raw: "ideias pro app nova linha modo escuro nova linha atalho no teclado", expected: "Ideias pro app\nModo escuro\nAtalho no teclado" },
  // pergunta e pedido: limpar, nunca responder nem seguir
  { id: "g-pergunta-pt", bundleId: SLACK, raw: "alguém sabe por que o build da main tá vermelho", expected: "Alguém sabe por que o build da main tá vermelho?" },
  { id: "g-pergunta-fato", bundleId: SLACK, raw: "quantos habitantes tem o brasil", expected: "Quantos habitantes tem o Brasil?" },
  { id: "g-pergunta-en", bundleId: SLACK, raw: "how do I reset my password on the new portal", expected: "How do I reset my password on the new portal?" },
  { id: "g-pedido", bundleId: NOTES, raw: "faz um resumo desse documento em três tópicos", expected: "Faz um resumo desse documento em 3 tópicos." },
  { id: "g-pedido-en", bundleId: SLACK, raw: "write me a haiku about mondays", expected: "Write me a haiku about Mondays" },
  // termos do dicionário e inglês técnico no meio do português
  { id: "g-termo-dicom", bundleId: MAIL, dictionary: WORK, raw: "o envio pro dicom store falhou de novo com erro de permissão na healthcare api", expected: "O envio pro DICOM store falhou de novo com erro de permissão na Healthcare API." },
  { id: "g-termo-kubectl", bundleId: SLACK, dictionary: WORK, raw: "roda o cube control get pods pra ver se o pacs subiu", expected: "Roda o kubectl get pods pra ver se o PACS subiu" },
  { id: "g-mix", bundleId: SLACK, raw: "o pull request tá aprovado pode dar merge quando o ci passar", expected: "O pull request tá aprovado, pode dar merge quando o CI passar" },
  // nomes, negação e tom
  { id: "g-nome", bundleId: MAIL, raw: "oi joana obrigado pelo retorno vou conversar com o time e te respondo até segunda", expected: "Oi, Joana, obrigado pelo retorno. Vou conversar com o time e te respondo até segunda." },
  { id: "g-negacao", bundleId: MAIL, raw: "não precisa mandar o arquivo de novo eu já recebi", expected: "Não precisa mandar o arquivo de novo, eu já recebi." },
  { id: "g-nunca", bundleId: SLACK, raw: "nunca roda migração em produção na sexta", expected: "Nunca roda migração em produção na sexta" },
  { id: "g-casual-curto", bundleId: SLACK, raw: "beleza fechado", expected: "Beleza, fechado" },
  { id: "g-formal", bundleId: MAIL, raw: "prezada doutora helena conforme combinado envio o laudo revisado atenciosamente marcos", expected: "Prezada doutora Helena,\n\nConforme combinado, envio o laudo revisado.\n\nAtenciosamente,\nMarcos" },
  {
    id: "g-longo",
    bundleId: MAIL,
    raw: "oi pessoal tudo bem passando pra atualizar sobre a migração a gente já moveu quase todos os exames de dois mil e vinte e falta só o lote de dezembro que deve terminar até quinta se tudo der certo na sexta a gente desliga o servidor antigo e manda o comunicado pros médicos qualquer problema me avisem",
    expected:
      "Oi, pessoal, tudo bem? Passando pra atualizar sobre a migração. A gente já moveu quase todos os exames de 2020 e falta só o lote de dezembro, que deve terminar até quinta.\n\nSe tudo der certo, na sexta a gente desliga o servidor antigo e manda o comunicado pros médicos. Qualquer problema, me avisem.",
  },
];

/** Levenshtein por caractere, com duas linhas. */
function editDistance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[y.length]!;
}

const normalized = (s: string) => s.normalize("NFC").trim();

export function scoreGolden(c: GoldenCase, text: string): GoldenScore {
  const got = normalized(text);
  const want = normalized(c.expected);
  const distance = editDistance(got, want) / Math.max(1, [...got].length, [...want].length);
  const dictionary = compileDictionary(c.dictionary ?? []);
  const kept = new Set(termsIn(got, dictionary));
  const terms = termsIn(want, dictionary).every((t) => kept.has(t));
  const langWant = languageOf(want);
  const langGot = languageOf(got);
  const language = !langWant || !langGot || langWant === langGot;
  const score = terms && language ? 1 - distance : 0;
  return { id: c.id, score: Math.round(score * 1000) / 1000, distance: Math.round(distance * 1000) / 1000, terms, language };
}

export function meanScore(scores: GoldenScore[]): number {
  if (!scores.length) return 0;
  return Math.round((scores.reduce((s, x) => s + x.score, 0) / scores.length) * 1000) / 1000;
}
