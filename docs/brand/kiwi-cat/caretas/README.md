# Caretas do Kiwi-cat

T8959 · spec Kiwi #8758, versão aprovada #9350 · issue [#392](https://github.com/kiwi-init/kiwinotes/issues/392).

Demonstração isolada dos oito estados com olhos e símbolos vetoriais sobre a
névoa B1. Cabeça, corpo e orelhas permanecem imóveis. Não há importação do módulo
nas telas do app. O relógio, o sorteio e o tempo até dormir são injetáveis.

![Prancha aprovada e código, lado a lado](comparacao-prancha.webp)

![Oito estados com 120 pixels de altura, sem legenda](tira-cega-120.webp)

## Vídeos

Capturas do WebKit headless, na cor padrão, sem áudio. A voz em `ouvindo` é
uma sequência de números sintéticos; nenhum microfone é acessado. São provas
visuais e não servem para medir CPU ou cadência.

| Estado | Vídeo |
| --- | --- |
| Repouso | [16 s, piscadas e olhar](videos/repouso.mp4) |
| Dormindo | [zZ em movimento](videos/dormindo.mp4) |
| Acordou | [reação inicial](videos/acordou.mp4) |
| Ouvindo | [nível de voz sintético](videos/ouvindo.mp4) |
| Thinking | [busca e pontos](videos/thinking.mp4) |
| Agindo | [gotas e linhas](videos/agindo.mp4) |
| Pronto | [reação e retorno ao repouso](videos/pronto.mp4) |
| Erro | [traçado do rabisco em loop](videos/erro.mp4) |

O quadro de Reduzir movimento usa os três arcos brancos da referência de
`ouvindo`. Com `voz=null` ou ausente, as ondas desaparecem no mesmo quadro,
inclusive durante a troca de símbolo. A animação normal mantém a onda com alfa
0,35 no silêncio numérico e aumenta as ondas pelas faixas do roteiro.

O lead reconheceu os oito estados na tira corrigida sem legenda (Kiwi #9077,
conferido em #9079) e aprovou a comparação de formas (#9078). O harry aprovou as caretas no Kiwi #9246, registrado pelo lead no #9249.

## Provas e histórico

A árvore final contém os materiais de leitura: imagens, vídeos, tabelas por
série, resumos, auditoria e FPS. Os relatórios por par/processo, as janelas
individuais, a prova funcional e o manifest completo dos vídeos estão
preservados no [commit `f35a23d`](https://github.com/kiwi-init/kiwinotes/tree/f35a23d/docs/brand/kiwi-cat/caretas/).
Os resumos desta árvore mantêm os valores medidos e apontam para esse arquivo
histórico; apenas os detalhes repetidos foram retirados.

O vídeo de repouso é o de `8bae2fd` (134.683 bytes), aprovado pelo harry e
compatível com o renderer individual retido. O ensaio de camada compartilhada
permanece documentado nos resumos e no histórico.

## Verificação

Em `app/`:

```sh
bun test
bun run typecheck
bun scripts/kiwicat-face-check.ts /tmp/kiwi-T8959-render
bun scripts/kiwicat-face-videos.ts
# Pillow in an isolated environment; keeps the answer key outside the repo:
python scripts/kiwicat-face-sheet.py /tmp/kiwi-T8959-render --key /tmp/kiwi-T8959-key.json
```

O check funcional percorre os oito estados, WebGPU/WebGL2/sem GPU,
quadro parado, voz ausente, ocultação, retomada e descarte. O vídeo nativo de
repouso permite conferir os gestos programados no compositor sem forçar RAF
no shader: a névoa continua a duas atualizações por segundo.

Para CPU, obter primeiro `kiwi lock bench --wait 30m`. Fechar apenas os processos
headless da própria execução e não gravar nem rodar outros checks durante a coleta.

```sh
bun scripts/kiwicat-face-bench.ts /tmp/kiwi-T8959-fog 2 --fog-only
bun scripts/kiwicat-face-bench.ts /tmp/kiwi-T8959-faces 2
```

A coleta de aceite usa 12 pares alternados, conforme o protocolo abaixo. Cada execução aquece por 10 segundos e
mede por 60 segundos, congelando os cinco PIDs do seu WebKit. Os relatórios
registram CPU por processo e hashes dos arquivos da implementação. O alvo é
até cerca de +1 ponto de CPU em repouso, aceito pelo harry no #9349
e registrado no spec #8758, versão #9350; os estados ativos exigem pelo
menos 55 fps. O teto anterior era +0,5 ponto.
As medidas são da página isolada no Playwright WebKit, não do WKWebView do app.

A primeira sondagem, anterior à otimização de pausas dos gestos, está em
[histórico `f35a23d`](https://github.com/kiwi-init/kiwinotes/tree/f35a23d/docs/brand/kiwi-cat/caretas/diagnostico-inicial/). Ela foi avaliada sob o teto antigo de +0,5 e ficou como diagnóstico histórico. As duas séries concluídas estão abaixo.

## CPU da implementação retida: aceita no teto revisto

Head medido `45a0f21`. CPU em percentual de um núcleo, por cinco processos
próprios do WebKit; 10 s de aquecimento e 60 s de coleta por variante.
Amostras sem vídeo, com hashes dos nove arquivos de runtime em cada JSON.

| Par | Ordem | Névoa | Caretas | Delta (ponto) | Carga início→fim | Variação | Estável |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | fog→faces | 1.914551 | 2.580920 | +0.666369316 | 3.916→3.866 | 1.297 | sim |
| 2 | faces→fog | 2.081407 | 2.580680 | +0.499273508 | 3.866→4.549 | 1.412 | sim |
| 3 | fog→faces | 2.247531 | 2.531656 | +0.284124406 | 4.549→3.125 | 1.683 | não |
| 4 | fog→faces | 2.064126 | 3.180825 | +1.116699335 | 3.125→3.232 | 1.670 | não |
| 5 | fog→faces | 2.447306 | 2.830166 | +0.382859709 | 3.232→4.882 | 3.482 | não |
| 6 | fog→faces | 2.581350 | 3.096341 | +0.514991225 | 4.882→3.412 | 2.190 | não |
| 7 | fog→faces | 2.364167 | 2.847319 | +0.483152296 | 3.412→7.586 | 4.631 | não |
| 8 | faces→fog | 2.247513 | 2.946541 | +0.699027817 | 5.429→3.510 | 2.110 | não |
| 9 | fog→faces | 2.313992 | 3.129771 | +0.815778813 | 3.510→2.414 | 1.848 | não |
| 10 | faces→fog | 2.447138 | 3.129533 | +0.682394886 | 2.414→3.088 | 1.100 | sim |
| 11 | fog→faces | 2.230953 | 3.196252 | +0.965299005 | 3.088→3.028 | 1.543 | não |
| 12 | faces→fog | 2.530500 | 3.229419 | +0.698918788 | 3.028→3.159 | 1.474 | sim |

**Mediana de todos: +0.674382100875815. Mediana dos 4 estáveis: +0.674382100875815.**
Faixa: +0.284124406 a +1.116699335. **A mediana de +0,67 atende ao teto de cerca de +1 ponto aceito pelo harry no #9349.**
[Dados integrais](desempenho/serie-12-pares.json).

O protocolo mudou durante a coleta (Kiwi #9209). Os primeiros seis pares
preservam as ordens originais, incluindo as repetições antigas de névoa→caretas.
Os seis finais, 7–12, alternam a ordem. Todos os 12 contam, incluindo os
quatro inicialmente descartados por carga. A classificação estável usa
variação ≤1,5. As amostras intermediárias, a fase anterior e o probe
interrompido na troca de protocolo estão no histórico `f35a23d`; o probe
interrompido não conta como par completo.

O protocolo original de coleta comparava as duas medianas a +0,5. Os
campos `criterion` e `passes` dos JSONs preservam essa avaliação histórica,
assim como os números. O aceite atual é o teto de cerca de +1 ponto do
#9349, registrado na versão #9350 do spec. A implementação retida, com
medianas de +0,67, atende ao critério revisto. Não houve nova medição.

## Diagnóstico sem gestos

[Dados](desempenho/sem-gestos/resumo.json): névoa 3,4027445061%,
olhos imóveis 3,3530790216%, delta **−0,0496654846 ponto**, perto de zero.
São 12 janelas de 5 s por variante, ~60,8 s somados, seed fixa 386. Cada
janela termina antes da primeira piscada (8,994 s) e do olhar (11,625 s).
Os olhos ficaram com `faceUpdates` 1→1, `quietPlans=0` e zero animações; a
névoa fez dez desenhos por janela. Não foi usado `parado`. Esse protocolo
de contextos novos localiza o custo; o aceite usa as janelas contínuas de 60 s.

## Perfil e experimento de camadas (revertido)

[Perfil anterior à mudança](desempenho/gestos-isolados-45a0f21/resumo.json),
quatro ocorrências naturais por gesto/variante, névoa descontada:

| Gesto | CPU líquida por ocorrência |
| --- | ---: |
| Piscada simples | 82,5 ms |
| Olhar lateral | 75,0 ms |
| Piscada dupla | 152,5 ms |

O contador do `ps` tem resolução de 10 ms. A névoa manteve 2/s durante
esses gestos. A piscada dupla foi a mais cara. O ensaio `78fbb51` compartilhou as camadas
do par de olhos e reduziu quatro efeitos nativos para dois, sem mudar tempos
ou trajetórias. A rodada não demonstrou ganho de CPU; o caminho adicional
foi revertido por acrescentar complexidade (decisão delegada no Kiwi #9265).
A implementação retida usa os olhos individuais de `45a0f21`.

[Imagem do experimento descartado: antes à esquerda, camada compartilhada à direita](https://github.com/kiwi-init/kiwinotes/blob/f35a23d/docs/brand/kiwi-cat/caretas/desempenho/otimizacao-piscar/comparacao-olhos.webp)

[Comparação arquivada](https://github.com/kiwi-init/kiwinotes/blob/f35a23d/docs/brand/kiwi-cat/caretas/desempenho/otimizacao-piscar/pixel-diff.json): os sete outros
estados são idênticos pixel a pixel; as diferenças dos olhos em repouso
ficam nas bordas suavizadas (média ≤0,087/255 por canal nas poses verificadas).
O comparador nativo confirmou quatro efeitos antes e dois depois.

## Quadros por segundo

[Check dentro da página](desempenho/fps-por-estado.json): 59,88–60,06 fps
em névoa e vetores. Em `pronto`, a amostra foi de 101 a 802 ms após entrar
no estado (701 ms), antes do retorno automático em 1,1 s: 59,89 fps.
Os demais estados tiveram 1 s de assentamento e 3 s de amostra.
Nenhuma janela trocou de estado. A medição de FPS não inclui sondagem de
processos entre o começo e o fim da janela.

Para repetir em diretórios novos, com o lease `bench` e fonte congelada:

```sh
python3 scripts/kiwicat-face-series.py /tmp/kiwi-T8959-serie-nova
bun scripts/kiwicat-face-no-gesture.ts /tmp/kiwi-T8959-sem-gestos-novo
bun scripts/kiwicat-face-gesture-profile.ts /tmp/kiwi-T8959-perfil-novo
```

A medição é da demonstração no Playwright WebKit, não do WKWebView do app.

## Série histórica do experimento descartado

Head `78fbb51`, 12 pares alternados, sem descarte ou repetição. CPU em
percentual de um núcleo. A rodada única foi encerrada após o 12º par.

| Par | Ordem | Névoa | Caretas | Delta (ponto) | Carga início→fim | Variação | Estável | Período |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 1 | fog→faces | 2.197142 | 2.913260 | +0.716118421 | 3.825→2.491 | 1.536 | não | antes |
| 2 | faces→fog | 1.664727 | 3.063091 | +1.398364342 | 2.491→14.004 | 11.514 | não | antes |
| 3 | fog→faces | 1.998254 | 2.780489 | +0.782235219 | 14.004→7.656 | 13.708 | não | antes |
| 4 | faces→fog | 2.297092 | 2.663236 | +0.366143802 | 7.656→13.834 | 8.161 | não | antes |
| 5 | fog→faces | 2.579899 | 3.511480 | +0.931581315 | 13.834→25.003 | 20.947 | não | transição |
| 6 | faces→fog | 3.295747 | 4.327585 | +1.031838436 | 25.003→5.407 | 19.597 | não | depois |
| 7 | fog→faces | 3.080174 | 4.227636 | +1.147462032 | 5.407→4.427 | 1.395 | sim | depois |
| 8 | faces→fog | 3.329142 | 3.994664 | +0.665521762 | 4.427→3.292 | 1.365 | sim | depois |
| 9 | fog→faces | 3.512187 | 4.544282 | +1.032095893 | 3.292→3.316 | 1.252 | sim | depois |
| 10 | faces→fog | 3.681057 | 4.077772 | +0.396715287 | 3.316→2.539 | 3.682 | não | depois |
| 11 | fog→faces | 3.245674 | 4.460706 | +1.215032632 | 2.539→2.510 | 1.485 | sim | depois |
| 12 | faces→fog | 3.578192 | 4.393876 | +0.815683951 | 2.510→2.138 | 0.911 | sim | depois |

**Mediana dos 12: +0.8736326333018039. Mediana dos 5 estáveis: +1.0320958932963875 ponto. Avaliação histórica sob o teto antigo de +0,5; o experimento não é a implementação retida.**

Faixa: +0.366143802 a +1.398364342, amplitude 1.032220540.
A mudança de camadas não demonstrou ganho de CPU nesta coleta.
[Dados completos](desempenho/ultima-rodada/serie-12-pares.json).

| Grupo | Pares | Mediana de todos | Estáveis | Mediana dos estáveis |
| --- | --- | ---: | ---: | ---: |
| Antes das pausas | 1,2,3,4 | +0.749176820 | 0 | — |
| Transição entre pausas | 5 | +0.931581315 | 0 | — |
| Após a última pausa | 6,7,8,9,10,11,12 | +1.031838436 | 5 | +1.032095893 |

Os grupos seguem os saltos observados entre horários de início; a hipótese
de sono veio do revisor (#9243). O par 5 é de transição. O lease expirou
durante a série e foi readquirido até 06:26 UTC; o lead confirmou que ninguém
usou o bench no intervalo (#9241). O ocorrido está preservado na auditoria.
O `caffeinate -i` foi vinculado ao PID da coleta às 06:28:42 UTC e encerrou
com ela; o processo desta task não ficou rodando. Nenhum processo de outra
sessão foi encerrado. [Auditoria e grupos](desempenho/ultima-rodada/auditoria-e-grupos.json).

O [FPS deste head](desempenho/ultima-rodada/fps-por-estado.json) passou em
59,98–60,17 fps para névoa e vetores. `Pronto`: 101 a 803 ms após a entrada
(702 ms), 60,17 fps. Testes e typecheck passaram. O CI do head de runtime
`78fbb51` está verde.

O harry aprovou a aparência (#9246/#9249) e aceitou o teto de cerca de
+1 ponto no #9349. O código e os números medidos permanecem iguais; o PR
segue para revisão conforme o spec atualizado.

## Implementação retida e aceite

Os olhos individuais de `45a0f21` foram restaurados após a rodada única.
A camada compartilhada acrescentava um caminho condicional e geometria
duplicada, sem ganho demonstrado. Os nove hashes do runtime retido coincidem
exatamente com os da primeira série de 12 e da prova original de FPS:
[verificação](desempenho/renderer-final.json). Não houve nova medição.
A aparência é a mesma aprovada pelo harry (#9246/#9249).

| Recorte observado | Névoa (mediana) | Delta (mediana) | Delta/névoa |
| --- | ---: | ---: | ---: |
| Primeiros 12, renderer retido | 2.280762% | +0.674382 ponto | 29.57% |
| Após última pausa, ensaio compartilhado | 3.329142% | +1.031838 ponto | 30.99% |

A proporção ficou próxima de 30% nos dois recortes, apesar da mudança dos
valores absolutos com o estado da máquina, como observado pelo revisor
(#9265). No #9349, em resposta ao #9263, o harry aceitou cerca de +1 ponto
e manteve o gato como aprovado. A mediana de +0,67 do renderer retido
atende a esse teto revisto (spec #8758, versão #9350). Não houve nova
alteração de código ou medição para esse aceite.
