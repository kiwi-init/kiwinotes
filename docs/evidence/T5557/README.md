# T5557 · E3: operações de tabela

Operações puras em `table.ts`, compartilhadas pelo submenu Tabela e pelos atalhos que só agem dentro de tabelas. Código original do Kiwi.

- Linha: inserir acima/abaixo, mover, duplicar e apagar. O cabeçalho e o separador são estruturais; apagar a última linha de dados mantém o cabeçalho. Duplicar o cabeçalho cria uma cópia como linha de dados.
- Coluna: inserir à esquerda/direita, mover, duplicar e apagar, levando cabeçalho, alinhamento e todas as células juntos. A última coluna fica protegida.
- Alinhamento: esquerda, centro, direita ou padrão por coluna.
- Ordenação natural crescente/decrescente pela coluna, só nas linhas de dados; estável nos empates, sem diferença de caixa/acento, vazios no fim em ambos os sentidos. O cursor acompanha a linha e a coluna operadas.

Cada operação estrutural tem seu próprio desfazer/refazer. Atalhos de operações indisponíveis são consumidos para evitar que caiam na exclusão normal de texto; isso tem teste de regressão e verificação de cabeçalho no roteiro.

Verificação:

- `bun test src scripts ui`: 1.057 passaram, zero falhas. `bun run typecheck`: sem erros.
- `table.test.ts` + `table-operations.test.ts`: 21 testes, cobrindo estrutura, seleção, pipes escapados, cabeçalho, última coluna, ordenação estável, notas ao redor, blocos de código e undo/redo.
- `scripts/ui-scripts/notas-operacoes-tabela.json`: 89 passos em WebKit headless, claro e escuro. Abre o menu na célula renderizada; duplica e move linha, duplica/move/apaga coluna, alinha, ordena, apaga linha, desfaz/refaz e insere nova linha. Confere o resultado renderizado e o Markdown salvo.
- Sem helper, microfone, clipboard, diálogos ou janela na tela. Só dados criados pelo roteiro.

Os atalhos aparecem nos próprios menus: ⌥⌘ + setas move; ⇧⌥⌘ + setas insere; ⌥⌘D/⌫ duplica/apaga linha, com ⇧ para coluna; ⌥⌘L/E/R/0 alinha; ⌥⌘S e ⇧⌥⌘S ordenam. Tab/⇧Tab/Enter continuam funcionando. Nos roteiros Playwright, letras com Shift usam maiúscula (`Shift+D`, `Shift+Z`) para representar o evento de teclado real.

Os prints de `light/` e `dark/` mostram Linha, Coluna, Ordenar e o resultado final. `ui-proof.json` resume as execuções e contém o Markdown sintético salvo.
