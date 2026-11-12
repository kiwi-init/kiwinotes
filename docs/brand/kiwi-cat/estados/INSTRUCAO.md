# Instrução para o Codex: o Kiwi-cat animado (v1, aprovada pelo harry no #7587)

## 1. O objetivo
Dar vida ao Kiwi-cat **sem mudar o gato**. É exatamente o ícone do Kiwi Notes (a v2), animado: ele pisca, olha, mexe a orelha e reage, e a névoa em volta dele se move como névoa de verdade. O nível pedido pelo harry é excepcional (#7549). Quem julga é ele.

Você cuida do visual inteiro: as imagens de referência, o roteiro, o shader da névoa e o código da animação. Os outros agentes só ligam os eventos do agente (ACP) aos estados que você entregar.

## 2. O que é fixo
- **A fonte da verdade** é `docs/brand/kiwi-cat/gerada/kiwi-cat-candidata-v2.png`, aprovada no #3732. As camadas já recortadas estão na mesma pasta: `luz.png`, `corpo.png`, `cabeca.png`, `orelha-esquerda.png`, `orelha-direita.png`, `aro.png` e `olhos.svg`. Os pivôs das orelhas e a posição dos olhos estão em `manifest.json` e `camadas.json`. Leia o `README.md` dessa pasta antes de tudo.
- **Não redesenhe o gato.** Nada de gato novo, de rabo (a v2 não tem) nem de silhueta refeita. Da outra vez, a extração por IA redesenhou as peças, e elas foram descartadas (#3736).
- **O que nunca muda:** a cabeça preta fosca, os olhos brancos e nítidos, e o aro de ciano a púrpura. **A cor do agente só tinge a névoa.**
- **A névoa é névoa.** Não é fumaça e não é blur (#7549). Ficam proibidos: partículas, `filter: blur` e `backdrop-filter` ao vivo, e formas borradas deslizando.
- **É 100% em código** (#7583). Sem Rive e sem editor de animação.

## 3. Como é desenhado
- **three.js com WebGPU dentro do WebKit** (`three/webgpu` e `three/tsl`). O próprio three.js cai para WebGL 2 quando falta WebGPU. É o mesmo jeito que o Channels desenha a cena do onboarding dele (`ui/src/meadow/meadow.ts` em `kiwi-init/channels`). **Olhe lá para ver como é feito, mas não copie o código:** a licença do Channels é AGPL, e a do Kiwi Notes é GPL.
- **Um módulo só**, em `app/ui/kiwicat/`, usado pelo gato do canto do app e pelo overlay. É isso que garante que o gato seja o mesmo nos dois lugares.
- **A névoa** é um shader de ruído em camadas (ruído fractal com distorção de domínio), iluminado por trás: mais denso e mais claro junto da silhueta, sumindo para fora, como no ícone. Ela anda no tempo e nunca repete.
- **O gato** são as camadas do ícone como texturas. Os olhos são dois círculos desenhados por código. As orelhas giram pela base, nos pivôs do `manifest.json`.
- **As entradas do módulo:**
  - `estado`: `repouso`, `dormindo`, `acordou`, `ouvindo`, `thinking`, `agindo`, `pronto` ou `erro`;
  - `voz`: de 0 a 1, o nível da voz da pessoa;
  - `cor`: qualquer cor sRGB escolhida pela pessoa para aquele agente, com piso de luminosidade;
  - `parado`: verdadeiro com o Reduzir movimento.
- **A máquina de estados** é TypeScript puro, sem tela, com `bun test`.

## 4. Os estados (do pedido do harry, #4655)
| estado | o que o gato faz |
|---|---|
| `repouso` | Pisca devagar, olha para um lado e para o outro, mexe um pouco a orelha. A névoa anda bem lenta, quase respirando. Não pode chamar a atenção. Só existe dentro do app. |
| `dormindo` | Repouso prolongado: olhos em arco para baixo, zZ subindo, orelhas relaxadas para fora e luz mínima que mantém a silhueta legível. |
| `acordou` | A reação "opa, estou ouvindo", curta, quando a pessoa aperta o atalho. No overlay, ele entra com uma animação fluida. |
| `ouvindo` | Reage à voz: a névoa acompanha o nível, com subida rápida e descida suave. |
| `thinking` | Pensando. Os olhos e a névoa mostram que ele está trabalhando por dentro. |
| `agindo` | Fazendo algo (running bash, editing note). É diferente do `thinking`. |
| `pronto` | Terminou. Uma reação curta e satisfeita, e ele volta ao repouso ou sai do overlay. |
| `erro` | Algo falhou. Uma reação clara, sem susto. |

**As cores:** uma paleta inspirada em cada agente, nunca o logo. Comece com três: a padrão (o lilás do ícone), o Claude Code (laranja) e o Codex (branco perolado, porque uma névoa preta some num gato preto).

**Adendo do harry #7709, entregue no #7713:** a cor da névoa é escolha da pessoa, por agente. Em Ajustes, cada agente pode usar a cor original do Kiwi, a cor padrão daquele agente ou uma cor personalizada. A entrada `cor` aceita qualquer cor; uma cor escura demais recebe um piso de luminosidade para não apagar a névoa. A prancha de cores inclui verde, rosa, azul e quase preto, além das três iniciais. O aro mantém sua matiz ciano a púrpura, mas seu brilho acompanha a luz da névoa, nunca ficando relativamente mais forte que na v2. Uma luz mínima mantém a cabeça e as orelhas legíveis no fundo preto.

**Decisões do harry #7718, transmitidas no #7724:**
- O `erro` usa só o rabisco (opção B). O traço se desenha aos poucos, com a ponta andando, embola e recomeça, em loop próximo de 1 s com leve tremida. Na prancha: começo, meio e embolado. A opção A sai.
- As orelhas são independentes, como as de um gato real: uma dá um tique e volta enquanto a outra fica parada; viram para o som em `ouvindo`, ficam em pé no pico de `acordou`, abrem em avião no `erro` e relaxam para fora no `dormindo`.
- A piscada é lenta, às vezes dupla. Os intervalos entre piscadas e tiques variam; não há periodicidade fixa.
- Corpo e cabeça permanecem parados e de frente. Só orelhas, olhos, símbolos e névoa se movem.
- As camadas são preparadas agora para movimento amplo: preenchimento por script só nos pixels ocultos atrás das orelhas e nas bases. Nenhum pixel visível da pose neutra muda; a composição mantém máximo ≤4/255 e média <0,5/255 fora dos olhos. A prova mostra cada orelha sozinha em −30°, −15°, 0°, +15° e +30°.

## 5. As entregas, nesta ordem
Cada entrega é uma task e um PR. **Não comece a seguinte antes do ok da anterior.**

1. **A prancha dos estados.** Para cada estado, de 1 a 3 poses de referência, sobre preto, e a névoa nas três cores. As imagens são geradas **a partir da v2**, com ela como imagem de entrada. Saída: `docs/brand/kiwi-cat/estados/prancha-estados.png`, os quadros soltos em `quadros/`, e o prompt de cada um num `.txt`, como em `gerada/prompt-v2.txt`. **O harry aprova a prancha antes de qualquer código.**
2. **O roteiro de movimento** (`docs/brand/kiwi-cat/estados/roteiro.md`): uma tabela por estado com o que mexe (os olhos, as orelhas, o aro e a névoa), a duração, a curva e como um estado passa para o outro.
3. **A névoa:** o shader com as entradas `cor`, `voz` e `estado`, só com a silhueta parada.
4. **O gato:** as camadas, os olhos, as orelhas e a máquina de estados, com todos os estados do roteiro.
5. **A prova:** os quadros e um vídeo curto de cada estado, nas três cores, e os números de desempenho.

## 6. As regras das imagens geradas
- **São só referência.** Ficam em `docs/brand/kiwi-cat/estados/` e nunca entram em `app/`.
- **Marque cada uma como referência**, não como captura da animação.
- **O movimento sai do código, não de quadros gerados.** Imagem gerada quadro a quadro muda o gato de um quadro para o outro.
- **O plano B:** se uma reação não ficar boa em código, proponha uma sequência de quadros renderizada. Ela só entra com a aprovação do harry, caso a caso.

## 7. Os critérios de aceite
1. **O gato é o do ícone.** Em `repouso`, no quadro de referência e na cor padrão, as camadas do gato batem com a v2: erro máximo de 4/255 e médio abaixo de 0,5/255 fora dos olhos. É a mesma regra do `verificacao.json`.
2. **A névoa parece o ícone no quadro de referência** e depois se move sem repetir. Em 60 s de gravação, não pode haver um ciclo visível.
3. **Não parece blur nem fumaça.** Este é o julgamento do harry, pelo vídeo.
4. **Desempenho num M1 Pro:** 60 quadros por segundo nos estados ativos. Em repouso, o processo da janela fica abaixo de 3% de CPU. Meça com `kiwi lock bench` e ponha os números no PR.
5. **Ele para de desenhar** com a janela escondida. Com o Reduzir movimento, mostra um quadro parado. Numa máquina que não segura 24 quadros por segundo, também.
6. **Sem WebGPU nem WebGL 2,** o app segue funcionando, sem erro na página.
7. **O app e o overlay mostram o mesmo gato:** o mesmo módulo, com print dos dois.
8. **`bun test` e typecheck limpos.**

## 8. As regras do repo (AGENTS.md vale inteiro)
- **Nada na tela do harry.** Os prints e os vídeos saem do WebKit headless (`bun run cli screenshot`, `bun run cli ui … --script`). Não abra o app nem uma janela.
- **Sem microfone.** O nível da voz nos testes é um número falso, gerado por script.
- **Nenhum diálogo do macOS**, e nada de AppleScript.
- **1 spec = 1 issue = 1 PR**, com `Closes #<issue>` e o print ou o vídeo no corpo do PR e no canal. Use um worktree próprio (`../kiwinotes-wt/T<n>`) e a branch `kn/T<n>-<slug>`.
- **Nada baixa da internet no app.** O three.js vai no bundle, com o crédito no Sobre (licença MIT).
- **A engine não é sua tarefa.** Se faltar algo no Electrobun Livewire, avise o lead: a correção vira uma task de um Builder. Um PR lá nunca recebe merge de um agente do harry: só do jow ou do Claude Code do jow (#7590). No `kiwi-init/channels`, nada: só leitura.
- **Dúvida de gosto** (se uma pose está certa, se a névoa está densa demais): pergunte ao lead, que leva ao harry. Não decida sozinho.

## 9. Adendo do harry (#7649): estados bem diferentes e símbolos de mangá

O harry viu a rodada 1 e gostou do visual. O problema dele: `repouso`, `acordou`, `ouvindo`, `thinking` e `erro` parecem a mesma imagem. Só `agindo` e `pronto` se diferenciam, porque o formato dos olhos muda, e **é isso que ele quer em todos**.

**Cada estado se reconhece de relance por duas coisas: o formato dos olhos e um símbolo.**

| estado | olhos | símbolo | orelhas e névoa |
|---|---|---|---|
| `repouso` | redondos; pisca e olha para os lados | nenhum | névoa lenta |
| `dormindo` (novo: repouso há muito tempo) | fechados, em arco para baixo | `zZ` subindo | névoa mínima |
| `acordou` | arregalados, maiores | `!` que salta | orelhas em pé, um pulso na névoa |
| `ouvindo` | redondos e atentos | ondas de som junto da orelha, no ritmo da voz | névoa acompanha a voz |
| `thinking` | semicerrados, olhando para cima e para o lado | balão com `…`, os pontos acendendo um a um | névoa junto da cabeça |
| `agindo` | de foco: semicerrados e retos, sem cara de bravo | gotas de suor e linhas de movimento | névoa mais larga |
| `pronto` | em arco feliz | brilhos em volta | a névoa abre e assenta |
| `erro` | desiguais | rabisco de confusão que se desenha, embola e recomeça (~1 s); escolha final #7718 | névoa perde luz |

**As regras dos símbolos:**
- **São desenhados em código**, como os olhos: forma limpa, traço arredondado. Nada de imagem gerada no app.
- **A cor é a dos olhos:** branco, nítido. Podem levar um toque do aro (de ciano a púrpura). Nunca a cor do agente, que é só da névoa.
- **Ficam fora da silhueta**, perto da cabeça, e entram com um salto curto. Não cobrem os olhos nem o aro.
- **O gato continua o do ícone.** O símbolo é uma camada a mais, não um gato novo.
- **Adereços** (o notebook, o livro, a lupa da folha antiga) **ficam de fora por enquanto.** Só entram se o harry pedir.
- O balão com `…` é um símbolo. Os balões de fala com texto (#7486) são outra peça, de outro spec, mas o traço dos dois deve combinar.

**Na prancha:** cada imagem de estado mostra os olhos e o símbolo nas 2 ou 3 poses.

**Um ponto em aberto, só para anotar no README:** como o gato e os símbolos ficam no tema claro do app. O ícone é feito para fundo escuro.


## 10. Revisão #7832: orelha quase rígida e prévias de movimento

O triângulo da orelha mantém largura, comprimento e ponta; só a base junto
à cabeça flexiona. O topo da cabeça entre as orelhas não muda. Se amplitudes
maiores que 20–25° não forem naturais, use o limite real e registre no README.
Esta versão adota ±15°; o erro usa as duas para fora sem achatar.

Entregar três prévias pelo próprio montar.py, sem código do app: repouso
(~6 s: piscada lenta, tique unilateral e olhar); acordou (opa, orelhas em pé,
! saltando e assentando); erro (rabisco em loop e orelhas abrindo). A 30 fps,
com o gato a ~480 px, cada uma em WebP animado até ~1,5 MB e cópia GIF ou MP4
para anexar no canal. Névoa pode ficar parada, pois o shader é da entrega 3.
Marcar em todos os quadros: “prévia de movimento, não é a animação final”.
O resto permanece como aprovado.
