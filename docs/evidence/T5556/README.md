# T5556 · E2: menu do editor

Menu de clique direito com Formatar, Parágrafo e Inserir; recortar, copiar, colar e colar sem formatação. Os comandos usam as transações da E1 e os blocos do `/`. Também abre com Shift+F10 ou a tecla de menu. Setas navegam os níveis; Esc volta e devolve o foco ao editor.

Validação por CLI/WebKit headless, sem helper e com clipboard falso:

- `notas-menu-editor.json`: 64 passos em claro e escuro; seleção preservada pelo clique direito, tachado, copiar/colar, recortar/desfazer, título por submenu de teclado, voltar com seta/Esc e inserir separador. Passou também em 640×560.
- `notas-menu-borda.json`: submenu abre à esquerda na borda; sem scroll horizontal. O teste revelou a largura variável do menu perto da borda; a largura agora vem do conteúdo e a medida ignora a escala da animação.
- `notas-menu-arvore.json`: o menu compartilhado da árvore continua duplicando notas.
- `notes.get` confirmou o Markdown salvo. Os únicos textos de clipboard do relatório são “Texto selecionado”, produzidos pelo próprio roteiro; nada foi lido ou escrito no clipboard do Mac.

`bun test src scripts ui`: 1.044 passaram, zero falhas. `bun run typecheck`: sem erros. Há testes de falha ao recortar, clipboard vazio, leitura atrasada, troca/fechamento da nota e comportamento de URL versus colagem literal. A capacidade `clipboard.read` tem limites de texto e argumentos e só é chamada na ação Colar. No headless e com `KIWI_DEBUG=1`, leitura e escrita ficam numa peça falsa em memória.

Prints: `light/` e `dark/` mostram os três submenus e o resultado; `narrow/` mostra a borda; `menu-arvore.png` mostra a regressão da árvore. `ui-proof.json` contém o resumo dos roteiros e o Markdown sintético salvo.

Na rodada 2, o submenu se ancora na borda do painel pai com 2 px de folga, usando medidas sem a escala da animação. Os atalhos do menu principal ficam inteiros. A barra de seleção some enquanto o menu está aberto e volta ao fechar com a seleção preservada; os dois estados foram verificados pelo roteiro nos dois temas e em 640×560. Os prints foram refeitos.
