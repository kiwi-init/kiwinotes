# A intro do Kiwi Notes (T2113, protótipo)

A animação de abertura do spec #2078, aprovado pelo harry (#2111): Kiwi init → Channels → Kiwi-cat. Este é o protótipo
em HTML para o harry aprovar. A janela `intro` no app vem numa task própria, ligada ao hub (`HubDeps.intro`, T2121).

**Para ver:** abra `intro.html` no Safari. Um clique pula, e "De novo" toca outra vez.
- `?gato=2`: a abertura do gato no dobro da velocidade.
- `?t=2.5`: congela o frame daquele instante.

![Os 6 tempos](prancha.png)

## Os 6 tempos
| s | O que acontece |
|---|---|
| 0,0 | Preto: a base do ícone aparece, e a borda de um prisma é desenhada, de frente. |
| 0,8 | "Kiwi init" aparece no meio, e o arco-íris passa pelo prisma na diagonal. |
| 1,5 | O nome some, e o prisma vira 3D, girando no próprio eixo para cima. |
| 2,0 | Ele se expande em três prismas (o logo), com o arco-íris passando pelo vidro dos três. |
| 2,7 | Os três voltam para dentro de si e viram um liquid glass redondo, que vira uma bola preta. |
| 3,7 | Da bola começa a abertura do Kiwi-cat (a Aura do T2025), com a animação dela intacta. Ela leva ~8 s. |

**O prisma** é desenhado aqui, em CSS. O SVG do Channels não é copiado, porque o repo dele é privado e este é público:
são lâminas de cantos arredondados, com a espessura em listras holográficas, como na variação Lâmina do T2025.

## Por que é leve
- **Só `transform` e `opacity` animam,** e cada peça é uma camada. Assim a GPU só move e esmaece texturas prontas.
- **O 3D do prisma:** cada camada (a face e as 4 da espessura, das 3 lâminas) tem a transformação inteira, amostrada
  da linha do tempo a 60 por segundo (Web Animations). Não usa `preserve-3d`, que o WebKit headless achata e que
  depende da ordenação 3D.
- **Nada é borrado ao vivo** (#2085). O `gerar.ts` assa num bitmap a aura e a luz de borda do gato:
  - a aura a 1/12 do tamanho, porque o blur dela tem desvio de 38 a 62;
  - a luz de borda a 1/5.

  As camadas giram e esmaecem esses bitmaps. A borda de vidro e o contorno escuro do T2025 saem em vetor.
- **A borda de vidro do T2025** era morfologia (`feMorphology`) no filtro do gato. Medido aqui, ela custava **~1,4 s
  por frame** com as partes se mexendo. Agora ela e a luz de borda são camadas paradas, da pose final, que acendem
  quando a parte delas termina de se formar: o corpo e a cabeça aos 4,8 s do gato, e o rabo aos 6,0 s, balançando
  junto com ele.
  - **É a única diferença de aparência:** no zip, a luz de borda seguia as partes enquanto elas se formavam.
- **Pinta antes de precisar:**
  - o gato está no palco desde o começo, parado e invisível, e a passagem da bola só solta as animações;
  - as camadas da borda começam em opacidade 0,003, e não 0, porque o WebKit não pinta uma camada invisível.

## A medida
Medida no WebKit headless do Playwright (o mesmo do `cli screenshot`), numa janela de 600 pt em 2x, com o
`kiwi lock bench`. O tempo de cada frame vem do `requestAnimationFrame`.

| | fps | mediana | p95 | pior |
|---|---|---|---|---|
| Prisma (0–3,7 s) | 56–59 | 17 ms | 18 ms | 135–200 ms, no 1º frame depois da carga |
| Gato (3,7–12,5 s) | 59 | 17 ms | 18 ms | ~100 ms, quando os olhos acordam (o brilho do olho é um filtro pequeno) |
| O gato do zip, sem mudança (512 pt, 2x) | 9 | 141 ms | 172 ms | 193 ms |

- **O headless pinta em software.** No app, o WKWebView tem a GPU, então a medida aqui é o pior caso.
- **Peso:** o `intro.html` tem 100 KB, com os bitmaps e o gato dentro, e não depende de nada de fora.

## Arquivos
- `intro.template.html`: o modelo, com o prisma, a linha do tempo e o script. **Edite este.**
- `gerar.ts`: monta o `intro.html` a partir do modelo e de `../kiwi-cat-familia/kiwi-cat-1-aura-intro.svg`. Ele assa
  os bitmaps no WebKit do Playwright do `app/`, então rode antes `bun install` em `app/`:
  `bun docs/brand/intro/gerar.ts`.
- `intro.html`: o gerado. É o que se abre, e o que vai para a janela `intro` do app.
- `prancha.png`: os 6 tempos.
