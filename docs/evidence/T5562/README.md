# T5562 · E5: buscar, substituir e recolher Markdown

`⌘F` abre a busca local na nota e `⌥⌘F` põe o foco em Substituir. O painel é do CodeMirror, traduzido e com as cores do app: próximo/anterior (`Enter`/`⇧Enter`, `⌘G`/`⇧⌘G`), diferença de maiúsculas, palavra inteira, expressão regular, substituir uma ou todas. `Esc`/Fechar devolve o foco ao editor. A barra de formatação não cobre os resultados.

Enquanto o painel está aberto, os previews são suspensos e o Markdown aparece como texto: ocorrências em tabelas, código, anexos e blocos renderizados continuam visíveis e selecionáveis. Fechar restaura os previews; entrada de anexos e comandos de edição continuam disponíveis. O compartimento é reconfigurado fora do update do editor, com guarda contra fechamento da view.

O gutter e o teclado padrão de folding do CodeMirror recolhem/expandem títulos e listas. No Mac, `⌥⌘[` recolhe e `⌥⌘]` expande; `⌃⌥[`/`⌃⌥]` agem em todos. Títulos incluem subseções até o próximo título de nível equivalente ou superior. Listas incluem o restante dos itens (ou filhos de um item aninhado), sem engolir o parágrafo seguinte. O placeholder clicável expande, e navegar até um resultado recolhido também expande o trecho. Clique no gutter mantém o foco no editor. Folding não altera o Markdown salvo.

Verificação:

- `bun test`: **1.080 testes, zero falhas**; `bun run typecheck`: sem erros.
- Três testes novos, 201 verificações: colisões com atalhos padrão/legados do Kiwi, formatação e tabelas; seções de títulos, limites de listas e mapeamento dos trechos após edição. A normalização de pontuação que não é aceita pelo registro global não interfere na comparação de F/G.
- `scripts/ui-scripts/notas-busca-dobra.json`: **69 passos em cada tema**, WebKit headless. Busca com quatro ocorrências em texto/tabela/código; diferencia maiúsculas; navega; `⌥⌘F`; substitui uma e todas; desfaz/refaz; restaura previews; recolhe/expande título pelo teclado e gutter; busca dentro de seção recolhida; recolhe lista e expande pelo placeholder. O Markdown salvo foi comparado com o original: apenas quatro substituições por ACHADO, nenhum caractere perdido no folding.
- `notas-markdown.json`: 38 passos de regressão passaram. Sem erros de página/CSP nos roteiros. Prints inspecionados em claro e escuro. `ui-proof.json` guarda o resumo e a nota sintética salva.
- Sem helper, mic, clipboard real, diálogos ou app na tela; nenhum código nativo mudou.

Reprodução a partir de `app/`, com diretório novo:

```sh
bun run cli start --no-helper --data /tmp/e5-proof
bun run cli ui notes --script scripts/ui-scripts/notas-busca-dobra.json --theme dark --out /tmp/e5-dark --data /tmp/e5-proof
bun run cli stop --data /tmp/e5-proof
```
