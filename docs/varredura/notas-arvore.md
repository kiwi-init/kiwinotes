# Varredura: Notas, a árvore e o cofre (área 4 do spec #7424, T7437)

A varredura foi feita em 2026-11-12, na `main` de `c925a44` a `eade960`. Tudo rodou pelo engine headless
(`bun run cli start --no-helper`), com o vault num tmp e com o disco na mão: criar, renomear e apagar fora no meio do
passo. A janela Notas rodou num WebKit headless pelo `openWindow` do `cli ui`. Nada apareceu na tela de ninguém, nada foi
para o Lixo do macOS (veja "Para observar"), e o seletor de pasta não abriu: no headless, ele é o
`KIWI_TEST_NOTES_FOLDER`.

## Resumo

| | Resultado |
|---|---|
| Pastas e notas: criar, renomear, mover, apagar e restaurar (12 passos pelo engine) | sem bug |
| Os watchers (criar, renomear e apagar fora; 300 de uma vez) | sem bug |
| Abrir outra pasta | sem bug |
| Os visualizadores (13 arquivos, inclusive hostis) e o conflito no texto | sem bug |
| O quadro (canvas) | sem bug, mas o link para ele é o T7616 |
| Nota que não é UTF-8 | 1 bug: **T7575**, já na `main` pelo #313 |
| Link para arquivo do cofre | 1 bug: **T7616** |
| A Lixeira e os avisos de "já existe" | 1 bug: **T7656** |
| Bugs achados | 3, cada um com task própria e o teste que falha na `main` |

## Bugs

### T7575: a nota que não é UTF-8 perde os acentos (corrigido no #313)

**Passo:** uma nota `.md` em Latin-1 (`# Reunião … Ação … orçamento`) linka `[[Alvo]]`. Renomear `Alvo.md`.

- **O que acontecia:** o renomear reescrevia o link dessa nota, que a pessoa nem abriu, com o texto lido como UTF-8. Os 4
  acentos viravam U+FFFD **no disco**, sem volta, e o `skippedPaths` vinha vazio. Editar a própria nota fazia o mesmo.
- **Depois do #313:** a nota abre só para leitura, com o aviso. Nada grava por cima, e quem reescreve outras notas a
  pula e a lista em `skippedPaths`. Conferido com o `shasum` de uma nota Latin-1 e de uma UTF-16: os bytes ficaram
  iguais depois do renomear, do mover pasta, do renomear tag e de um save direto.

### T7616: `[[relatorio.pdf]]` cria uma nota vazia em vez de abrir o pdf

**Passo:** `docs/relatorio.pdf` está no cofre, e uma nota tem `[[relatorio.pdf]]`. Clicar no link na janela.

- **O esperado:** o pdf abre no visualizador das Notas, como pela árvore.
- **O que acontece:** a janela cria e abre `relatorio.pdf.md`, vazia, ao lado do pdf. O aviso de links quebrados acusa
  `[[relatorio.pdf]]`, `[[fluxo.drawio]]` e `[[Mapa.canvas]]`, mesmo com os arquivos ali. Num vault do Obsidian, esses
  links são comuns.
- **A causa:** o `notes.resolve` só acha notas. O link que não resolve vira `createFromLink`.

### T7656: os avisos de "já existe" nunca aparecem no app

**Passo:** apagar `A.md`, criar outra `A.md`, e "Restaurar" a primeira na Lixeira.

- **O esperado:** "Já existe “A” nesse lugar: renomeie e tente de novo.".
- **O que acontece:** "Não deu para restaurar.", sem o porquê. A nota nova fica intacta, o que está certo, mas em 10 min
  a apagada vai para o Lixo do macOS sem a pessoa saber o que fazer. O mesmo vale para os avisos do `failed_` (criar,
  renomear, mover e duplicar).
- **A causa:** o AppEngine manda o código em `error.code`, e a UI o procura no texto do erro. O mock põe o código no
  texto, por isso o `notes-ui-check` não pegava.

## O que funciona (com o passo que conferiu)

- **Pastas e notas pelo engine:**
  - renomear uma pasta com notas linkadas: os links seguem (`moved: 2, updatedLinks: 1`), e o aviso de links não acusa
    nada;
  - mover uma pasta para dentro dela mesma: recusado ("can't go inside itself"), sem perder nada;
  - trocar só a maiúscula do nome de uma pasta (`Pessoas` → `pessoas`) e de uma nota (`Ana` → `ana`): o disco e a lista
    seguem, e os links também;
  - apagar e restaurar uma nota e uma pasta com notas: volta igual;
  - restaurar com o nome ocupado de novo: `E_EXISTS`, sem sobrescrever a nova;
  - duplicar duas vezes: `ana 2.md` e `ana 3.md`;
  - mover para uma pasta onde já há uma nota com o mesmo nome: `E_EXISTS`;
  - symlink para fora do cofre, de pasta e de nota: não entra na lista, e ler ou gravar por ele dá `E_OUTSIDE_VAULT`.
- **Os watchers:** uma pasta criada, renomeada e apagada fora aparece certa na lista. 300 notas criadas fora de uma vez
  entram todas, em ~0,25 s.
- **Abrir outra pasta:** uma pasta de projeto, com `.git`, `.obsidian` e `node_modules` (1.600 `.md`), abre com as 2
  notas de verdade. `node_modules`, `.git` e `.obsidian` ficam de fora, e o app não escreve nada na pasta da pessoa.
- **Os visualizadores** pela janela de verdade, todos `ready`, sem erro na página e **sem nenhum pedido de rede**:
  - json (com `#` no nome), tsv e txt de 4,1 MB;
  - csv de 30 mil linhas, com uma fórmula `=HYPERLINK(…)`, que aparece como texto;
  - dois pdfs;
  - dois docx: um normal, e outro com uma imagem ligada por fora e um link `javascript:`;
  - xlsx, com o aviso da aba escondida;
  - dois draw.io, inclusive o `hostil.drawio` do repo;
  - um svg com `<script>`, `onload`, `<image href=https://…>` e `<iframe>`;
  - png.
- **O conflito num texto:** editar um `.txt` enquanto a mesma linha muda fora mostra "O arquivo mudou fora do Kiwi
  Notes enquanto você editava." com "Usar o de fora" e "Manter o meu". O texto digitado fica na tela.
- **O quadro (canvas):**
  - um JSON quebrado é recusado ("o .canvas não é JSON");
  - salvar com uma versão velha não sobrescreve o que mudou fora;
  - renomear funciona.
- **A Lixeira:** a lista mostra quanto falta para cada item ("volta por mais 9 min"), e "Restaurar" sem nome ocupado
  volta a nota.

## Para observar (não é bug confirmado)

- **O headless usa o Lixo de verdade:** o engine headless usa o `macTrash` (`/usr/bin/trash`). O que um teste apaga vai
  para o Lixo do macOS da pessoa do Mac depois de 10 min, ou já com o "Mandar para o Lixo agora" (`trash.empty`).
  Nesta varredura, cada engine foi parado e a pasta dele apagada antes dos 10 min, e o `trash.empty` não foi usado. Um
  `trash` de teste no headless (apagar dentro do tmp) evitaria isso.
- **O link para um quadro ou arquivo não segue um renomear:** renomear `Mapa.canvas` não reescreve `[[Mapa.canvas]]`.
  Hoje esse link já não resolve (T7616). Quando resolver, o renomear de arquivos vai precisar reescrever os links.

## O que não dá para testar sem pessoa (roteiro do harry, no teste final)

1. "Abrir outra pasta…" com o seletor do macOS, numa pasta de verdade dele (um vault do Obsidian, se tiver).
2. Apagar uma nota, esperar os 10 min e ver ela no Lixo do macOS. "Mostrar o Lixo no Finder".
3. Abrir no Kiwi um pdf, um docx e uma planilha de verdade dele, e um arquivo no iCloud que ainda não baixou.
