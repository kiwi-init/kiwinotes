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
- **Peso:** o `intro.html` tem 138 KB (com a aura a 1/8, T2308), com os bitmaps e o gato dentro, e não depende de nada de fora.

## No app (T2308)
A janela `intro` do app sai daqui também: o `gerar.ts` escreve `app/ui/intro/index.html` e `app/ui/intro/intro.js`.
- **O script** vai num arquivo do pack, porque a CSP das janelas não deixa script inline.
- **O fundo** é transparente, e o "De novo" sai.
- **No app** (com o `window.engine`), o script avisa que subiu (`ready`) e, no fim, chama o `intro.done`; o main fecha a
  janela e abre o hub. Isso vale para o último frame, o clique para pular e o "Reduzir movimento".
- **A aura** vai a 1/8, e não mais a 1/12: a 1/12, o quadro parado a 2x tinha degraus em cima da cabeça. A 1/6 não muda
  nada a olho, e 1/8 custa +37 KB (o `intro.html` vai a 138 KB e a janela do app, a 130 KB).
- **Para conferir** sem abrir nada na tela (com o `kiwi lock bench`): `bun run cli ui intro --script
  scripts/ui-scripts/intro-fim.json` (com movimento reduzido) e `bun run cli ui intro --motion --script
  scripts/ui-scripts/intro-pular.json` (o clique para pular), em `app/`.

## Arquivos
- `intro.template.html`: o modelo, com o prisma e a linha do tempo. **Edite este.**
- `intro.js`: o script da linha do tempo. **Edite este.**
- `gerar.ts`: monta o `intro.html` a partir do modelo, do `intro.js` e das camadas de `../kiwi-cat/camadas/`:
  `bun docs/brand/intro/gerar.ts`.
- `frames.ts`: os frames-chave da intro, para aprovação.
- `intro.html`: o gerado, o protótipo que abre sozinho no navegador. A janela do app é `app/ui/intro/`, gerada junto.
- `prancha.png`: os 6 tempos.

## O Kiwi-cat em camadas (T3720, spec #3133)
Desde o T3720 o gato da intro é a imagem aprovada pelo harry (`docs/brand/kiwi-cat/referencia-final.png`) em camadas,
animada com CSS pelos beats do `docs/brand/kiwi-cat/roteiro.md` (8 s a 60 fps a partir da emenda com o prisma, aos 3,7 s).
- **As camadas** (`docs/brand/kiwi-cat/camadas/`, WebP com alfa, geradas das da T3705 pelo `camadas.ts`) entram como
  `<img>` embutidos, uma por camada do palco: a luz, o anel de luz do começo, a luz da cabeça, o corpo, a cabeça, as
  duas orelhas, o aro em preto e o aro. Os olhos são dois círculos em HTML. A imagem (4:5) vai à largura do palco, com
  os olhos em (512, 414): a luz termina nas bordas do palco, não numa caixa. O `gerar.ts` encaixa
  tudo pelo `camadas.json` e escreve a geometria (origens, olhos, o clip das orelhas) num `<style>`; a linha do tempo
  (os `@keyframes` de cada beat) fica no modelo, na seção 6.
- **Nada é borrado ao vivo:** as camadas já vêm macias, e o CSS só move, gira, escala e esmaece.
- **O clip das orelhas** é o contorno da cabeça em `clip-path: path()`: o WebKit não aplica `clip-path: url(#id)` em
  elementos HTML.
- **Os frames-chave:** `bun docs/brand/intro/frames.ts` captura, do `intro.html` com o `?t=`, os frames f0, f48, f126,
  f190, f230, f268, f390 e f480 e monta uma prancha (`frames/`). No app: `bun run cli ui intro --motion --query t=11.7`.
- **O Rive saiu** (`app/ui/intro/rive.ts` e o `@rive-app/canvas-single`): o harry escolheu camadas + CSS/JS (#3718).
