# Os protótipos do spec #12550

Uma página (`proto.html`) desenha as 3 telas com os textos do app: `?skill=<skill>&screen=nota|aparencia|balao&theme=light|dark`.
Cada skill é um CSS em `skills/` (e umas poucas opções de marcação no topo do `proto.html`). O comentário no topo de cada
CSS diz que regra da skill levou a quê.

`assets/` não vai no repo:
- `Inter.woff2` e `PaperMono.woff2`: de `app/ui/src/assets/fonts/`;
- `cat.png`: `app/ui/kiwicat/assets/reference-cutout.webp` reduzido para 320 px (`sips -s format png -Z 320`);
- `instrument.woff2`, `figtree.woff2`, `jakarta.woff2` e `literata.woff2`: Instrument Sans, Figtree, Plus Jakarta Sans e
  Literata, do Google Fonts (OFL). Sem eles, a página cai na fonte do sistema.

Os prints saem num WebKit headless, sem rede (só o servidor local), de dentro de `app/` (o `playwright-core` do app):

```sh
bun ../docs/research/repos-harry/prototipo/shoot.ts <pasta com proto.html e assets> <saída> unslop,impeccable,hallmark,huashu,uupm,designmd
bun ../docs/research/repos-harry/prototipo/folha.ts <pasta com folha.html> <saída>
```

As telas `hoje-*` são o app de verdade: o headless com o agente falso, como o `scripts/agent-proposal-check.ts`, no hub
de 1380×820 em 2x.
