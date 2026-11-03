# Mockup da janela Notas (aprovado)

A opção que o harry escolheu na sala #ui/ux (#1235): a **B v4, uma superfície só**. Ela é a referência visual do spec
"Kiwi Notes: o app de notas" (#1107).

Para ver: `open docs/mockups/notas/index.html`. O modo escuro abre com `#dark` no fim do endereço.

## Princípios (#1203, #1214, #1222)
- **Nenhuma linha nem borda.** A separação e a hierarquia vêm do espaço, do tamanho e do peso do texto.
- **Uma superfície só:** a barra lateral, a nota e o contexto não têm fundo próprio nem cartão.
- **Cor só em botão e controle:** Buscar ⌘K, Ditar (a ação principal, em verde), Abrir no BonsAI, os checkboxes e a
  área onde soltar o ditado.
- **Pouca coisa na tela:** a barra lateral só com pastas e notas, a nota com título, meta e texto, e à direita só
  "Citada em" e o board do BonsAI.

É HTML/CSS estático, com os tokens do app (`tokens.css` é cópia de `app/ui/src/styles/tokens.css`, com o escuro por
classe). A nota de exemplo é inventada. As versões anteriores (A, B, C, B v2 e B v3) ficam na branch `kn/mockup-notas`.
