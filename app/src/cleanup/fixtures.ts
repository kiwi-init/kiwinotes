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
  // T1955: "like" de muleta sem vírgula sai; o verbo e a comparação ficam.
  { name: "inglês: like de muleta antes de intensificador", raw: "it was like really fast", expected: "It was really fast." },
  { name: "inglês: it's like so", raw: "it's like so much better now", expected: "It's so much better now." },
  { name: "inglês: like verbo fica", raw: "I like this approach", expected: "I like this approach." },
  { name: "inglês: I'd like really é verbo", raw: "I'd like really hot coffee", expected: "I'd like really hot coffee." },
  { name: "inglês: looks like é comparação", raw: "it looks like rain today", expected: "It looks like rain today." },
  { name: "inglês: is like com substantivo é comparação", raw: "this is like a puzzle", expected: "This is like a puzzle." },
  { name: "inglês: like antes de número fica (é aproximação)", raw: "it was like 5 minutes", expected: "It was like 5 minutes." },
  // T1955: repetição de ênfase fica; gagueira sai.
  { name: "já já fica", raw: "te mando o link já já", expected: "Te mando o link já já." },
  { name: "logo logo fica", raw: "logo logo a gente resolve", expected: "Logo logo a gente resolve." },
  { name: "não não fica", raw: "não não, deixa comigo", expected: "Não não, deixa comigo." },
  { name: "tchau tchau fica", raw: "tchau tchau", expected: "Tchau tchau." },
  { name: "very very fica", raw: "it was very very slow", expected: "It was very very slow." },
  { name: "gagueira no artigo sai", raw: "o o projeto atrasou", expected: "O projeto atrasou." },
  { name: "gagueira com já no meio sai", raw: "a a gente já chegou", expected: "A gente já chegou." },

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
  // T1955: com o marcador entre vírgulas, um número ou o trecho que se repete diz o que foi corrigido.
  { name: "correção com algarismo e o resto repetido", raw: "o prazo é 3 de dezembro, não, quer dizer, 5 de dezembro", expected: "O prazo é 5 de dezembro." },
  { name: "correção de número sozinho", raw: "a reunião é dia 12 às 15h, não, quer dizer, 16h", expected: "A reunião é dia 12 às 16h." },
  { name: "correção de quantidade com o substantivo", raw: "são 3 arquivos e 2 pastas, não, quer dizer, 4 pastas", expected: "São 3 arquivos e 4 pastas." },
  { name: "correção com digo e algarismo", raw: "custa 100 reais, digo, 200 reais", expected: "Custa 200 reais." },
  { name: "correção sem número nem repetição troca a última palavra", raw: "chama o Pedro, não, quer dizer, Paulo", expected: "Chama o Paulo." },
  { name: "a correção não atravessa frase", raw: "Fechei o PR. Amanhã às nove, não, quer dizer, às dez eu reviso.", expected: "Fechei o PR. Amanhã às dez eu reviso." },
  { name: "correção logo depois do ponto do STT", raw: "Vamos marcar sexta. Não, quer dizer, segunda.", expected: "Vamos marcar segunda." },
  { name: "apaga a última frase", raw: "Manda pro time. O prazo é sexta. Apaga a última frase. O prazo é segunda.", expected: "Manda pro time. O prazo é segunda." },
  { name: "scratch that", raw: "Ship it Friday. Scratch that. Ship it Monday.", expected: "Ship it Monday." },
  { name: "apaga isso é conteúdo", raw: "Se não for usar, apaga isso.", expected: "Se não for usar, apaga isso." },
  { name: "esquece isso é conteúdo", raw: "Fechei o PR. Ah, esquece isso, já resolvi.", expected: "Fechei o PR. Ah, esquece isso, já resolvi." },
  { name: "ou melhor que é comparação", raw: "O desempenho ficou igual ou melhor que antes.", expected: "O desempenho ficou igual ou melhor que antes." },
  { name: "ou melhor ainda é ênfase", raw: "Ou melhor ainda, a gente faz isso amanhã.", expected: "Ou melhor ainda, a gente faz isso amanhã." },
  { name: "what I mean é conteúdo", raw: "That's what I mean.", expected: "That's what I mean." },

  // Sem vírgula, como o STT entrega (T1229). Só vale quando o que vem depois repete uma palavra da frase.
  { name: "ou melhor sem vírgula", raw: "a entrega é dia dez ou melhor dia doze", expected: "A entrega é dia doze." },
  { name: "ou melhor sem vírgula, pro/pra", raw: "manda pro joão ou melhor pra maria o relatório", expected: "Manda pra maria o relatório." },
  { name: "ou melhor sem nada que repita fica", raw: "dá pra fazer hoje ou melhor amanhã", expected: "Dá pra fazer hoje ou melhor amanhã." },
  { name: "ou melhor sem vírgula troca no máximo 2 palavras", raw: "esse plano é bom ou melhor plano que já vi", expected: "Esse plano é bom ou melhor plano que já vi." },
  { name: "ou melhor do que é comparação", raw: "o novo ficou igual ou melhor do que o antigo", expected: "O novo ficou igual ou melhor do que o antigo." },
  { name: "digo sem vírgula", raw: "o custo foi de cem reais digo duzentos reais", expected: "O custo foi de duzentos reais." },
  { name: "digo sem vírgula com a mesma palavra", raw: "chego às três digo às quatro", expected: "Chego às quatro." },
  { name: "eu digo e aí fica", raw: "e aí eu digo e aí ele riu", expected: "E aí eu digo e aí ele riu." },
  { name: "te digo fica", raw: "como eu te digo sempre ele chega cedo", expected: "Como eu te digo sempre ele chega cedo." },
  { name: "o que eu digo fica", raw: "ele faz o que eu digo e o que eu faço", expected: "Ele faz o que eu digo e o que eu faço." },
  { name: "não espera sem vírgula", raw: "a reunião é na quinta não espera na sexta de manhã", expected: "A reunião é na sexta de manhã." },
  { name: "não espera verbo com palavra repetida fica", raw: "ele não espera ele chegar", expected: "Ele não espera ele chegar." },
  { name: "não espera que fica", raw: "o time não espera que a entrega atrase", expected: "O time não espera que a entrega atrase." },
  { name: "não espera sem nada que repita fica", raw: "vamos usar postgres não espera mysql", expected: "Vamos usar postgres não espera mysql." },
  { name: "apaga isso no meio da frase", raw: "liga pra ela amanhã apaga isso manda um email pra ela amanhã", expected: "Manda um email pra ela amanhã." },
  { name: "apaga isso do servidor fica", raw: "se não for usar apaga isso do servidor amanhã", expected: "Se não for usar apaga isso do servidor amanhã." },
  { name: "apaga isso e continua fica", raw: "terminou o teste apaga isso e me avisa", expected: "Terminou o teste apaga isso e me avisa." },
  { name: "apaga isso sem repetir fica", raw: "o arquivo velho tá na pasta apaga isso agora mesmo", expected: "O arquivo velho tá na pasta apaga isso agora mesmo." },

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
  { name: "ordinais sem nada depois não são lista", raw: "primeiro segundo terceiro", expected: "Primeiro segundo terceiro." },
  { name: "ordinais com vírgula sem nada depois não são lista", raw: "primeiro, segundo, terceiro", expected: "Primeiro, segundo, terceiro." },
  { name: "lista com um item vazio fica como foi dita", raw: "primeiro, revisar o pr, segundo, terceiro, subir", expected: "Primeiro, revisar o pr, segundo, terceiro, subir." },
  { name: "lista em inglês", raw: "first, buy milk, second, call mom", expected: "1. Buy milk\n2. Call mom" },
  { name: "segundo ele não é item", raw: "primeiro eu liguei pro suporte, segundo ele o problema é na rede", expected: "Primeiro eu liguei pro suporte, segundo ele o problema é na rede." },
  { name: "primeiro sozinho não é lista", raw: "primeiro eu vou almoçar", expected: "Primeiro eu vou almoçar." },
  { name: "primeiro de maio e segunda-feira não são lista", raw: "Primeiro de maio, segunda-feira, é feriado.", expected: "Primeiro de maio, segunda-feira, é feriado." },
  { name: "segunda é dia da semana", raw: "primeiro eu falo com o João, segunda tem reunião", expected: "Primeiro eu falo com o João, segunda tem reunião." },
  { name: "do no começo não é pergunta", raw: "do jeito que ficou tá bom", expected: "Do jeito que ficou tá bom." },
  // Sem vírgula, só com os três primeiros ordinais em sequência (T1229).
  {
    name: "lista sem vírgula",
    raw: "as tarefas de hoje são primeiro revisar o pr segundo atualizar a doc terceiro responder o cliente",
    expected: "As tarefas de hoje são:\n1. Revisar o pr\n2. Atualizar a doc\n3. Responder o cliente",
  },
  {
    name: "lista sem vírgula com artigo e e",
    raw: "pra viagem precisamos de primeiro o passaporte segundo o seguro e terceiro as passagens",
    expected: "Pra viagem precisamos de:\n1. O passaporte\n2. O seguro\n3. As passagens",
  },
  { name: "lista sem vírgula em inglês", raw: "first update the readme second bump the version third tag the release", expected: "1. Update the readme\n2. Bump the version\n3. Tag the release" },
  { name: "lista sem vírgula depois de uma linha", raw: "oi pessoal nova linha hoje tem primeiro revisar o pr segundo rodar os testes terceiro subir o deploy", expected: "Oi pessoal\nHoje tem:\n1. Revisar o pr\n2. Rodar os testes\n3. Subir o deploy" },
  { name: "ordinais em parágrafos diferentes não são lista", raw: "primeiro eu revisei o pr nova linha segundo ele tá bom terceiro dia de testes", expected: "Primeiro eu revisei o pr\nSegundo ele tá bom terceiro dia de testes." },
  { name: "dois ordinais sem vírgula não são lista", raw: "primeiro revisar o pr segundo atualizar a doc", expected: "Primeiro revisar o pr segundo atualizar a doc." },
  { name: "ordinal com substantivo não é lista", raw: "primeiro dia segundo dia terceiro dia foi tudo igual", expected: "Primeiro dia segundo dia terceiro dia foi tudo igual." },
  { name: "ordinais com artigo não são lista", raw: "o primeiro passo é revisar o segundo é testar e o terceiro é subir", expected: "O primeiro passo é revisar o segundo é testar e o terceiro é subir." },
  { name: "segundo ele no meio não é item", raw: "primeiro eu liguei segundo ele o problema é na rede terceiro dia seguido", expected: "Primeiro eu liguei segundo ele o problema é na rede terceiro dia seguido." },

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
  { name: "terminal: lista sem vírgula fica prosa", raw: "primeiro roda os testes segundo abre o pr terceiro faz o merge", bundleId: TERMINAL, expected: "Primeiro roda os testes segundo abre o pr terceiro faz o merge." },
  { name: "terminal: correção sem vírgula fica", raw: "a reunião é na quinta não espera na sexta", bundleId: TERMINAL, expected: "A reunião é na quinta não espera na sexta." },

  // ---------------------------------------------------------------- o que as regras não podem tirar (T913)
  { name: "não quer dizer verbo fica", raw: "Ele não quer dizer a verdade.", expected: "Ele não quer dizer a verdade." },
  { name: "não quer dizer verbo não vira pergunta", raw: "ele não quer dizer onde mora", expected: "Ele não quer dizer onde mora." },
  { name: "então assim que é conjunção", raw: "Então assim que chegar em casa eu te ligo.", expected: "Então assim que chegar em casa eu te ligo." },
  { name: "tipo substantivo depois de preposição", raw: "Deu erro de tipo no build.", expected: "Deu erro de tipo no build." },
  { name: "primeiro lugar é colocação, não lista", raw: "Primeiro lugar foi o Brasil, segundo lugar a Argentina.", expected: "Primeiro lugar foi o Brasil, segundo lugar a Argentina." },
  { name: "em primeiro lugar ainda é lista", raw: "em primeiro lugar, revisar o backup, em segundo lugar, subir o deploy", expected: "1. Revisar o backup\n2. Subir o deploy" },
  { name: "quando puder é pedido, não pergunta", raw: "Quando puder me manda o arquivo", expected: "Quando puder me manda o arquivo." },
  { name: "Assim, conector fica", raw: "Assim, o projeto ficou pronto.", expected: "Assim, o projeto ficou pronto." },
  { name: "repetição com vírgula e ! é ênfase", raw: "Vai, vai, vai!", expected: "Vai, vai, vai!" },
  { name: "gagueira com vírgula ainda sai", raw: "eu, eu acho que dá", expected: "Eu acho que dá." },
  { name: "ghostty: git add . fica", raw: "git add .", bundleId: GHOSTTY, expected: "git add ." },
  { name: "ghostty: cd .. fica", raw: "cd ..", bundleId: GHOSTTY, expected: "cd .." },
  { name: "ghostty: cd ../src fica", raw: "cd ../src", bundleId: GHOSTTY, expected: "cd ../src" },
  { name: "ghostty: ./gradlew fica", raw: "./gradlew build", bundleId: GHOSTTY, expected: "./gradlew build" },
  { name: "ghostty: rm -rf ./dist fica", raw: "rm -rf ./dist", bundleId: GHOSTTY, expected: "rm -rf ./dist" },
  { name: "ghostty: sudo !! fica", raw: "sudo !!", bundleId: GHOSTTY, expected: "sudo !!" },
  { name: "ghostty: comando com termo do dicionário fica", raw: "kubectl get pods .", bundleId: GHOSTTY, dictionary: ["kubectl"], expected: "kubectl get pods ." },
  { name: "terminal: docker build . com Docker no dicionário", raw: "docker build .", bundleId: TERMINAL, dictionary: ["Docker"], expected: "docker build ." },
  {
    name: "ghostty: alias do dicionário num comando",
    raw: "cube control config use-context ..",
    bundleId: GHOSTTY,
    dictionary: [{ term: "kubectl", aliases: ["cube control"] }],
    expected: "kubectl config use-context ..",
  },
  { name: "ghostty: prosa com nome de CLI é prosa", raw: "Docker tá fora do ar, reinicia ele.", bundleId: GHOSTTY, expected: "Docker tá fora do ar, reinicia ele." },
  { name: "ghostty: número de versão não é código", raw: "a versão 2.1 saiu ontem.", bundleId: GHOSTTY, expected: "A versão 2.1 saiu ontem." },
  {
    name: "dicionário: a forma falada mais longa ganha",
    raw: "kube control get pods",
    dictionary: [{ term: "kubectl", aliases: ["kube control"] }, { term: "Kubernetes", aliases: ["kube"] }],
    expected: "kubectl get pods.",
  },
  { name: "dicionário: termo sem letra é ignorado", raw: "sim, claro. e você?", dictionary: [{ term: "-", aliases: ["."] }], expected: "Sim, claro. E você?" },

  // ---------------------------------------------------------------- casos de borda
  { name: "vazio", raw: "", expected: "" },
  { name: "só muleta", raw: "hum", expected: "" },
  { name: "espaços e vírgulas soltas", raw: "  ok ,  vamos   nessa  ", expected: "Ok, vamos nessa." },
];
