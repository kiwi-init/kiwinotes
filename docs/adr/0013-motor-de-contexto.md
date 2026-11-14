# ADR 0013: a Bússola, o motor de contexto do Kiwi

- Status: **aceito** (T13450, spec #13435, aprovado pelo harry em #13683). As quatro decisões dele estão em #13624, #13626, #13628 e #13631.
- O nome é **Bússola** (em inglês, Compass), escolhido pelo harry no #13644.
- A revisão do #13636 (a autocrítica que o harry pediu) mudou a peça 6, criou a peça 7 e pôs a medição do peso real no PR 1. O que mudou está marcado com "revisão".
- Segue o [ADR 0011](0011-agente-e-privacidade.md) (nenhum outro modelo de IA, nem local) e o [ADR 0012](0012-host-do-agente.md) (o host e o adaptador ACP). A decisão 1 abaixo muda uma frase do 0011.
- Código: nenhum ainda. A construção é dos builders, na ordem que está no fim.

## Contexto: para onde foram os 934 mil tokens
O harry fez 18 pedidos ao agente e gastou 934 mil tokens (#13379). Ele deixou ler o registro desses pedidos. Daqui saem só números e nomes de ferramenta, nada do texto dele.

Uma **ida** é cada vez que o Claude Code chama o modelo. Um pedido simples é 1 ida. Cada ferramenta que o agente usa no meio pede mais uma, e **cada ida manda de novo tudo o que a sessão já tem**. Os 18 pedidos viraram 34 idas.

**O que cada ida carregou:**

| Parte | Tokens | % |
|---|---:|---:|
| A conversa antiga, reenviada | 603,6 mil | 64,6 |
| O peso fixo: as instruções do Claude Code e a lista de ferramentas | 293,8 mil | 31,4 |
| O que o próprio pedido juntou (buscas e leituras), reenviado nas idas seguintes | 30,5 mil | 3,3 |
| A saída: as respostas e as chamadas de ferramenta | 6,3 mil | 0,7 |

**Por que cada ida existiu:**

| Motivo | Idas | Tokens | % |
|---|---:|---:|---:|
| A ida do pedido, que existiria de qualquer jeito | 18 | 463,5 mil | 49,6 |
| Ida a mais para achar (buscar, listar pasta) | 12 | 345,6 mil | 37,0 |
| Ida a mais só por erro de leitura (caminho que não existe) | 3 | 111,1 mil | 11,9 |
| Ida a mais para ler | 1 | 14,0 mil | 1,5 |

O que os números dizem:
- **O texto achado e lido é quase nada.** Tudo o que as ferramentas devolveram nos 18 pedidos soma 24,5 mil caracteres, uns 7 mil tokens. Nota lida de verdade: uma, de 317 caracteres. Nenhuma chamada se repetiu.
- **O gasto é idas × peso de cada ida.** A sessão é uma só e nunca esvazia: cada ida carregava 8,8 mil tokens no primeiro pedido e 42,4 mil no décimo oitavo. Em uma semana de uso passaria de 100 mil por ida.
- **Achar custa idas, não texto.** A caça a uma pasta e a um `.txt` tomou 7 pedidos, 19 idas e 647 mil tokens (69 % do total), com 10 leituras que só devolveram erro.
- **Reabrir a frio reescreve tudo.** O cache do modelo dura 1 hora. Nas 4 vezes em que o agente abriu com o cache frio, a conversa antiga inteira foi escrita de novo: 76,9 mil tokens. Depois de pausas de 6 e 7 minutos, o cache ainda estava quente.
- **O peso fixo tem 8,6 mil tokens por ida:** as instruções do Claude Code (7,8 mil caracteres, feitas para programar), 13 ferramentas na lista (10,9 mil), mais 8 que o Claude Code adia mas descreve na conversa (11,2 mil) e os avisos de ambiente (uns 6 mil).

Pelo preço de API do Sonnet 5.5 (leitura de cache a 0,05 do preço, escrita de 1 hora a 2, saída a 5), a ordem muda, mas o remédio não: 73 % do custo é escrita de cache, e 56 % são as 4 aberturas a frio. O peso de cada tipo de token no limite da assinatura não é documentado; o placar abaixo mede o `/usage` antes e depois.

A hipótese do spec era o agente relendo as mesmas notas. Nestes 18 pedidos ela não apareceu. Apareceu outra coisa, maior: o agente dá passos para achar, e cada passo carrega a conversa inteira.

## O que já existe
| Ferramenta | O que faz | Por que não basta aqui |
|---|---|---|
| Repo-map do Aider | Manda em todo pedido um mapa do repositório (arquivos e símbolos), escolhido por um ranking de grafo, com teto de 1 mil tokens | É um mapa do todo, igual para qualquer pedido. Não resolve o que a pessoa citou, e o agente ainda busca |
| Índice do Cursor | Corta os arquivos em pedaços, gera embeddings na nuvem e busca pelo sentido | É um modelo de IA no meio do caminho: o ADR 0011 proíbe |
| O `@arquivo` (Claude Code, Zed, ACP) | A pessoa cita o arquivo e o texto vai junto do pedido | A pessoa precisa saber e digitar o caminho. No Kiwi ela fala |
| Cache de leitura do Claude Code | Releitura de um arquivo igual devolve "sem mudança" | Só vale para as ferramentas dele, que o Kiwi desliga. E erra depois de um resumo da conversa: diz "sem mudança" de um texto que o modelo já não tem |
| Resumo da conversa (`/compact`) e limpeza de resultados antigos | O próprio modelo resume a conversa, ou a API apaga resultados velhos | O resumo custa uma ida inteira e inventa. A limpeza invalida o cache |

O ACP já tem o que a Bússola precisa: o adaptador aceita contexto embutido no pedido (`embeddedContext`) e o entrega ao modelo como `<context ref="…">`.

## Decisão: a Bússola
**O Kiwi acha, o agente faz. E o agente não carrega bagagem: quem guarda é o Kiwi.**

A Bússola é local e não usa modelo nenhum. Ela não usa a busca pelo sentido (e5), mesmo ligada. São sete peças.

### 1. A busca antecipada: achar antes de perguntar
Antes de mandar o pedido, o Kiwi resolve no Mac o que a pessoa citou. Custa zero idas e zero tokens.
- **O índice de nomes.** Todo nome que existe na pasta de notas: pastas, títulos, apelidos (`aliases`), seções, projetos, reuniões, tags e arquivos de qualquer tipo (`.txt`, `.pdf`, `.xlsx`). Cada nome fica em quatro formas: sem acento e sem maiúscula, sem separador (espaço, `-` e `_` valem igual), pelo radical e **pelo som**.
- **O ditado conhece os nomes das notas (revisão).** Os nomes das pastas, das notas e dos projetos entram na correção do ditado, como o dicionário de hoje. O nome já chega certo no pedido, e casar pelo som fica como rede de segurança.
- **Pelo som, porque o pedido é falado.** O ditado erra nomes próprios. O Kiwi compara o que ouviu com os nomes que existem, pela pronúncia em português e em inglês. Nenhuma ferramenta de código faz isso: nelas o caminho é digitado.
- **As citações.** O Kiwi passa pelo pedido em janelas de 1 a 5 palavras e casa cada uma com o índice: igual vale mais que parecido, e um nome longo vale mais que um curto. Palavras como "pasta", "nota", "reunião", "projeto" e "planilha" dizem o tipo.
- **O que a pessoa aponta sem nomear.** "Essa nota", "aqui" e "esse projeto" viram a nota e a pasta abertas no app. "A última reunião" e "ontem" viram a reunião e as datas.
- **O contexto pesa.** A nota aberta, o projeto dela, o que esta conversa já tocou, o que mudou há pouco e as notas ligadas por `[[link]]` a essas sobem na lista.
- **As trilhas.** Quando a busca antecipada erra e o agente acaba na nota certa por outro caminho, o Kiwi guarda a ligação entre as palavras do pedido e aquela nota. Da próxima vez ela sobe. É contagem, não modelo. A pessoa vê as trilhas em Ajustes › Agente e apaga a que quiser.
- **Três resultados:** *certo* (um alvo, com folga sobre o segundo), *provável* (de 2 a 5 candidatos) ou *nada*. Os cortes saem da bateria do PR 1.

### 2. O pacote: o alvo vai junto com o pedido
- **Um cartão por alvo:** o caminho, o tipo, o tamanho, a versão, a data e o sumário, com o tamanho de cada seção. Até 300 tokens por alvo, até 5 alvos.
- **No certo, o texto vai junto.** A nota de até 6 mil caracteres vai inteira. A maior manda o sumário e a seção que casou. O agente responde na primeira ida.
- **No provável, só os cartões.** O agente escolhe e lê uma vez.
- **Uma pasta vira um resumo:** quantas notas, as subpastas, os tipos de arquivo e as notas mais prováveis. Nunca a lista inteira.
- **O cartão de instrução.** Quando o pedido pede algo raro (gerar uma planilha, propor uma reunião, criar uma rotina), as instruções daquela ferramenta vão no pacote. Assim a lista fixa de ferramentas pode ser curta (peça 6).
- **Pelo guardrail e pela Atividade.** O pacote passa pelo mesmo filtro de segredos de uma leitura, e a Atividade mostra "o Kiwi entregou" com o alvo.

### 3. As ferramentas de uma ida, para quando a busca antecipada falha
- **`find`: uma chamada só.** Devolve os alvos de qualquer tipo (nota, pasta, arquivo) já com o cartão e o trecho. Troca a sequência buscar, listar, listar, ver o sumário.
- **Erro que ensina.** Um caminho ou uma seção que não existe devolve os 3 mais parecidos, com o cartão. A chamada seguinte acerta.
- **Nome no lugar do caminho.** Toda ferramenta aceita o nome como a pessoa fala, resolvido pelo mesmo índice. O T13427 já faz isso para pastas.

### 4. O registro de entrega: nunca mandar duas vezes
- O Kiwi anota o que entregou à sessão: a nota, a versão e a seção.
- **Pediu de novo o mesmo, sem mudança:** a resposta é "já está com você, do pedido N", em 20 tokens.
- **A nota mudou:** vai só a diferença.
- **A escrita do agente atualiza o registro:** ele não relê o que acabou de escrever.
- **O registro vale enquanto o texto está na sessão.** Quando a janela fecha (peça 5), o registro dela zera. É o erro do cache do Claude Code que o Kiwi não repete, porque é o Kiwi que fecha a janela.

### 5. A janela curta: a conversa mora no Kiwi
Esta é a peça que mais economiza: a conversa antiga reenviada é 65 % do gasto.
- **A sessão do agente vira descartável.** O Kiwi guarda a conversa no Mac (o pedido, a resposta final e o que foi tocado), por 30 dias, como já guarda a Atividade.
- **Uma janela é uma sessão nova,** que começa com a **cápsula**: os 3 últimos pedidos com as respostas, cortados, e os cartões das notas tocadas, sem o texto. Até 800 tokens. O Kiwi monta a cápsula sozinho, sem modelo e sem ida.
- **A cápsula leva o mapa da pasta (revisão):** os projetos e as pastas do primeiro nível, com a contagem, em até 300 tokens. Quando a busca antecipada não acha nada, o agente já sabe onde procurar.
- **Dentro da janela, a sessão segue como hoje.** A conversa contínua do balão (#13380) acontece aqui, com a memória de verdade do agente.
- **A janela fecha quando esfriou ou engordou:** mais de 55 minutos sem ida (o cache venceu, e retomar seria reescrever tudo), ou mais de 6 mil tokens de conversa acumulada. Também fecha quando a pessoa pede uma conversa nova.
- **Nunca no meio de uma conversa.** Com o gato na tela e a conversa andando (#13380), a janela não fecha pelo tamanho: o teto vale só na próxima vez que o gato abrir.
- **O teto de 6 mil é um ajuste, e pode ir a zero (revisão).** Com o teto em zero, cada pedido é uma sessão nova com a cápsula, e a bagagem fica em 800 tokens. Isso vale a pena se a leitura de cache pesar como token cheio no limite da assinatura, e não vale se pesar pouco. O PR 1 mede esse peso antes de alguém escolher.
- **Os 10 minutos não decidem nada.** O programa pode fechar depois de 10 minutos parado, para liberar memória. Reaberto dentro da hora, ele retoma a janela, com o cache quente. Isso responde à pergunta do #13437.
- **O texto das notas nunca viaja na bagagem.** O Kiwi entrega de novo quando for preciso, pela versão.

### 6. O peso fixo menor
- **Uma ferramenta no lugar de 21 (revisão).** Uma só, `kiwi`, com quatro campos: o que fazer (achar, ler, escrever, propor, lembrar), o alvo, o texto e as opções. As 21 de hoje pesam uns 5,3 mil tokens em toda ida; uma pesa uns 400. A primeira versão deste ADR propunha cinco verbos, que ficariam em uns 1,5 mil.
- **As instruções longas** (gerar arquivo, reunião, resumo executivo, rotina) saem da lista fixa e chegam pelo cartão de instrução, só quando o pedido precisa.
- **Quem separa leitura de escrita é o Kiwi,** pelo campo "o que fazer", como hoje separa pelo nome da ferramenta. A Atividade continua mostrando cada ação.
- **A lista nunca muda no meio da sessão.** Mudar uma ferramenta invalida o cache inteiro.
- **As instruções próprias ficam para depois** (decisão 3): trocar as instruções de programador do Claude Code por instruções curtas de um assistente de notas só volta à mesa com a resposta da Anthropic (#8355).

### 7. Escrever só a diferença (revisão)
Os 18 pedidos medidos não tiveram nenhuma escrita: o agente não chegou a achar os arquivos. Num uso que dá certo, a saída pesa mais. Hoje, para organizar uma nota, o agente devolve a nota inteira, e a saída custa 5 vezes a entrada.
- **A versão vem no cartão.** O agente escreve sem ler antes: a ida da leitura some.
- **Trocar um trecho, não a nota.** A escrita aceita "troque este trecho por este", além da seção e da nota inteira.
- **Mexer na estrutura sem reescrever.** Mover uma seção, renomear um título e juntar duas seções viram operações curtas, pelos números de seção do cartão.
- **A resposta da escrita é curta:** a versão nova e o que mudou, sem devolver o texto.

### O placar
Em Ajustes › Agente, por pedido e por dia:
- as idas, e os tokens em cinco partes: **pedido** (o que a pessoa pediu, o alvo entregue e a resposta), **achar**, **ler**, **bagagem** e **fixo**;
- quantas vezes o Kiwi achou o alvo de primeira;
- **quanto do limite de 5 horas o dia gastou,** pelo `/usage` do próprio Claude Code, lido antes e depois. Com o tempo, o Kiwi descobre quanto cada tipo de token pesa de verdade no limite.

Fica só no Mac. O mockup está em `docs/evidence/T13450/placar.webp`.

## Um pedido, antes e depois
O 15º pedido do registro, só em números.

| | Hoje | Com a Bússola |
|---|---|---|
| O que acontece | 4 idas: 5 leituras de arquivo, todas com erro, e 1 busca | 1 ida: o pacote já leva a nota |
| O que cada ida carrega | 35 a 37 mil tokens | uns 6 mil: o fixo, a cápsula, o pacote e o pedido |
| Total | 144,6 mil tokens | uns 7 mil (estimativa) |

O desenho está em `docs/evidence/T13450/antes-e-depois.webp`.

## As metas medidas
O PR 1 monta a bateria: uma pasta falsa de 20 mil notas, 30 pedidos (cada um também na versão "falada", com os erros do ditado) e um simulador de idas com o agente falso. O simulador precisa reproduzir os 934 mil do harry com até 15 % de erro, repetindo a mesma sequência de chamadas. Só então os números de depois valem.

| Meta | Hoje (os 18 pedidos) | Alvo |
|---|---|---|
| Idas por pedido | 1,9 (3,0 nos pedidos que usam notas) | 1 em 90 % dos pedidos de leitura; 2 nos de escrita |
| Tokens em idas que só servem para achar ou errar | 48,9 % | até 10 % |
| A busca antecipada acerta o alvo | não existe | o 1º em 85 % dos pedidos, entre os 5 em 97 % |
| Bagagem no começo de um pedido | até 33,8 mil tokens | até 6 mil (o teto da janela); 800 depois de uma pausa longa |
| Peso fixo por ida | 8,6 mil tokens | até 4 mil, com a ferramenta única |
| Saída numa escrita | a nota inteira | só o trecho mudado |
| Nota sem mudança mandada inteira de novo | sem controle | zero |
| Os mesmos 18 pedidos, refeitos | 934 mil | até 160 mil (−83 %); uns 115 mil (−88 %) com o teto da janela em zero (estimativa) |

**Sobre os "90 % a 99 % dos tokens no pedido".** Em tokens brutos, isso não é possível com o Claude Code: as instruções e as ferramentas dele vão em toda ida, e a janela guarda a conversa recente. O que a Bússola entrega:
- achar e errar caem de 49 % para até 10 %;
- o mesmo uso gasta um sexto dos tokens. O piso com o Claude Code intacto é um décimo: 1 ida por pedido, só com as instruções dele, o pedido e a resposta;
- pelo preço de API, a parte do pedido (o texto novo e a resposta) passa de 14 % para uns 60 % do custo (estimativa). O resto é abrir a frio, que só cai mais com as instruções próprias (decisão 3).

## As decisões do harry
1. **O que o Kiwi pode mandar sem o agente pedir. Decidido: A (#13624).** Hoje o ADR 0011 diz que vão os trechos que o agente lê. O pacote manda o que o índice achou.
   - **A (escolhida):** o cartão e, no certo, o texto do alvo. 1 ida.
   - B: só os cartões (nomes e sumário), nunca o texto. 2 idas.
   - C: nada: só as ferramentas melhores. De 2 a 3 idas.

   Com a A, o ADR 0011 e a tela "o que vai para o agente" ganham a frase: "e o que o Kiwi achou nas suas notas sobre o pedido". Essa mudança entra no PR que construir o pacote.
2. **A memória da conversa. Decidido: A (#13626).**
   - **A (escolhida):** a janela curta com a cápsula.
   - B: retomar sempre a sessão inteira, como hoje.
   - C: sessão nova depois de 10 minutos, sem cápsula: o agente esquece a conversa.
3. **As instruções do agente. Decidido: A (#13628).**
   - **A (escolhida):** manter as do Claude Code e enxugar só as ferramentas. Peso fixo de uns 5 mil; com a ferramenta única da revisão, uns 4 mil.
   - B: instruções próprias do Kiwi, pela opção oficial `systemPrompt` do adaptador. Peso fixo de uns 3,5 mil. Fica para depois da resposta da Anthropic sobre a assinatura (#8355).
4. **As trilhas. Decidido: A (#13631).**
   - **A (escolhida):** ligadas, visíveis e apagáveis em Ajustes › Agente.
   - B: desligadas.

## A ordem da construção
Cada item é um PR dos builders, com o antes e o depois medidos na bateria.
1. **A bateria e o simulador de idas** (o PR 1 do spec), com o registro do harry reproduzido. E **o peso real de cada tipo de token** (revisão): o Kiwi guarda o `/usage` antes e depois de cada pedido, para a conta do limite sair do uso de verdade.
2. **A janela curta e a cápsula** (peça 5): o maior ganho, e não depende do índice.
3. **O erro que ensina e o `find`** (peça 3), por cima do T13427.
4. **A busca antecipada e o pacote** (peças 1 e 2), com a mudança do ADR 0011 e da tela.
5. **A ferramenta única e o cartão de instrução** (peça 6) e **a escrita pela diferença** (peça 7).
6. **O placar.**
7. **O registro de entrega** (peça 4) e **as trilhas.**

## Uma ideia a provar: o fim antecipado
Depois de uma escrita, o agente faz mais uma ida só para dizer "pronto". O Kiwi poderia mostrar a frase final que veio junto da escrita e encerrar o pedido ali, sem essa ida. Isso depende de como o Claude Code reage a um pedido encerrado no meio, e só o harry testa o agente de verdade. Fica fora das metas até uma prova.

## Os riscos
- **A ferramenta única pode gerar mais erro de chamada** que 21 ferramentas com o formato de cada uma. O erro que ensina cobre isso, e a bateria conta as idas por erro. Se passar de 5 % das chamadas, voltam os cinco verbos.
- **A amostra é pequena e sem escrita:** 18 pedidos de um dia, 7 deles com resposta de menos de 30 tokens (171 mil tokens, 18 % do total). A bateria do PR 1 tem de incluir pedidos que escrevem.
- **A busca antecipada erra com certeza.** O agente trabalharia na nota errada. O corte do "certo" sai da bateria, o pacote diz qual nota mandou, e a escrita continua com a versão conferida e o Desfazer.
- **A cápsula perde o detalhe de uma conversa longa.** Dentro da janela nada se perde. Entre janelas ficam os 3 últimos pedidos e as notas tocadas.
- **Os números de depois são estimativa** até o PR 1. A prova final é o harry usando a rc e vendo o placar.
- **O limite da assinatura** pode pesar os tokens de outro jeito. As idas e a bagagem caem em qualquer conta.
