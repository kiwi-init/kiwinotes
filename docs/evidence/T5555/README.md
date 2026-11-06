# T5555 · E1: comandos de formatação

Implementação iniciada pelo swift-crane (f211c14); retomada por quiet-ibis em worktree própria e validada em WebKit headless.

`app/scripts/ui-scripts/notas-comandos-formatacao.json` aplica os atalhos numa nota de teste, confere o Markdown e os novos botões, aguarda o autosave e captura o resultado. Claro e escuro passaram (111 passos cada), sem erros, rede bloqueada ou clipboard. O helper fica desligado.

Os prints `comandos-formatacao.png` mostram o resultado e a barra com tachado e realce; `markdown-gerado.png` mostra a marcação. O realce é inserido como `==texto==`; a pintura é a E4. O comentário `%%` não aparece na prévia.

Validação: `bun test src scripts ui` 1.035/0; `bun run typecheck` sem erros. O Markdown salvo também foi conferido por `notes.get`: título, tachado, realce, código, comentário, URL, texto limpo, lista, numerada, tarefa marcada e citação.
