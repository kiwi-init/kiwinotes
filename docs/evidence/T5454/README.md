# T5454 · L19: merge de 3 vias quando a nota mudou fora

Issue #170, onda 2 do levelup (spec Kiwi #5292). Headless, dados sintéticos num tmp. A edição "de fora" é um `notes.save` pelo engine, como o Obsidian escrevendo no disco.

```sh
cd app
bun run cli start --no-helper --data "$DIR"
bun run cli ui hub --script scripts/ui-scripts/notas-merge.json --data "$DIR" --theme light
bun run cli stop --data "$DIR"
```

| print | o que mostra |
|---|---|
| `01-juntado-sem-aviso-*` | eu escrevo no fim e o Obsidian muda o começo, ao mesmo tempo: as duas entram, sem aviso |
| `02-so-o-trecho-que-bate-*` | os dois acrescentaram no fim, e o Obsidian também mudou o começo: o aviso mostra só o trecho do fim, a sua versão ao lado da de fora |
| `03-resolvido-*` | "Manter a minha": a minha linha fica no fim, e o começo do Obsidian entra junto |

Depois do roteiro, o arquivo no disco é `Intro do Obsidian.` + a lista + `Minha linha.`.
