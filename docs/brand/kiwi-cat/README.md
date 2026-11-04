# O Kiwi-cat (spec #3133)

A imagem do gato e as camadas que a intro do app anima (T3720). O harry trocou o Rive por camadas + CSS/JS (#3718).

- **`referencia.jpg`:** a imagem de referência original do harry (#3554), um gato preto sobre cinza claro.
- **`referencia-final.png`:** a **imagem aprovada** (#3636, #3677): a referência, sem redesenhar, sobre preto, com uma luz
  lavanda-cinza que só existe perto do gato, o corpo endireitado e esticado até o rabisco do harry (`rabisco-harry.png`),
  sem o bolsão claro à esquerda.
- **`roteiro.md`:** o roteiro da animação, do harry: a emenda com o prisma, os beats da intro (f0–f480), o `idle` de 12 s,
  a paleta e o que evitar. A seção técnica está ajustada para CSS/JS.
- **`pose.ts`:** gera a pose aprovada a partir da `referencia.jpg` (luz, corpo endireitado, bolsão), em três camadas
  base: `camadas/luz.webp`, `camadas/corpo.webp` e `camadas/cabeca-inteira.webp` (+ `camadas/conferencia.png`, a pilha,
  e `pose-previa.png`, o que o harry viu). `bun docs/brand/kiwi-cat/pose.ts`.
- **`camadas.ts`:** separa a cabeça inteira nas peças que a animação mexe (`cabeca`, `orelha-esquerda`,
  `orelha-direita`, `aro`, `luz-cabeca`) e escreve o contrato `camadas/camadas.json` (o espaço, os olhos, os pivôs das
  orelhas, o encaixe no palco e o contorno da cabeça para o clip). Confere que cabeça + orelhas + aro empilhados dão a
  inteira. `bun docs/brand/kiwi-cat/camadas.ts`.
- **`camadas/`:** as 7 camadas que o `docs/brand/intro/gerar.ts` embute na intro. Espaço da foto (512 × 640), todas em
  (0,0), alfa reto. Os olhos ficam de fora: são vetor na intro.

**As camadas são provisórias**, recortadas da própria referência. As definitivas, em alta resolução, vêm da T3705
(@calm-dingo); elas entram aqui com os mesmos nomes (e o `camadas.json` com o espaço delas), e o `gerar.ts` não muda.

Os scripts rodam no WebKit do Playwright do `app/` (`bun install` em `app/`) e precisam do `cwebp`. O `ctx.filter` do
canvas não faz nada no WebKit headless: os blurs são em JS.
