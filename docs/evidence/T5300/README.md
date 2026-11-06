# T5300 · pontuação falada e horas

Spec Kiwi #4881, versão #5312 (onda 0), issue #158.

O problema foi reproduzido antes da mudança:

| Dito | Antes | Depois |
|---|---|---|
| oi vírgula Ana ponto final | Oi vírgula Ana ponto final. | Oi, Ana. |
| hello comma Ana full stop | Hello comma Ana full stop. | Hello, Ana. |
| às três não às quatro | Às 3 não às 4h. | Às 3h não às 4h. |
| o ponto final do projeto | O ponto final do projeto. | O ponto final do projeto. |

Os comandos são tratados antes dos números: `dois pontos` pode virar `:`, mas `três vírgula cinco` continua com o parser de números e vira `3,5`. As guardas conservam usos de substantivo, palavras citadas e termos protegidos pelo dicionário. Aspas saem como `“…”`, reticências como `…`. O ponto final explicitamente ditado é respeitado também no tom casual. Código no tom literal mantém o caminho anterior.

Os casos `L7:` em `app/test/dictation/casos.jsonl` cobrem PT/EN, sinais sozinhos, falsos positivos, decimais e as horas. O teste unitário usa esses mesmos casos; a bateria de ditado os roda de ponta a ponta pelo motor headless. A trava de perda de conteúdo desconta apenas os comandos efetivamente consumidos.

O print mostra uma nota de evidência com as entradas sintéticas e as saídas reais de `cli dictate --text`, gravadas pela CLI e abertas no WebKit headless. Não é uma nova tela de produto. O JSON das chamadas acompanha o print.

Só dados temporários, `say` → STT e inserção dryRun. Sem mic, app na tela, clipboard ou diálogo do macOS. Nenhum áudio entra no Git.

## Validação

- `bun test src scripts ui`: **938 passaram, 0 falharam** (main atualizada, com a issue 212).
- `bun run typecheck`: limpo.
- `KIWI_HELPER=<helper completo> bun run test:dictation --json`: **113/0 texto, 26/0 falado, 30/0 falsos positivos**, sem `known`.
- Helper da bateria final: `main-teste4/native/.build/out/Products/Debug/kiwi-helper` (build de 4/nov, o STT completo preexistente). A mudança desta task é somente TS. O helper foi executado só em `--headless`.
- CLI + WebKit: saídas reais nos JSONs, notas nos temas claro/escuro; `problems`, `blocked` e `invokeErrors` vazios. O print escuro espera 1 s para o editor terminar de montar.

Artefatos: `dictation-validation.json`, `cli-results.json`, `notes-1x-light.png`, `notes-1x-dark.png`. Os relatórios e a captura usam só texto sintético.
