# T5299 · nunca scroll horizontal, largura da nota ajustável

Issue #212, onda 0 do levelup (spec Kiwi #4881, pedido do harry no #5278). Dados sintéticos num tmp, helper desligado, WebKit headless. Nada na tela, sem mic e sem diálogo.

## A causa
O `lineWrapping` estava ligado, mas o CodeMirror põe `flex-shrink: 0` no `.cm-content`, e o `min-width: auto` do flex deixava o conteúdo tão largo quanto a coisa mais larga que não quebra: a URL gigante, o bloco de código ou a tabela. Como o `.cm-scroller` é `overflow: visible`, a coluna inteira crescia, e até o parágrafo comum passava da tela. A `main.kn-center` rolava 3143 px de lado (print `00`).

## Roteiros
```sh
cd app
bun run cli start --no-helper --data "$DIR"
bun run cli ui hub --script scripts/ui-scripts/notas-sem-scroll-lateral.json --data "$DIR" --theme light --size 1380x820
bun run cli ui hub --script scripts/ui-scripts/notas-sem-scroll-lateral.json --data "$DIR" --theme dark --size 640x820
bun run cli ui hub --script scripts/ui-scripts/notas-largura.json --data "$DIR2"        # arrasta
bun run cli ui hub --script scripts/ui-scripts/notas-largura-salva.json --data "$DIR2"  # janela nova: a largura voltou
bun run cli stop --data "$DIR"
```
O passo novo `expectNoHScroll` falha se a página, ou qualquer elemento rolável dentro das Notas, rola de lado. Só o bloco de código, a tabela e o diagrama podem rolar, por dentro. Na falha, ele diz quem passa da borda. Os passos `drag` e `expectWidth` arrastam a alça e medem a coluna.

| print | o que mostra |
|---|---|
| `00-antes-scroll-lateral` | antes: a coluna passa da janela |
| `01-linhas-longas-{larga,estreita}-{claro,escuro}` | URL, palavra gigante e código na linha quebram dentro da coluna |
| `02-codigo-e-tabela-{larga,estreita}-{claro,escuro}` | o bloco de código, a tabela e o diagrama rolam por dentro |
| `03-alca-invisivel-claro` | o mouse acabou de chegar na borda: nada aparece |
| `04-alca-depois-do-hover-*` | depois de 600 ms parado: a linha fina da alça |
| `05-mais-larga-*` | arrastar 150 px alarga 300 px (a coluna é centralizada) |
| `06-no-minimo-claro` | o mínimo, 480 px |
| `07-no-maximo-claro` | o máximo cabe na janela, sem scroll de lado |
| `08-largura-salva-*` | numa janela nova, a largura escolhida voltou das settings |
