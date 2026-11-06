# T5704 · duplicar linha pelo menu

Remove o atalho direto de Duplicar linha, preservando a operação no menu Tabela ▸ Linha. O menu permite escolher a ação por teclado (End, ↑, Enter no roteiro).

A primeira combinação, ⌥⌘D, é do Dock ([Apple](https://support.apple.com/en-us/102650)). A alternativa ⇧⌘D é a Nota do dia em `shortcuts.ts`. O teste novo compara todas as combinações de tabela com o Dock, os padrões do registro do app e os presets legados das Notas; também detecta colisões entre operações de tabela. Antes da correção ele falhou identificando `row.duplicate / Dock do macOS`.

Validação: 15 testes focados passaram; typecheck sem erros. O roteiro de tabela passou 93 passos em cada tema, incluindo a ausência de dica de atalho em Duplicar linha e a execução da ação pelo teclado do menu. A colagem e o clipboard não foram usados. Todos os dados são criados pelo próprio roteiro; helper desligado.

Os prints claro e escuro mostram a ação sem atalho. As evidências originais da E3 permanecem em T5557, no commit da implementação inicial.
