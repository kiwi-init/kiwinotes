// Os 30 pedidos de exemplo da bateria da Bússola (ADR 0013, T13702), cada um com o alvo certo anotado e uma versão
// "falada": o mesmo pedido como o ditado entrega, com os erros nos nomes próprios. Os alvos estão na pasta falsa
// (`pasta-grande.ts`). O registro do harry não tem escrita, então a bateria tem: acrescentar, trocar um trecho e
// organizar uma nota.

import { ULTIMA_REUNIAO } from "./pasta-grande.ts";

export type TipoPedido = "nome" | "pasta" | "projeto" | "essa nota" | "última reunião" | "aberta" | "acrescentar" | "trocar trecho" | "organizar";

export interface Pedido {
  id: number;
  tipo: TipoPedido;
  /** O pedido como a pessoa digitaria. */
  texto: string;
  /** O mesmo pedido como o ditado entrega, com o nome errado. */
  falado: string;
  /** O nome que o agente procura (o que aparece no pedido), digitado e falado. */
  nome: string;
  nomeFalado: string;
  /** O alvo certo: o caminho da nota, ou a pasta (no tipo pasta e no projeto). */
  alvo: string;
  /** A seção, quando o pedido fala de uma. */
  secao?: string;
  /** Na nota aberta ("essa nota"): o caminho que o app tem aberto. */
  aberta?: string;
}

const P = (id: number, tipo: TipoPedido, texto: string, falado: string, nome: string, nomeFalado: string, alvo: string, extra: Partial<Pedido> = {}): Pedido => ({
  id, tipo, texto, falado, nome, nomeFalado, alvo, ...extra,
});

export const PEDIDOS: Pedido[] = [
  // Achar uma nota pelo nome.
  P(1, "nome", "Qual é o prazo no Plano de Mudança do Legacy PR?", "Qual é o prazo no plano de mudança do legasi pê erre?", "Plano de Mudança", "plano de mudança legasi", "Projetos/Legacy PR/Plano de Mudança.md", { secao: "Prazo" }),
  P(2, "nome", "Quais são as pendências do Relatório Q1?", "Quais são as pendências do relatório quê um?", "Relatório Q1", "relatório quê um", "Projetos/Portal Clientes/Relatório Q1.md", { secao: "Pendências" }),
  P(3, "nome", "O que diz a nota relatorio-q1-final?", "O que diz a nota relatório quê um final?", "relatorio-q1-final", "relatório quê um final", "Projetos/Portal Clientes/relatorio-q1-final.md"),
  P(4, "nome", "Abre o rascunho do Relatório Q1 e me diz o que falta conferir.", "Abre o rascunho do relatório quê um e me diz o que falta conferir.", "Relatório Q1 rascunho", "relatório quê um rascunho", "Projetos/Portal Clientes/Relatório Q1 rascunho.txt"),
  P(5, "nome", "Quais são as exceções nas regras de arquivamento?", "Quais são as exceções nas regras de arquivamentu?", "regras de arquivamento", "regras de arquivamentu", "Projetos/Projeto Atlas/Regras.md", { secao: "Exceções" }),
  P(6, "nome", "O que tem na minha Lista de compras?", "O que tem na minha lista de compra?", "Lista de compras", "lista de compra", "Pessoal/Lista de compras.md"),
  // Pela pasta.
  P(7, "pasta", "O que tem na pasta do Legacy PR?", "O que tem na pasta do legasi pê erre?", "Legacy PR", "legasi pê erre", "Projetos/Legacy PR"),
  P(8, "pasta", "Lista as notas da pasta Pessoal.", "Lista as notas da pasta pessoal.", "Pessoal", "pessoal", "Pessoal"),
  P(9, "pasta", "Quais notas tem em Estudos de Fotografia?", "Quais notas tem em estudos de fotô grafia?", "Fotografia", "fotô grafia", "Estudos/Fotografia"),
  P(10, "pasta", "O que tem na pasta Trabalho?", "O que tem na pasta trabalho?", "Trabalho", "trabalho", "Trabalho"),
  // Pelo projeto.
  P(11, "projeto", "Como está o projeto Portal Clientes?", "Como está o projeto portau clientis?", "Portal Clientes", "portau clientis", "Projetos/Portal Clientes"),
  P(12, "projeto", "Quais os próximos passos do Projeto Atlas?", "Quais os próximos passos do projeto átlas?", "Projeto Atlas", "projeto átlas", "Projetos/Projeto Atlas"),
  P(13, "projeto", "Resume o andamento da Mudança Beta.", "Resume o andamento da mudansa bêta.", "Mudança Beta", "mudansa bêta", "Projetos/Mudança Beta"),
  P(14, "projeto", "Em que pé está a Rede Norte?", "Em que pé está a rêde nórti?", "Rede Norte", "rêde nórti", "Projetos/Rede Norte"),
  // A nota aberta.
  P(15, "essa nota", "Resume essa nota.", "Resume essa nota.", "", "", "Trabalho/Rotina da equipe.md", { aberta: "Trabalho/Rotina da equipe.md" }),
  P(16, "essa nota", "Quais os ramais que estão aqui?", "Quais os ramais que estão aqui?", "", "", "Trabalho/Contatos do escritório.md", { aberta: "Trabalho/Contatos do escritório.md" }),
  P(17, "essa nota", "O que eu anotei no módulo 2 dessa nota?", "O que eu anotei no módulo dois dessa nota?", "", "", "Estudos/Fotografia/Anotações do curso.md", { aberta: "Estudos/Fotografia/Anotações do curso.md", secao: "Módulo 2" }),
  // A última reunião.
  P(18, "última reunião", "O que foi decidido na última reunião?", "O que foi decidido na última reunião?", "", "", ULTIMA_REUNIAO),
  P(19, "última reunião", "Quem participou da última reunião?", "Quem participou da última reunião?", "", "", ULTIMA_REUNIAO),
  P(20, "última reunião", "Me dá os pontos da reunião de ontem.", "Me dá os pontos da reunião de ontem.", "", "", ULTIMA_REUNIAO),
  // Pergunta aberta, sem alvo nomeado.
  P(21, "aberta", "Onde eu anotei as ideias do gato?", "Onde eu anotei as ideias do gato?", "ideias do gato", "ideias do gato", "Projetos/Kiwi Notes/Ideias do gato.md"),
  P(22, "aberta", "Quando é a reunião de planejamento da equipe?", "Quando é a reunião de planejamento da equipe?", "reunião de planejamento", "reunião de planejamento", "Trabalho/Rotina da equipe.md"),
  P(23, "aberta", "Pra onde eu queria viajar?", "Pra onde eu queria viajar?", "viagem", "viagem", "Pessoal/Ideias de viagem.txt"),
  // Escritas: acrescentar.
  P(24, "acrescentar", "Acrescenta leite na Lista de compras.", "Acrescenta leite na lista de compra.", "Lista de compras", "lista de compra", "Pessoal/Lista de compras.md"),
  P(25, "acrescentar", "Põe nas pendências do Relatório Q1: conferir o backup.", "Põe nas pendências do relatório quê um: conferir o backup.", "Relatório Q1", "relatório quê um", "Projetos/Portal Clientes/Relatório Q1.md", { secao: "Pendências" }),
  P(26, "acrescentar", "Anota no Plano de Mudança do Legacy PR um risco novo: o link do escritório cai.", "Anota no plano de mudança do legasi pê erre um risco novo: o link do escritório cai.", "Plano de Mudança", "plano de mudança legasi", "Projetos/Legacy PR/Plano de Mudança.md", { secao: "Riscos" }),
  // Escritas: trocar um trecho.
  P(27, "trocar trecho", "Troca o prazo do Plano de Mudança do Legacy PR para abril de 2027.", "Troca o prazo do plano de mudança do legasi pê erre para abril de dois mil e vinte e sete.", "Plano de Mudança", "plano de mudança legasi", "Projetos/Legacy PR/Plano de Mudança.md", { secao: "Prazo" }),
  P(28, "trocar trecho", "Muda o ramal da TI nos Contatos do escritório para 2041.", "Muda o ramal da tê i nos contatos do escritório para dois zero quatro um.", "Contatos do escritório", "contatos do escritório", "Trabalho/Contatos do escritório.md"),
  // Escritas: organizar uma nota.
  P(29, "organizar", "Organiza as Anotações do curso de Fotografia em tópicos.", "Organiza as anotações do curso de fotô grafia em tópicos.", "Anotações do curso", "anotações do curso fotô grafia", "Estudos/Fotografia/Anotações do curso.md"),
  P(30, "organizar", "Organiza a Rotina da equipe por dia da semana, com títulos.", "Organiza a rotina da equipe por dia da semana, com títulos.", "Rotina da equipe", "rotina da equipe", "Trabalho/Rotina da equipe.md"),
];
