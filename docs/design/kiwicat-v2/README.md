# KiwiCat v2: o gato novo e a intro nova

Os dois pacotes aprovados pelo harry no spec #14755, como vieram, e a análise do que muda no app.

- `agente/`: o gato do agente (`ByteKiwiCat.tsx`, os tokens e a arquitetura). O README dele fala em 4 paletas; o código
  tem 5 (`KIWI_COLOR_PALETTES`).
- `intro/`: a intro nova (`src/`, os tokens e a arquitetura).
- `analise.md`: o mapa de hoje para o novo, o peso medido, os conflitos e os dois specs de implementação (T14773).

Nada daqui é código do app: o app só muda pelos specs que a análise propõe.

## Os `intro/build/*.html` são gerados

Os três HTML de `intro/build/` saem do `intro/src/exportStandaloneHtml.ts` e não estão no git (o `.gitignore` da raiz
ignora `build/`). Para tê-los, da raiz do repo:

```sh
bun docs/design/kiwicat-v2/intro/gerar.ts   # cria intro/build/ e os três HTML
```

Eles têm script inline, então não abrem dentro do app (a CSP das views bloqueia); servem de referência e para os prints.

## A medida e os prints

Os scripts ficam em `app/scripts/kiwicat-v2/` e rodam de `app/`, no WebKit headless, sem nada na tela. O `prints.ts` lê
a intro de `intro/build/`: rode o `gerar.ts` antes. Eles ficam fora do typecheck do app (`app/tsconfig.json`) porque o
`novo.tsx` importa o pacote de `docs/`, que não acha o `react` dali.

```sh
kiwi lock bench --wait
bun scripts/kiwicat-v2/peso.ts <pasta> 30   # o gato de hoje contra o novo; escreve peso.json e um quadro por rodada
bun scripts/kiwicat-v2/prints.ts <pasta>    # a intro pelo ?t=, o modo reduzido e os 5 estados do gato novo
kiwi unlock bench
```

Os prints da T14773 estão no branch `evidence`, em `T14773/`.
