# A pasta das notas (T5161, spec #5149)

A pasta comum começa em `~/KiwiNotes/`. **Abrir pasta…**, no controle das notas, no menu da barra ou em Configurações → Notas, escolhe outra pasta pelo seletor do Mac. Uma pasta comum fica ativa por vez. As recentes permitem voltar sem mover nem copiar os arquivos. A escolha persiste ao reiniciar.

Markdown, wikilinks e anexos continuam no disco, compatíveis com o Obsidian. `.obsidian/` não é lida nem alterada. O índice ignora arquivos/pastas ocultos e `node_modules/`. Acima de 20.000 arquivos visíveis, a pessoa confirma antes de indexar; a interface mostra a contagem e o progresso. Raiz do disco, pasta pessoal inteira e pastas do sistema são recusadas. Um erro de acesso informa o caminho e mantém a pasta anterior.

Fixadas, modelos, diário, anexos e buscas salvas são separados por pasta. Configuração global (aparência, atalhos, microfone etc.) continua global. Registro de pastas, preferências e versões ficam no Application Support; nada visível do Kiwi é criado no cofre. O desfazer da exclusão usa a `.kiwi-trash/` oculta já existente.

**Reuniões ficam sempre em `~/KiwiNotes/Reuniões/`.** A aba Reuniões lista e abre essas notas usando o contexto interno, mesmo com outra pasta comum ativa. Editar, renomear, apagar e desfazer na aba continuam internos. O histórico do ditado continua no Application Support. Enviar um ditado para uma nota usa a pasta comum ativa.

Cada abertura cria um contexto com raiz imutável. Chamadas que já começaram terminam na raiz original; a UI envia o id do contexto e uma chamada atrasada de uma pasta externa desativada é recusada com `E_FOLDER_CHANGED`. Rascunhos no localStorage usam a chave estável da pasta; o mesmo nome relativo em duas pastas não mistura o texto.

## Agentes e testes

O headless usa o vault tmp padrão e só admite seletor falso (`KIWI_TEST_NOTES_FOLDER`). Além dos dados internos, a trava protege a pasta real selecionada e as recentes, inclusive por symlink. Nunca teste o seletor nativo ou leia pastas pessoais.

```sh
cd app
bun test src/notes/folders-workspace.test.ts src/headless/guard.test.ts ui/notes/drafts.test.ts
bun run typecheck
```

O roteiro visual em `scripts/ui-scripts/notas-pasta.json` usa a CLI headless e pastas sintéticas; preparação e evidência em `docs/evidence/T5161/`. A validação no Obsidian real fica com o harry, via lead.
