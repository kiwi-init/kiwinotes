# KiwiCat novo e intro nova: a análise (T14773, spec #14755)

O que muda de hoje para os pacotes novos (`agente/` e `intro/`), o peso medido, os conflitos e os dois specs de
implementação propostos. A regra do harry vale para tudo: **muda o desenho, ficam as funções** (o balão com resumo,
"ver mais", rolagem e balão grande; o atalho Control; a conversa; os estados ligados ao agente; a posição escolhida).

Prints: `evidence/T14773/` (a intro em 8 tempos do `?t=`, o modo reduzido, os 5 estados e os quadros da medida).

## 1. O mapa, arquivo por arquivo

| Parte | Hoje | No pacote novo | O que fazer |
|---|---|---|---|
| Motor do gato | `ui/kiwicat/` (three.js 0.187, névoa TSL em WebGPU/WebGL2, textura B1) + rosto e símbolos vetoriais (`vectors.ts`, `symbols.ts`) + `gestures.ts` | `agente/ByteKiwiCat.tsx`: corpo em SDF por raymarching no WebGL2 (30 passos), num canvas fora da tela copiado (`drawImage`) para um canvas 2D, que desenha o rosto Flat-3D; emotes em SVG | Trocar o motor inteiro; sai o three.js (seção 2) |
| Estados | 8 (`repouso`, `dormindo`, `acordou`, `ouvindo`, `thinking`, `agindo`, `pronto`, `erro`), em `ui/kiwicat/state.ts`; o hub os tira do `agent.turn` em `ui/hub/cat-state.ts` | 5 (`repouso`, `ouvindo`, `pensando`, `respondendo`, `dormindo`) + emotes (`auto`, `alerta`, `confuso`, `cansado`, `feliz`, `limite`) | Tabela 1.1 |
| Cores | `src/shared/kiwicat-colors.ts`: a cor do agente (claude `#ff9b5e`) + 7 presets; só a névoa é tingida, o gato é sempre preto; contraste ≥ 2:1 nos dois temas | `KIWI_COLOR_PALETTES`: **5 paletas** de gradiente (`prisma-original`, `kiwi-neon`, `ambar-solar`, `soul-claro`, `nevoa-violeta`; o README do pacote diz 4) + 4 distribuições de aura (`KIWI_AURA_STYLES`) | Conflito C5 |
| Balão | `ui/hub/CatBubble.tsx` + `bubble-state.ts` (280 px, 3 linhas, digitação de 18 ms, tempo de leitura, "Ver mais", balão grande com rolagem e Esc) + `BubblePresence.tsx` (mola 250 ms, saída 180 ms, esmaecer 120 ms no reduzido) + `bubbleText.tsx`, `CatAsk.tsx` e os balões de memória, rotina e proposta | `KiwiSpeechBubble`: um `div` estático de quadrinho (até 320 px, fundo `#07080B`, borda e sombra na cor de destaque, rabo SVG à esquerda ou à direita), sem resumo, sem "ver mais", sem animação | Só o visual muda: a casca e o rabo novos entram no `CatBubble`; a lógica fica (C6) |
| Overlay | `src/bun/cat-overlay.ts` (tempos: entrada 180 ms, `pronto` 1100 ms…), `ui/catoverlay/main.ts`, `placement.ts` (gato 192×240, balão 300×112, escala 0,6–1,6), janela nativa do helper (`CatOverlayModel.swift`) | `ByteKiwiOverlay`: 9 posições, padrão `bottom-right`; 4 transições, padrão `materializacao-nevoa` (420 ms entrando, 280 ms saindo) | A janela e o posicionamento ficam no helper; entra só a transição (C1) |
| Posição | `src/shared/kiwicat-place.ts`: 6 posições, padrão `center`, tamanho 0,6–1,6 (spec #12949) | 9 posições, padrão `bottom-right`, sem tamanho | Fica a escolha da pessoa (C1) |
| Intro | O prisma: `app/ui/intro/index.html` + `intro.js` (gerado por `docs/design/brand/intro/gerar.ts`), `rive.ts`; `src/bun/intro.ts` abre uma janela à parte, que fecha antes do hub (prazo de 20 s) | `intro/`: 6 fases em 5,35 s (4,40 s sem a moldura): condensa, orelhas, olhos, aurora, feliz, some; a moldura de 320×320 cresce até a janela de 640×370. Chama `window.engine.ready()` e manda `intro.done` | Spec A (seção 5); o prisma sai inteiro |
| Reduzir movimento | O gato: o "Reduzir movimento" do macOS ou a Aparência (`kn-appearance`, `motion: "reduced"`) dão um quadro parado (`parado: true`); o balão vira esmaecer de 120 ms | A intro: lê os dois (`prefers-reduced-motion` e `kn-appearance`) e vira uma versão de 1,5 s. **O gato: não trata nenhum** (nenhum `matchMedia` no `ByteKiwiCat.tsx`) | Spec B tem de pôr (C7) |

### 1.1 Os 8 estados de hoje, um destino para cada

| Hoje | Destino | Por quê |
|---|---|---|
| `repouso` | estado `repouso` | Igual |
| `dormindo` | estado `dormindo` | Igual (o "zZ" do pacote) |
| `acordou` | estado `repouso` + emote `alerta` (uma vez, na entrada) | O pacote não tem um estado de despertar; o `alerta` é o gesto curto que mais se aproxima |
| `ouvindo` | estado `ouvindo` | Igual (as ondas ao lado) |
| `thinking` | estado `pensando` | Mesmo papel, nome em português |
| `agindo` | estado `respondendo` | O agente rodando uma ferramenta e escrevendo a resposta ficam no mesmo estado ativo; um emote próprio para a ferramenta não existe no pacote, e não vale inventar |
| `pronto` | emote `feliz` sobre `repouso` | O pacote fecha o turno com as estrelas do `feliz` (print `gato-respondendo` e a fase 4 da intro) |
| `erro` | emote `confuso`; `limite` quando o erro é de limite de uso | O pacote separa os dois; hoje é um só `erro` |

Nenhum estado sai sem destino. O `cansado` do pacote não tem par hoje: fica sem uso até um spec pedir.

## 2. O motor

- **Sai:** three.js 0.187 e a névoa TSL (WebGPU com recuo para WebGL2), a textura B1, os vetores de rosto e símbolos de
  hoje e o `GestureMachine`. O `ui/kiwicat/` inteiro vira o renderizador novo.
- **Entra:** um renderizador WebGL2 só (SDF por raymarching, 30 passos), um canvas 2D para o rosto e SVG para os
  emotes. Não precisa de dependência nova: é React e WebGL2 puros.
- **Um renderizador para os dois:** o shader da intro (`intro/src/kiwiRenderer.ts`) contém o do gato e acrescenta o
  `bodyMorph` para escalas mínimas (escala até 0,04 em vez de 0,70), o `dispScale` e uma borda um pouco diferente
  (−0,048 contra −0,068). Um único módulo com esses parâmetros serve à intro e ao agente; manter dois shaders quase
  iguais seria uma fonte de divergência.
- **A cópia WebGL → 2D:** cada quadro desenha no canvas WebGL fora da tela e copia para o 2D com `drawImage`. Funciona,
  mas é uma cópia por quadro; desenhar o rosto em cima do próprio WebGL (ou um canvas 2D por cima, sem copiar) poupa.
- **Ressalva do render headless:** no WebKit e no Chromium sem GPU (render por software), o corpo sai roxo com anéis de
  contorno, e não tinta escura como o pacote descreve. Os dois navegadores dão o mesmo, então é o shader no GL por
  software, não o WebKit. Como fica numa GPU de verdade só se vê no teste do harry (Spec B, último item).

## 3. O peso: o gato novo contra a névoa de hoje

**Método** (`app/scripts/kiwicat-v2/peso.ts`, com `instrumento.ts`, `hoje.ts`, `novo.tsx` e `servir.ts`): os dois gatos
nas mesmas condições: WebKit headless (o motor do app), 240 px, DPR 2, a mesma CSP do app, um WebKit novo por rodada,
10 s de aquecimento e 30 s de amostra, com o `kiwi lock bench`. Um quadro é um `requestAnimationFrame`/`setTimeout` que
desenhou (o instrumento embrulha as chamadas `draw*` do WebGL2). A CPU é a dos processos do WebKit daquela rodada.
O gato de hoje roda como no overlay (`activeFPS` 30, `densityScale` 0,5); o novo, como vem no pacote.

| Gato | Estado | fps | ms/quadro (mediana / p95) | CPU (% de um núcleo) |
|---|---|---|---|---|
| hoje | repouso | 2 | 1 / 3 | 2,7 |
| novo | repouso | 59,7 | 0 / 1 | **43,6** |
| hoje | ouvindo | 30 | 1 / 2 | 19,5 |
| novo | ouvindo | 59,9 | 1 / 1 | 49,9 |
| hoje | thinking | 29,9 | 1 / 2 | 23,0 |
| novo | pensando | 59,9 | 1 / 1 | 53,3 |

- **Parado, o gato novo gasta ~16× o de hoje** (43,6 % contra 2,7 %); ativo, ~2,5×. A causa não é o custo de um quadro
  (≈ 1 ms nos dois), é a cadência: o pacote desenha 60 quadros/s em todo estado, sem pausa quando some e sem modo
  reduzido. Hoje o repouso é 2 fps e o overlay roda a 30.
- O relógio do WebKit tem resolução de 1 ms, então o "ms/quadro" só diz que os dois são baratos por quadro; a CPU e o
  fps é que separam.
- Os números são de render por software (headless). Numa GPU o custo por quadro cai, mas a razão da cadência fica.
- **O que o Spec B tem de pôr:** repouso a ~2 fps, pausa quando o gato está escondido (`visibility(false)` de hoje),
  o quadro parado do reduzir movimento, e 30 fps no overlay. Com isso o gato novo deve voltar à faixa de hoje; o Spec B
  prova repetindo esta medida.

Para repetir (de `app/`): `kiwi lock bench --wait 30m && bun scripts/kiwicat-v2/peso.ts <pasta> 30; kiwi unlock bench`.

### 3.1 O gato do app com a cadência (T14977, spec #14813)

O mesmo `peso.ts`, agora com o gato do app (`ui/kiwicat/cat.ts`) em cada cadência, contra o pacote, que segue igual.
O desenho e a resolução são os do pacote (#14821): só muda **quando** ele desenha. 240 × 240 px, DPR 2, 10 s de
aquecimento, 30 s de amostra, **3 rodadas, e vale a mediana** (entre parênteses, a menor e a maior). São 27 páginas,
com o `kiwi lock bench`, no commit `4a8d7ca9` do `kn/T14885-gato-novo`.

| Gato | Estado | fps | CPU (% de um núcleo) |
|---|---|---|---|
| pacote | repouso | 59,9 | 28,8 (26,7–38,3) |
| pacote | pensando | 60 | 31,0 (29,3–32,1) |
| app, hub | repouso | 18,2 | **13,3** (12,7–15,7) |
| app, overlay | repouso | 18,2 | **11,7** (9,9–30,9) |
| app, overlay | ouvindo | 30 | 19,3 (18,2–20,8) |
| app, overlay | thinking | 30 | 17,8 (17,6–37,4) |
| app, hub | thinking | 60 | 32,4 (29,0–32,4) |
| app, hub, com `activeFPS: 30` (T14885) | thinking | 29,8 | **24,5** (20,7–26,3) |
| app, escondido | thinking | 0 | **0** |
| app, reduzir movimento | thinking | 0 | **0** |

- **Parado, o gato gasta ~13 % de um núcleo, abaixo dos 15 %**: 18 quadros/s (harry, #14846), menos da metade do
  pacote. O gato de antes gastava 2,7 % porque parado desenhava a 2 quadros/s. A diferença vem dos 15 a 20 fps que
  o harry escolheu, não do custo do quadro, que fica em ≈ 1 ms nos dois.
- **Trabalhando no overlay (30 fps): ~18–19 %**, perto dos 19,5–23 % do gato de antes no mesmo papel.
- **No hub, trabalhando, ele ia a 60 fps e gastava como o pacote (32,4 %).** Desde a T14885 (#15132), o `KiwiCat.tsx`
  passa `activeFPS: 30`, como o overlay: **29,8 fps e 24,5 %** (20,7–26,3), medido de novo com o mesmo `peso.ts`, 3
  rodadas e a mediana, com o `kiwi lock bench`. Na mesma medida, o overlay em `thinking` deu 19,8 % (18,7–24,1). O hub
  fica uns 5 pontos acima porque a página dele tem mais processos do WebKit na conta (5 a 7, contra 5).
- **Escondido e com reduzir movimento: zero quadros e zero CPU** na amostra. O reduzido desenha um quadro parado ao
  montar e um a cada troca de estado.
- As faixas largas (30,9 e 37,4) são rodadas em que um WebKit de outro agente abriu no meio. No macOS, o WebContent
  nasce do launchd, fora da árvore do browser, então o script conta os processos do WebKit novos desde o launch. Por
  isso são 3 rodadas, e vale a mediana.
- Os números do pacote saíram menores que os da tabela acima (28,8 contra 43,6). Mudaram a máquina e a carga, mas o
  pacote é o mesmo. Por isso a comparação vale dentro da mesma rodada.

## 4. Conflitos e recomendação

| # | Conflito | Recomendação |
|---|---|---|
| C1 | **Posição do overlay:** o pacote tem 9 posições e padrão `bottom-right`; hoje são 6, padrão `center`, mais o tamanho (spec #12949) | Ficam as 6 posições, o padrão e o tamanho de hoje (é função, não desenho). Do pacote entra só a transição `materializacao-nevoa` |
| C2 | **A intro cresce até a janela do app;** hoje a intro é uma janela à parte que fecha antes do hub abrir | A intro roda na janela da intro de hoje (`src/bun/intro.ts`), e a fase 6 (a moldura virando janela) termina quando o hub abre por cima. Fazer a intro virar a janela do hub de verdade é outra mudança, maior, e fica fora |
| C3 | **Os `build/*.html` têm script inline;** a CSP das views (`script-src 'self' views:`) bloqueia | O app não usa o build: o Spec A monta a intro como as outras views (um `.ts` empacotado pelo Vite). O build fica fora do git, só como referência: `intro/gerar.ts` o gera, e os prints do `?t=` saem dele |
| C4 | **O three.js sai** | Sai junto com o `ui/kiwicat/` antigo, no Spec B; nada mais no app usa o three.js (conferir com `grep` no PR) |
| C5 | **Cores:** hoje a cor do agente + 7 presets tingem só a névoa, com contraste conferido; o pacote tem 5 paletas de gradiente prisma | O padrão vira a paleta escolhida no pacote (`prisma-original`). A escolha em Ajustes › Agente (spec #9349) passa a listar as 5 paletas no lugar dos 7 presets; a regra de contraste ≥ 2:1 nos dois temas fica e vale para as paletas |
| C6 | **Balão:** o `KiwiSpeechBubble` é estático e não tem resumo, "ver mais", rolagem, digitação nem balão grande | Fica o `CatBubble` com toda a lógica; muda só a casca (raio 22, borda e sombra na cor de destaque, rabo SVG). A cor de destaque sai da paleta |
| C7 | **Reduzir movimento:** o gato do pacote não lê nem o macOS nem a Aparência | O Spec B liga o `parado` de hoje ao gato novo (um quadro parado, sem rAF) |
| C8 | **8 estados contra 5** | A tabela 1.1; o `cat-state.ts` passa a dar estado + emote |
| C9 | **Cadência de 60 fps sem pausa** (seção 3) | Spec B: repouso ~2 fps, pausa escondido, 30 fps no overlay |

## 5. Dois specs de implementação

### Spec A: a intro nova no lugar do prisma

- **Muda:** `app/ui/intro/` (sai `intro.js`, `rive.ts` e o prisma; entra a intro do pacote como view empacotada, com o
  renderizador comum), `docs/design/brand/intro/` sai para o `docs/arquivo.md`.
- **Fica:** a janela da intro de `src/bun/intro.ts`, o `intro.done`, o prazo de 20 s, o hub abrindo depois.
- **Reduzir movimento:** a versão de 1,5 s, pelo macOS e pela Aparência.
- **Prova:** prints do `?t=` nas 6 fases e do modo reduzido pela CLI headless; a view passa na CSP sem script inline;
  `bun test` de `intro.ts`; o harry vê a intro numa rc.

### Spec B: o gato novo no app e no overlay

- **Muda:** `ui/kiwicat/` inteiro (o renderizador SDF comum, o rosto, os emotes); `cat-state.ts` dá estado + emote
  (tabela 1.1); a casca do balão; as paletas em Ajustes › Agente; a transição do overlay; sai o three.js.
- **Fica:** o `CatBubble` e a lógica do balão (#13378), o Control (#9876, #12946), a conversa (#13380), as 6 posições e o
  tamanho (#12949), o overlay nativo do helper, o gato no canto do hub (#9510).
- **Peso:** repouso ~2 fps, pausa escondido, quadro parado no reduzir movimento, 30 fps no overlay.
- **Prova:** `peso.ts` de novo, com o novo na faixa de hoje (repouso ≤ 5 % de CPU); prints dos 5 estados e dos emotes
  pela CLI; os scripts de UI do hub, de Ajustes e do overlay passando; o harry vê o gato numa GPU de verdade numa rc
  (inclusive a cor do corpo, seção 2).

## 6. Os 13 specs abertos

| Spec | Título | Fica / muda / cai | Nota |
|---|---|---|---|
| #8373 | Ajustes › Agente: ligar o agente | Fica | Não depende do desenho; se tiver o gato num print, usa o novo |
| #9349 | A cor da névoa, em Ajustes › Agente | **Muda** | Os 7 presets viram as 5 paletas (C5) |
| #9510 | O gato no canto da janela principal | **Muda** | Mesmo lugar e mesma ligação ao agente, com o gato novo (Spec B) |
| #9810 | O gato no overlay, no centro da tela | **Muda** | A janela fica; entra o gato e a transição novos (C1) |
| #9876 | O atalho Control | Fica | Função |
| #11955 | O onboarding do agente | **Muda** | O gato do onboarding passa a ser o novo; o roteiro fica |
| #12938 | Pelo Control, a resposta no balão | Fica | Função; o balão só muda de casca |
| #12946 | Atalho escolhido pela pessoa | Fica | Função |
| #12949 | Posição e tamanho | Fica | As 6 posições e o tamanho ficam, contra o padrão do pacote (C1) |
| #13378 | O balão: resumo, "ver mais", rolagem | Fica | Função; só a casca muda (C6) |
| #13380 | A conversa contínua | Fica | Função |
| #13381 | A barra de rolagem não encosta no gato | Fica | O gato novo tem outro tamanho; conferir a folga no Spec B |
| #14609 | A prancha e o README da intro de hoje | **Cai** | A intro do prisma sai inteira (já cancelado pelo lead) |
