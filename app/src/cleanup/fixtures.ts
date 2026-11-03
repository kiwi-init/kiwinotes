// Fixtures da limpeza: cru (como o STT entrega) → esperado. Inventadas, sem transcrição real.
// O que só um LLM resolve (gramática, "tipo" sem contexto, tom reescrito) não entra aqui.

import type { DictionaryEntry, Tone } from "./types.ts";

export interface Fixture {
  name: string;
  raw: string;
  expected: string;
  bundleId?: string;
  tone?: Tone;
  dictionary?: DictionaryEntry[];
}

const SLACK = "com.tinyspeck.slackmacgap";
const MAIL = "com.apple.mail";
const TERMINAL = "com.apple.Terminal";
const GHOSTTY = "com.mitchellh.ghostty";
const SAFARI = "com.apple.Safari";
const NOTES = "com.apple.Notes";
const WORK: DictionaryEntry[] = ["DICOM", "PACS", "Healthcare API", { term: "kubectl", aliases: ["cube control", "kube control"] }, "Kiwi Notes"];
const DEV: DictionaryEntry[] = ["DICOM", "PACS", "GitHub", "Kafka"];

export const fixtures: Fixture[] = [
  // ---------------------------------------------------------------- muletas
  { name: "hesitações somem", raw: "hum, eu acho que, ahn, dá pra entregar amanhã", expected: "Eu acho que dá pra entregar amanhã." },
  { name: "é hesitante colado num hum", raw: "é hum me manda o relatório amanhã de manhã", expected: "Me manda o relatório amanhã de manhã." },
  { name: "é verbo fica", raw: "isso é importante pra gente", expected: "Isso é importante pra gente." },
  { name: "é... fica (verbo com pausa)", raw: "O problema é... complicado.", expected: "O problema é... complicado." },
  { name: "é, é repetido", raw: "é, é, vamos fazer assim então", expected: "É, vamos fazer assim então." },
  { name: "tipo muleta no meio", raw: "me manda o relatório amanhã tipo de manhã", expected: "Me manda o relatório amanhã de manhã." },
  { name: "tipo substantivo fica", raw: "que tipo de arquivo você precisa", expected: "Que tipo de arquivo você precisa?" },
  { name: "tipo assim entre vírgulas", raw: "o deploy ficou, tipo assim, bem mais lento", expected: "O deploy ficou bem mais lento." },
  { name: "tipo com vírgula no começo", raw: "Tipo, eu não sei se dá tempo.", expected: "Eu não sei se dá tempo." },
  { name: "Tipo de no começo fica", raw: "Tipo de arquivo inválido no upload.", expected: "Tipo de arquivo inválido no upload." },
  { name: "né no fim some", raw: "a reunião foi boa né", expected: "A reunião foi boa." },
  { name: "né? mantém a pergunta", raw: "você vem amanhã, né?", expected: "Você vem amanhã?" },
  { name: "então assim no começo", raw: "então assim, eu acho que o problema é de permissão", expected: "Eu acho que o problema é de permissão." },
  { name: "assim que é conjunção fica", raw: "assim que chegar eu te aviso", expected: "Assim que chegar eu te aviso." },
  { name: "sabe? no fim não vira pergunta", raw: "é difícil explicar, sabe?", expected: "É difícil explicar." },
  { name: "inglês: uh e um, you know", raw: "uh I think we should, you know, ship it on friday", expected: "I think we should ship it on friday." },
  { name: "um em português é artigo", raw: "preciso de um minuto", expected: "Preciso de um minuto." },
  { name: "gagueira", raw: "eu eu acho que que dá", expected: "Eu acho que dá." },
  { name: "ênfase repetida fica", raw: "ficou muito muito bom", expected: "Ficou muito muito bom." },

  // ---------------------------------------------------------------- autocorreções
  { name: "não, quer dizer", raw: "me encontra às três, não, quer dizer, às quatro", expected: "Me encontra às quatro." },
  { name: "não quer dizer sem vírgula", raw: "a reunião é às três não quer dizer às quatro na sala dois", expected: "A reunião é às quatro na sala dois." },
  { name: "não quer dizer que é negação", raw: "isso não quer dizer que o projeto atrasou", expected: "Isso não quer dizer que o projeto atrasou." },
  { name: "ou melhor com palavra parecida", raw: "manda pro João, ou melhor, pra Maria", expected: "Manda pra Maria." },
  { name: "digo troca a última palavra", raw: "são três, digo, quatro arquivos", expected: "São quatro arquivos." },
  { name: "eu digo sem vírgula fica", raw: "eu digo que vale a pena", expected: "Eu digo que vale a pena." },
  { name: "não espera é verbo", raw: "ele não espera ninguém", expected: "Ele não espera ninguém." },
  { name: "inglês: I mean", raw: "let's meet on monday, I mean, on tuesday", expected: "Let's meet on tuesday." },
  { name: "I mean no começo é muleta", raw: "I mean, it works fine", expected: "It works fine." },
  { name: "a correção não atravessa frase", raw: "Fechei o PR. Amanhã às nove, não, quer dizer, às dez eu reviso.", expected: "Fechei o PR. Amanhã às dez eu reviso." },
  { name: "correção logo depois do ponto do STT", raw: "Vamos marcar sexta. Não, quer dizer, segunda.", expected: "Vamos marcar segunda." },
  { name: "apaga a última frase", raw: "Manda pro time. O prazo é sexta. Apaga a última frase. O prazo é segunda.", expected: "Manda pro time. O prazo é segunda." },
  { name: "scratch that", raw: "Ship it Friday. Scratch that. Ship it Monday.", expected: "Ship it Monday." },
  { name: "apaga isso é conteúdo", raw: "Se não for usar, apaga isso.", expected: "Se não for usar, apaga isso." },
  { name: "esquece isso é conteúdo", raw: "Fechei o PR. Ah, esquece isso, já resolvi.", expected: "Fechei o PR. Ah, esquece isso, já resolvi." },
  { name: "ou melhor que é comparação", raw: "O desempenho ficou igual ou melhor que antes.", expected: "O desempenho ficou igual ou melhor que antes." },
  { name: "ou melhor ainda é ênfase", raw: "Ou melhor ainda, a gente faz isso amanhã.", expected: "Ou melhor ainda, a gente faz isso amanhã." },
  { name: "what I mean é conteúdo", raw: "That's what I mean.", expected: "That's what I mean." },

  // ---------------------------------------------------------------- comandos e listas
  { name: "nova linha e novo parágrafo", raw: "oi pessoal nova linha segue o resumo novo parágrafo abraço", expected: "Oi pessoal\nSegue o resumo\n\nAbraço." },
  { name: "novo parágrafo mantém o ponto de antes", raw: "Eu tava, hum, pensando. Novo parágrafo. A gente podia mudar a API.", expected: "Eu tava pensando.\n\nA gente podia mudar a API." },
  { name: "ordinal no meio da frase não é lista", raw: "o primeiro passo é revisar, o segundo é testar", expected: "O primeiro passo é revisar, o segundo é testar." },
  { name: "ah fica (interjeição)", raw: "ah, entendi, valeu", expected: "Ah, entendi, valeu." },
  {
    name: "lista com ordinais",
    raw: "Pra amanhã, primeiro, revisar o PR, segundo, rodar os testes, terceiro, fazer o deploy.",
    expected: "Pra amanhã:\n1. Revisar o PR\n2. Rodar os testes\n3. Fazer o deploy",
  },
  { name: "lista em inglês", raw: "first, buy milk, second, call mom", expected: "1. Buy milk\n2. Call mom" },
  { name: "segundo ele não é item", raw: "primeiro eu liguei pro suporte, segundo ele o problema é na rede", expected: "Primeiro eu liguei pro suporte, segundo ele o problema é na rede." },
  { name: "primeiro sozinho não é lista", raw: "primeiro eu vou almoçar", expected: "Primeiro eu vou almoçar." },
  { name: "primeiro de maio e segunda-feira não são lista", raw: "Primeiro de maio, segunda-feira, é feriado.", expected: "Primeiro de maio, segunda-feira, é feriado." },
  { name: "segunda é dia da semana", raw: "primeiro eu falo com o João, segunda tem reunião", expected: "Primeiro eu falo com o João, segunda tem reunião." },
  { name: "do no começo não é pergunta", raw: "do jeito que ficou tá bom", expected: "Do jeito que ficou tá bom." },

  // ---------------------------------------------------------------- pontuação
  { name: "pergunta sem pontuação do STT", raw: "quando sai o próximo release", expected: "Quando sai o próximo release?" },
  { name: "pontuação do STT é respeitada", raw: "Acho que sim. Vamos ver amanhã!", expected: "Acho que sim. Vamos ver amanhã!" },
  { name: "maiúscula depois de ponto", raw: "fechou. depois a gente vê", expected: "Fechou. Depois a gente vê." },
  { name: "i sozinho vira I", raw: "yesterday i fixed the build", expected: "Yesterday I fixed the build." },

  // ---------------------------------------------------------------- dicionário
  { name: "dicionário corrige a grafia", raw: "o dicom store do pacs tá sem acesso na healthcare api", expected: "O DICOM store do PACS tá sem acesso na Healthcare API.", dictionary: WORK },
  { name: "alias do dicionário", raw: "roda o cube control get pods", expected: "Roda o kubectl get pods.", dictionary: WORK },
  { name: "termo no começo não ganha maiúscula", raw: "kubectl tá fora do path", expected: "kubectl tá fora do path.", dictionary: WORK },
  { name: "termo com muleta no nome não some", raw: "o hum é o nosso bot", expected: "O Hum é o nosso bot.", dictionary: ["Hum"] },
  // T896 (#868): o termo só casa como palavra solta, nunca dentro de URL, caminho, e-mail, arquivo ou argumento.
  { name: "dicionário: termo no fim da frase, com ponto", raw: "o problema é o dicom.", expected: "O problema é o DICOM.", dictionary: DEV },
  { name: "dicionário: termo comum continua corrigido", raw: "vou subir no github", expected: "Vou subir no GitHub.", dictionary: DEV },
  { name: "dicionário: termo antes de dois-pontos", raw: "no github: abre um PR", expected: "No GitHub: abre um PR.", dictionary: DEV },
  { name: "terminal: argumento com a grafia do termo fica", raw: "kubectl -n pacs get pods", bundleId: TERMINAL, dictionary: DEV, expected: "kubectl -n pacs get pods" },
  { name: "ghostty: caminho fica", raw: "cd ~/projetos/pacs", bundleId: GHOSTTY, dictionary: DEV, expected: "cd ~/projetos/pacs" },
  { name: "terminal: URL do git fica", raw: "git clone git@github.com:davi/pacs.git", bundleId: TERMINAL, dictionary: DEV, expected: "git clone git@github.com:davi/pacs.git" },
  { name: "mail: e-mail fica", raw: "meu email é davi@github.com", bundleId: MAIL, dictionary: DEV, expected: "Meu email é davi@github.com." },
  { name: "safari: URL fica", raw: "abre https://github.com/davi/pacs-central", bundleId: SAFARI, dictionary: DEV, expected: "Abre https://github.com/davi/pacs-central." },
  { name: "notas: nome de arquivo fica", raw: "edita o dicom_store.py e o kafka.yaml", bundleId: NOTES, dictionary: DEV, expected: "Edita o dicom_store.py e o kafka.yaml." },
  { name: "terminal: alias vira o termo, o argumento fica", raw: "cube control get pods -n pacs", bundleId: TERMINAL, dictionary: [...DEV, ...WORK], expected: "kubectl get pods -n pacs" },
  { name: "terminal: frase corrige o termo", raw: "o pacs caiu de novo", bundleId: TERMINAL, dictionary: DEV, expected: "O PACS caiu de novo." },

  // ---------------------------------------------------------------- tom por app
  { name: "slack: uma frase sem ponto", raw: "ok chego às quatro", bundleId: SLACK, expected: "Ok chego às quatro" },
  { name: "slack: pergunta mantém o ?", raw: "você vem amanhã, né?", bundleId: SLACK, expected: "Você vem amanhã?" },
  { name: "slack: duas frases mantêm os pontos", raw: "chego às quatro. me espera", bundleId: SLACK, expected: "Chego às quatro. Me espera." },
  { name: "mail: pontuação completa", raw: "oi Ana segue o relatório em anexo", bundleId: MAIL, expected: "Oi Ana segue o relatório em anexo." },
  { name: "terminal: comando fica literal", raw: "git status", bundleId: TERMINAL, expected: "git status" },
  { name: "terminal: comando com muleta", raw: "hum git checkout main", bundleId: TERMINAL, expected: "git checkout main" },
  { name: "terminal: alias vira o comando", raw: "cube control get pods -n kiwi", bundleId: TERMINAL, dictionary: WORK, expected: "kubectl get pods -n kiwi" },
  // Como o Parakeet entrega: maiúscula e ponto de frase (T684, teste G do harry).
  { name: "terminal: comando do STT perde a maiúscula e o ponto", raw: "Git status.", bundleId: TERMINAL, expected: "git status" },
  { name: "ghostty: comando do STT perde a maiúscula e o ponto", raw: "Git checkout main.", bundleId: GHOSTTY, expected: "git checkout main" },
  { name: "terminal: comando com número", raw: "Python3 script.py.", bundleId: TERMINAL, expected: "python3 script.py" },
  { name: "terminal: alias no começo, com ponto", raw: "Cube control get pods.", bundleId: TERMINAL, dictionary: WORK, expected: "kubectl get pods" },
  { name: "terminal: sigla em maiúsculas fica", raw: "GIT status.", bundleId: TERMINAL, expected: "GIT status" },
  { name: "terminal: frase que não é comando continua frase", raw: "roda o git status", bundleId: TERMINAL, expected: "Roda o git status." },
  // Prosa em inglês para o Claude Code: comando que também começa frase só vale com outro sinal de código (#691).
  { name: "ghostty: Make sure… é frase", raw: "Make sure the tests pass.", bundleId: GHOSTTY, expected: "Make sure the tests pass." },
  { name: "terminal: Open the file… é frase", raw: "Open the file and fix the bug.", bundleId: TERMINAL, expected: "Open the file and fix the bug." },
  { name: "ghostty: Go ahead… é frase", raw: "Go ahead and run it.", bundleId: GHOSTTY, expected: "Go ahead and run it." },
  { name: "terminal: open com arquivo é comando", raw: "Open README.md.", bundleId: TERMINAL, expected: "open README.md" },
  { name: "terminal: make curto é comando", raw: "Make build.", bundleId: TERMINAL, expected: "make build" },
  { name: "terminal: echo com variável é comando", raw: "Echo $HOME.", bundleId: TERMINAL, expected: "echo $HOME" },
  { name: "terminal: prosa para o Claude Code ganha pontuação", raw: "corrige o teste que tá quebrando no ci", bundleId: TERMINAL, expected: "Corrige o teste que tá quebrando no ci." },
  { name: "terminal: prosa não vira lista", raw: "primeiro, roda os testes, segundo, abre o PR", bundleId: TERMINAL, expected: "Primeiro, roda os testes, segundo, abre o PR." },

  // ---------------------------------------------------------------- casos de borda
  { name: "vazio", raw: "", expected: "" },
  { name: "só muleta", raw: "hum", expected: "" },
  { name: "espaços e vírgulas soltas", raw: "  ok ,  vamos   nessa  ", expected: "Ok, vamos nessa." },
];
