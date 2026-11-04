# O Kiwi-cat (spec #3133)

A imagem do gato e as camadas que a intro do app anima (T3720). O harry trocou o Rive por camadas + CSS/JS (#3718).

- **`referencia.jpg`:** a imagem de referência original do harry (#3554), um gato preto sobre cinza claro.
- **`referencia-final.png`:** a pose aprovada a partir dela (#3636, #3677), sobre preto, com o corpo endireitado até o
  rabisco do harry (`rabisco-harry.png`).
- **`gerada/`:** a **imagem final aprovada** (T3705, #3732), em alta resolução, e as camadas com alfa recortadas dela:
  as três entradas da intro (`luz`, `corpo`, `cabeca-inteira`, 2048 × 2560) com o contrato `camadas.json`, e as seis
  peças soltas. Leia o README de lá.
- **`roteiro.md`:** o roteiro da animação, do harry: a emenda com o prisma, os beats da intro (f0–f480), o `idle` de
  12 s, a paleta e o que evitar. A seção técnica está ajustada para CSS/JS.
- **`prancha-intro.png`, `quadros/`, `PRANCHA.md`:** a prancha quadro a quadro aprovada pelo harry (T3747, #3799), o
  alvo visual da intro.
- **`camadas.ts`:** gera `camadas/`, o que o `docs/brand/intro/gerar.ts` embute na intro, a partir de `gerada/`:
  separa a cabeça inteira nas peças que a animação mexe (`cabeca`, `orelha-esquerda`, `orelha-direita`, `aro`), faz o
  queixo se desfazer (com a compensação no `corpo`), cobre o lugar do aro antes de ele acender (`aro-escuro`), monta
  as luzes do começo (`luz-anel`, em volta do círculo, e `luz-cabeca`, a luz real em volta da cabeça com os vãos das
  orelhas preenchidos) e escreve o contrato `camadas/camadas.json` (o espaço, os olhos, os pivôs das orelhas, o
  encaixe no palco e o contorno da cabeça para o clip). As camadas saem em 1024 × 1280 (o palco tem 1024 px).
  `bun docs/brand/kiwi-cat/camadas.ts` (padrão `gerada/`).
- **`pose.ts`:** a pose provisória (a `referencia-final.png` em três camadas, 512 × 640), em `provisoria/`, que serviu
  à intro até a T3705; `bun docs/brand/kiwi-cat/camadas.ts docs/brand/kiwi-cat/provisoria` gera a intro com ela.

Os scripts rodam no WebKit do Playwright do `app/` (`bun install` em `app/`) e precisam do `cwebp`. O `ctx.filter` do
canvas não faz nada no WebKit headless: os blurs são em JS.
