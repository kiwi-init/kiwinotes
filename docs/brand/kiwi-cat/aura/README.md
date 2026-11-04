# A aura do Kiwi-cat (T3720, #4071)

O anel de luz em volta do círculo não apaga: escorre e vira o halo do corpo. O morph é contínuo, e não um crossfade.

- `morph.py`: a luz do `luz-anel` (a origem) e a do destino viram massa numa grade 96². O destino é `final-fundo` +
  `final-corpo` no palco 1024, sem a cabeça inteira (`../gerada/cabeca-inteira.png`). O Sinkhorn dá o transporte
  ótimo. Cada pose é um morph de dois lados: a origem empurrada pelo campo de deslocamento e o destino puxado pelo
  inverso, misturados por `e`. A pose 00 é o `luz-anel` exato, e a última é o destino exato.
- `pose-NN.webp`: RGBA não pré-multiplicado, 512×512, cobrindo o palco 1024 inteiro (escala 2, origem 0,0). Igualmente
  espaçadas no morph: a pose i está em `e = i/(N−1)`. O tempo e o easing ficam com o runtime.
- `--rotacao A`: a pose 00 sai com o anel girado A graus em volta de (512,430), para um anel que gira até o morph começar.
- `tira.png`: 8 das poses, para conferir de olho.

## Runtime (medido)

Um `<canvas>` de 512×512 escalado para o palco 1024. Por frame, desenha duas poses vizinhas: a primeira com `copy` e
`globalAlpha = 1−w`, a segunda com `lighter` e `globalAlpha = w`. Isso dá a mistura linear exata da luz. Duas `<img>`
empilhadas com opacity não dariam essa mistura.

As poses vão pré-decodificadas com `createImageBitmap`: com `<img>` direto, a 1ª rodada teve um engasgo de 230 ms.
`medir-canvas.ts` (WebKit headless, 600pt@2x, `kiwi lock bench`) mediu o desenho em ≤ 1 ms por frame, com a mediana
de 13 ms e o p95 de 14 ms (o mesmo de uma página vazia).

```sh
$KIWI_IMAGE_PYTHON docs/brand/kiwi-cat/aura/morph.py docs/brand/kiwi-cat/camadas docs/brand/kiwi-cat/aura --poses 24
bun docs/brand/kiwi-cat/aura/medir-canvas.ts app docs/brand/kiwi-cat/aura bitmap
```
