# T5558 · E4: fórmulas e realce

KaTeX **0.18.10** passa a dependência direta com versão fixa, igual à que o lock já resolvia pelo Mermaid. O alias do Vite que trocava KaTeX por um stub foi removido. O renderizador de Markdown agora ativa LaTeX e realce e recebe a instância local de KaTeX. A biblioteca gera MathML com `trust:false` e `throwOnError:false`; fórmulas inválidas mostram o texto de erro sem derrubar o editor. Não usa CSS, fontes, CDN nem serviços externos de matemática.

`$…$` aparece em linha; `$$…$$` em bloco. As cores de ambos vêm dos tokens do app, inclusive no escuro. `==realce==` usa a mesma cor no Markdown renderizado e no live preview. Uma extensão Lezer original identifica os pares e os marcadores; código, texto escapado e pares incompletos ficam literais. Na linha ativa os `==` continuam visíveis para editar, com o realce pintado.

Verificação:

- `bun test`: 1.077 testes passaram, zero falhas. `bun run typecheck`: sem erros.
- Três testes focados: realce múltiplo/com acentos/Markdown aninhado, escapes/código/pares incompletos; AST de fórmulas em linha/bloco e código literal; MathML de fração, fórmula inválida e comandos não confiáveis sem injeção de HTML/link.
- `scripts/ui-scripts/notas-formulas-realce.json`: **26 passos em cada tema**, WebKit headless. Confere fração MathML, fórmula inválida, realce renderizado e na linha ativa, cor computada de ambas as fórmulas igual à do tema, código literal, edição, desfazer/refazer e Markdown salvo. Prints claro/escuro inspecionados.
- `notas-imagens-mermaid.json`: 38 passos de regressão passaram após retirar o alias. Sem erros de página/CSP ou tentativa de rede nos roteiros. O resumo e a nota sintética estão em `ui-proof.json`.
- Nenhum helper ou código nativo mudou; sem mic, clipboard real, diálogos ou app na tela.

Reproduzir a partir de `app/`, num diretório novo:

```sh
bun run cli start --no-helper --data /tmp/e4-proof
bun run cli ui notes --script scripts/ui-scripts/notas-formulas-realce.json --theme dark --out /tmp/e4-dark --data /tmp/e4-proof
bun run cli stop --data /tmp/e4-proof
```
