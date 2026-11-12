# Varredura: Desempenho (área 7 do spec #7424, T7443)

O "antes" foi medido na `main` em `7401cf5`, e o "depois" na `main` em `1ac4720` (2026-11-12), já com o T7875, o
T7876 e o T7877.

- **Como:** pelo engine headless, com os dados num tmp, e pela janela Notas num WebKit headless. Nada apareceu na tela
  de ninguém, e nenhum mic foi ligado. O ditado usou áudio do `say` (voz Luciana) pelo `bun run cli dictate`.
- **O lock:** toda medida rodou com o `kiwi lock bench`. Mas a máquina é dividida entre os agentes, com o load entre
  ~13 e ~31. Os números servem para comparar o antes com o depois, não como o tempo do Mac de uma pessoa.
- **O cofre grande:** 10 mil notas em 100 pastas, cada uma com um `[[link]]`. Os scripts estão citados em cada task.

## Resumo

| Área | Resultado |
|---|---|
| A árvore com tudo expandido (#7415) | 3,5–8,1 s → **66–104 ms**: **T7875**, na `main` |
| Digitar numa nota grande | 467–497 → **183–184 ms** por tecla, em 821 KB com links: **T7876**, na `main` |
| Renomear e mover num cofre de 10 mil | 3,5–4,1 s → **245–270 ms**: **T7877**, na `main` |
| Ir ao fim de uma nota grande com links e digitar | **~25 s** travado, na 1ª vez: **T8046**, aberto |
| A busca, o ⌘K, os backlinks e o índice | sem mudança, e já dentro do esperado |
| A memória e a CPU paradas | 0% de CPU no engine e no helper, depois de carregar |
| O ditado | ~90 ms de STT para 2,4 s de fala, e ~600 ms para 74 s |

## O cofre de 10 mil notas

### No engine (`scripts/notes-bench.ts 10000`)

| Passo | Antes | Depois |
|---|---|---|
| abrir e indexar | 4.841 ms | 4.434 ms |
| reabrir (o boot seguinte) | 4.950 ms | 4.446–5.006 ms |
| busca "pjoreto prazo" (com erro de digitação) | 72 ms | 71–72 ms |
| busca sem resultado ("xyzzyw") | 89,5 ms | 85–89 ms |
| ⌘K "nt99" (523 resultados) | 30 ms | 29–30 ms |
| ⌘K "nota 999" | 40 ms | 39–41 ms |
| backlinks | 24 ms | 24–32 ms |
| **renomear com links** | **3.487–4.066 ms**, relendo as 10 mil | **245–270 ms**, relendo 3 |
| **mover para outra pasta** | **2.518–2.718 ms** | **216–217 ms** |

### Na janela (WebKit headless)

| Passo | Antes | Depois |
|---|---|---|
| abrir a janela com uma nota | 1.061–1.301 ms | 1.043–1.113 ms |
| **expandir a árvore inteira** | **3.529–3.731 ms**, com 10.108 itens no DOM | **66–68 ms**, com 65 |
| **reabrir a árvore expandida** | **3.796–8.133 ms** | **80–104 ms** |
| filtrar a árvore ("Nota 099-099") | 550–624 ms | 84–94 ms |
| rolar até o fim e ver a última nota | | 4–5 ms |
| ⌘K e 10 letras, até a lista | 754–1.185 ms | 703–709 ms |

O teclado na árvore virtual: do topo, **600 ⌥Tab** andaram por 201 linhas diferentes, em ordem, sem o foco sair da lista.

## Digitar numa nota grande

Medi a mediana de 8 teclas no fim da nota, até 2 quadros pintados. "Sem link" é um parágrafo só, e "com links" tem um
`[[B]]` por linha.

| Nota | Antes | Depois |
|---|---|---|
| sem link, 39 KB | 33 ms | 33 ms |
| sem link, 159 KB | 65–66 ms | 50 ms |
| sem link, 399 KB | 133–151 ms | 102–115 ms |
| sem link, 962 KB | 283–300 ms | 216 ms |
| com links, 341 KB | 151–165 ms | 83 ms |
| **com links, 821 KB** | **467–497 ms** | **183–184 ms** |

- **Saíram da tecla** o Sumário, as palavras e o rascunho (depois de 300 ms sem tecla, com um teto de 1,5 s), e a
  varredura da ortografia na nota inteira.
- **O rascunho** continua acompanhando quem digita sem parar, com até 1,5 s de atraso.
- **O que sobra num parágrafo só de 400 KB:** o lezer reparseia o parágrafo, e o preview refaz os blocos.

### T8046: a 1ª ida ao fim de uma nota grande com links trava a janela

Na nota de 821 KB com links, depois de abrir: o clique no texto custa 970 ms, o **⌘↓ custa 13,5 s**, e a **1ª tecla lá
custa 12,0 s**. Da 2ª vez, custam ~100–200 ms. Sem links (962 KB), são 3,4 s e 3,4 s; numa nota de ~200 KB com links,
0,8 s e 0,7 s.

Isso já era assim na `7401cf5`: o `medir-tecla` deu a 1ª tecla em 12,6 s e 24,8 s. A minha tabela de "antes" no T7876
tinha 534 ms como o pior caso dessa nota, e estava errada, porque aquela rodada não pegou a 1ª tecla. O T8046 tem os
números e o roteiro.

## A memória e a CPU paradas

| Processo | Medida |
|---|---|
| engine headless com o cofre de 10 mil, recém-subido | 38 MB |
| o mesmo engine, indexando e servindo 4 janelas | 112–138 MB |
| o mesmo engine, parado depois disso | 76–78 MB em 1–2 min, e **42 MB em 3 min**, com 0% de CPU (antes: 40–41 MB e 0%) |
| helper (o `kiwi-helper` de verdade, sem mic), logo depois de 15 ditados | 110 MB, CPU média 38% e pico 227%, enquanto o modelo trabalha |
| o mesmo helper, parado | 86 MB, 0% de CPU (3 rodadas de 30 s) |
| engine com o helper, sem cofre | 24 MB |

O pico do engine vem da indexação e das janelas. Parado, ele volta sozinho a ~42 MB em uns 3 minutos, então não há
sinal de vazamento. Medi o tempo parado só até os 3 minutos.

## O ditado (`cli dictate`, áudio do `say`)

| Fala | STT | A limpeza e o app | O `cli` inteiro |
|---|---|---|---|
| curta (2,4 s) | 86–119 ms | 1 ms | 248–286 ms |
| média (11 s) | 157–168 ms | 1–6 ms | 331–351 ms |
| longa (74 s) | 585–601 ms | 1–2 ms | 867–887 ms |

Nada do ditado mudou nesta varredura, então esses números valem para o antes e para o depois. O tempo do Fn até o texto
no app de verdade inclui a colagem, que não roda no headless (fica no roteiro do harry).

## Para observar (não é bug confirmado)

- **A 1ª janela logo depois de o engine subir com 10 mil notas** levou 9,0 s (antes, 12,4 s). Ela espera a indexação,
  que leva ~4,5 s. Da 2ª vez em diante, ~1 s.
- **O índice das notas só vive na memória:** reabrir o cofre custa os mesmos ~4,5–5 s de indexar do zero. Um cache em
  disco cortaria o boot seguinte.
- **O ⌘K na janela** leva ~700 ms para as 10 letras, enquanto a busca dos títulos no engine leva 30–40 ms. A diferença
  está no caminho da janela, na digitação letra a letra com uma busca a cada letra. Não medi onde.

## O que não dá para testar sem pessoa (roteiro do harry, no teste final)

1. Abrir o Kiwi Notes (o app de verdade) e contar até a barra e a janela aparecerem, com o cofre dele.
2. Ditar com o Fn uma frase curta e uma longa, e contar do soltar do Fn até o texto aparecer no app da frente.
3. Abrir uma nota grande dele, ir ao fim e escrever (depois do T8046).
