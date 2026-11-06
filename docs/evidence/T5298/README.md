# T5298 · a pasta das notas dentro da navegação do topo

Issue #211, onda 0 do levelup (spec Kiwi #4881, pedido do harry no #5275). Dados sintéticos num tmp, helper desligado, seletor falso via `KIWI_TEST_NOTES_FOLDER`. Nada de app na tela, microfone, diálogo ou seletor real.

```sh
cd app
# DIR/vault/Nota interna.md, DIR/vault/Reuniões/… (type: meeting) e EXTERNA="…/Obsidian de teste" com Projeto Atlas.md e Pessoas/Ana.md
KIWI_TEST_NOTES_FOLDER="$EXTERNA" bun run cli start --no-helper --data "$DIR"
bun run cli ui hub --script scripts/ui-scripts/notas-pasta-na-arvore.json --data "$DIR" --theme light --out OUT
bun run cli stop --data "$DIR"
```

O mesmo com `--theme dark` e um `DIR` novo. O roteiro antigo, `notas-pasta.json` (T5161), foi ajustado para o controle novo e continua passando.

| print | o que mostra |
|---|---|
| `01-topo-sem-botao-extra-*` | o topo das Notas: só o botão da árvore, na posição original, sem o botão da pasta ao lado |
| `02-arvore-com-a-pasta-*` | a árvore aberta: a pasta raiz (`vault`) é a primeira linha |
| `03-abrir-pasta-na-arvore-*` | a pasta raiz aberta: "Abrir pasta…" dentro da árvore |
| `04-recentes-na-arvore-*` | com outra pasta aberta, a anterior aparece como recente, também dentro da árvore |
| `05-atalho-nos-ajustes-*` | Configurações › Notas › Pasta das notas continua igual |
