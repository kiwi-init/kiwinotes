# O Kiwi-cat no Rive (spec #3133)

- **`roteiro.md`:** o roteiro da animação de abertura, escrito pelo harry (4 nov 2026). É a fonte do que o gato faz, quadro a quadro: a emenda com o prisma, a névoa em sprites assados, os beats da `intro` (f0–f480), o `idle` de 12 s, a paleta e o que evitar.
- **`svg-para-rive.ts`:** converte um SVG da família (`docs/brand/kiwi-cat-familia/`) num SVG que o importador do Rive entende. Ele desfaz o `<svg>` aninhado e os `<use>` e tira os filtros.
  ```
  bun docs/brand/rive/svg-para-rive.ts docs/brand/kiwi-cat-familia/kiwi-cat-1-aura.svg > /tmp/kiwi-cat-rive.svg
  ```
- **O app** toca o `.riv` pelo `app/ui/intro/rive.ts` (T3154). O combinado com o arquivo está no `docs/brand/intro/README.md`: state machine `intro`, trigger `done` e assets embutidos. A intro só troca para o `.riv` com o ok do harry.
