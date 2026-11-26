// As falas do laboratório (spec #30991): todas inventadas, do jeito que o gato responde. Respostas curtas, números,
// datas, siglas, uma mista de pt com en e uma com um token falso de exemplo (que o filtro tem de tirar).

import type { Lang } from "./provider.ts";

export interface Fala {
  id: string;
  lang: Lang;
  text: string;
}

// Montado por partes: é um exemplo, e nenhum scanner deve tomá-lo por real.
const TOKEN_EXEMPLO = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";

export const FALAS: Fala[] = [
  { id: "pt01", lang: "pt-BR", text: "Achei! Era essa nota que você queria." },
  { id: "pt02", lang: "pt-BR", text: "Pronto. A nota está salva na pasta Projeto X." },
  { id: "pt03", lang: "pt-BR", text: "Hum, não achei nada com esse nome. Quer que eu procure em outra pasta?" },
  { id: "pt04", lang: "pt-BR", text: "A reunião com a Ana ficou para 12/03, às 14h30." },
  { id: "pt05", lang: "pt-BR", text: "Você tem 3 notas novas e 27 tarefas abertas, 5 delas para hoje." },
  { id: "pt06", lang: "pt-BR", text: "O resumo do PDF tem 2 partes: o orçamento de R$ 1.250,00 e o prazo de 15 dias." },
  { id: "pt07", lang: "pt-BR", text: "Juntei as anotações da semana em **uma nota só**, com os tópicos:\n- compras\n- viagem\n- estudos" },
  { id: "pt08", lang: "pt-BR", text: "Feito. Troquei o título para Ideias de jardim e movi a nota para Casa." },
  { id: "pt09", lang: "pt-BR", text: "Miau. Brincadeira: a planilha tem 120 linhas, e a coluna Total soma 4.380." },
  { id: "pt10", lang: "pt-BR", text: `Achei a chave da conta de exemplo: ${TOKEN_EXEMPLO}. Guarde num lugar seguro.` },
  { id: "en01", lang: "en-US", text: "Found it! That's the note you were looking for." },
  { id: "en02", lang: "en-US", text: "Done. Your note is saved in the Project X folder." },
  { id: "en03", lang: "en-US", text: "Hmm, nothing matches that name. Should I look in another folder?" },
  { id: "en04", lang: "en-US", text: "Your meeting with Ana moved to March 12 at 2:30 PM." },
  { id: "en05", lang: "en-US", text: "You have 3 new notes and 27 open tasks, 5 of them due today." },
  { id: "en06", lang: "en-US", text: "The PDF summary has 2 parts: the $1,250 budget and the 15-day deadline." },
  { id: "en07", lang: "en-US", text: "I merged this week's notes into **one note**, with these topics:\n- groceries\n- travel\n- study" },
  { id: "en08", lang: "en-US", text: "All set. I renamed it to Garden ideas and moved it to Home." },
  { id: "en09", lang: "en-US", text: `Here is the example key I found: ${"AKIA" + "Q7XZ3K9P2M4N8R6T"}. Keep it somewhere safe.` },
  // A mista: português com termos em inglês, como a pessoa escreve.
  { id: "mix01", lang: "pt-BR", text: "Abri o draft do roadmap e marquei o deadline da sprint como overdue." },
];
