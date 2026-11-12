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
  - `estado`: `repouso`, `acordou`, `ouvindo`, `thinking`, `agindo`, `pronto` ou `erro`;
  - `voz`: de 0 a 1, o nível da voz da pessoa;
  - `cor`: a cor do agente;
  - `parado`: verdadeiro com o Reduzir movimento.
- **A máquina de estados** é TypeScript puro, sem tela, com `bun test`.

## 4. Os estados (do pedido do harry, #4655)
| estado | o que o gato faz |
|---|---|
| `repouso` | Pisca devagar, olha para um lado e para o outro, mexe um pouco a orelha. A névoa anda bem lenta, quase respirando. Não pode chamar a atenção. Só existe dentro do app. |
| `acordou` | A reação "opa, estou ouvindo", curta, quando a pessoa aperta o atalho. No overlay, ele entra com uma animação fluida. |
| `ouvindo` | Reage à voz: a névoa acompanha o nível, com subida rápida e descida suave. |
| `thinking` | Pensando. Os olhos e a névoa mostram que ele está trabalhando por dentro. |
| `agindo` | Fazendo algo (running bash, editing note). É diferente do `thinking`. |
| `pronto` | Terminou. Uma reação curta e satisfeita, e ele volta ao repouso ou sai do overlay. |
| `erro` | Algo falhou. Uma reação clara, sem susto. |

**As cores:** uma paleta inspirada em cada agente, nunca o logo. Comece com três: a padrão (o lilás do ícone), o Claude Code (laranja) e o Codex (branco perolado, porque uma névoa preta some num gato preto).

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
