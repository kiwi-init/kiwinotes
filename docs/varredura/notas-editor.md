# Varredura: Notas, o editor (área 3 do spec #7424, T7436)

A varredura foi feita em 2026-11-12, na `main` em `31a27b3`, e as conferências do T7513 em `99ae879`. Tudo rodou pelo
engine headless (`bun run cli start --no-helper`), com o vault de verdade num tmp e a janela Notas num WebKit headless,
pelo mesmo `openWindow` do `bun run cli ui`. Assim dava para mexer no disco no meio do passo: apagar, renomear ou editar
a nota "no Obsidian" enquanto o editor tinha texto por gravar. Nada apareceu na tela de ninguém. Alguns casos de engine
foram direto pelo `bun run cli invoke`.

## Resumo

| | Resultado |
|---|---|
| Salvar, conflito e desfazer (S1–S11, U1–U3, W1) | 1 bug (T7513, já na `main` pelo #302) |
| Rascunho (a edição que não gravou) | 1 bug: **T7516** |
| Renomear e nomes de nota | 1 bug: **T7520** |
| Colar HTML, embeds, rodapé, callout, foco | sem bug |
| Bugs achados | 3, cada um com task própria e o teste que falha na `main` |

## Bugs

### T7513: a nota some fora com texto por gravar e o editor esvazia (corrigido no #302)

**Passo:** digitar numa nota e, antes do autosave (500 ms), apagar (`rm`) ou renomear (`mv`) o arquivo fora do app.

- **O esperado:** o texto fica no editor, com um aviso para a pessoa escolher.
- **O que acontecia:** o título e o editor ficavam vazios, sem aviso. O texto só voltava como rascunho órfão quando a
  janela abria de novo, o que no app é o próximo início.
- **Depois do #302:** o texto fica, com "Descartar" e "Recuperar como nota nova". Até a pessoa escolher, nada é
  gravado e a janela não sai da nota. Se o arquivo volta, o texto grava.

### T7516: o rascunho perde as propriedades que não gravaram

**Passo:** com o save falhando (a pasta do vault em `chmod 555`), mudar `status: rascunho` para `PUBLICADO` no painel de
propriedades e recarregar a janela.

| Caso | Ao reabrir | Depois do "Recuperar" |
|---|---|---|
| Só a propriedade mudou | nenhum aviso; o rascunho é apagado calado | nada a recuperar |
| A propriedade e o corpo mudaram | "Esta nota tem uma edição… Recuperar" | o corpo novo com o `status` velho |

- **O esperado:** o "Recuperar" volta com o frontmatter, como já faz o rascunho órfão (#1538).
- **A causa:** o `show()` compara só o corpo do rascunho, e o `recoverDraft()` grava com o frontmatter do disco.

### T7520: renomear para um nome com `#`, `|` ou `[ ]` quebra os links

**Passo:** uma nota com três links de outra nota (`[[Reuniao]]`, `[[Reuniao#Pauta]]`, `[[Reuniao|a reunião]]`) é
renomeada pelo título.

| Nome novo | O app diz | Os links |
|---|---|---|
| `Reunião #2` | "3 links atualizados" | não acham a nota; as menções somem |
| `Ana \| Bia` | "3 links atualizados" | não acham a nota; as menções somem |
| `Plano [v2]` | "3 links atualizados" | acham a nota, mas as menções somem |
| `Nota ^3` | "3 links atualizados" | funcionam |

- **O esperado:** o renomear não deixa links quebrados. Recusar o nome ou trocar o caractere resolve.
- **A causa:** o `#` e o `|` são sintaxe do link, e o `]` fecha o link antes da hora. A UI só troca `\ / :`.

## O que funciona (com o passo que conferiu)

- **Salvar:**
  - digitar e abrir outra nota antes do autosave grava o texto;
  - 12 rajadas de digitação com pausas de 380–650 ms, no meio dos autosaves, terminam com o disco igual ao editor,
    sem linha repetida nem faltando;
  - renomear pelo título com texto pendente leva o texto para o nome novo;
  - o frontmatter fica igual, byte a byte, quando só o corpo muda;
  - o BOM e a falta de newline no fim ficam como estavam.
- **Conflito com edição de fora:**
  - de fora numa linha e eu noutra: as duas se juntam, sem aviso;
  - os dois na mesma linha: o aviso mostra o trecho, e "Manter a minha" e "Usar a de fora" gravam o lado certo, com o
    resto do meu texto junto;
  - de fora sem nada pendente: a nota recarrega sozinha;
  - duas janelas na mesma nota, cada uma digitando no fim: uma grava e a outra mostra o conflito, sem perder nada.
- **Desfazer:**
  - ⌘Z depois do autosave volta o disco, e ⇧⌘Z refaz;
  - depois de uma junção, ⌘Z desfaz só a minha linha; a edição de fora fica;
  - depois de uma recarga de fora, ⌘Z não volta o texto de antes;
  - trocar de nota e voltar começa um histórico novo;
  - mover uma seção pelo Sumário volta com um ⌘Z só.
- **Colar HTML:**
  - negrito, link, lista com subitem e tabela viram markdown, e o `|` dentro da célula sai escapado;
  - o `<script>` some;
  - o HTML de e-mail, com estilos, `&nbsp;` e `<o:p>`, sai limpo;
  - uma imagem de fora vira `![](https://…)`, que só baixa com o clique da pessoa (T2984), e a CSP da janela não tem
    `https:`.
- **Renderização:** o embed `![[B]]`, a nota de rodapé `[^1]` e o callout `> [!warning]` aparecem certos, sem erro na
  página.
- **Modo foco:** ligar e desligar no meio da digitação não perde texto.
- **Nomes de nota:**
  - uma nota com acento decomposto (NFD, como o Finder grava) resolve pelo link `[[Ação]]` digitado, abre e grava sem
    duplicar o arquivo;
  - criar "b" com "B.md" no vault dá "b 2.md", sem sobrescrever;
  - um nome começando com ponto (que vira arquivo oculto) é recusado, e um nome de mais de 200 caracteres também.

## Para observar (não é bug confirmado)

- **Lentidão numa nota grande:** o tempo por tecla cresce com o tamanho da nota, de ~33 ms numa de 39 KB a ~280 ms
  numa de 1 MB, e abrir uma nota de 1 MB cheia de `[[links]]` levou 3,6 s. A máquina estava carregada (load ~31, com
  outros agentes), então esses números não valem como medida. O suspeito é o trabalho no texto inteiro a cada tecla
  (o `markdownStructure` do Sumário, o `wordCount` e o rascunho no `localStorage`). Fica para a área Desempenho
  (T7443), medida com o `kiwi lock bench`.
- **CRLF:** uma nota com fim de linha do Windows (`\r\n`) volta toda em `\n` no primeiro save. O texto não muda, só o
  fim de linha do arquivo inteiro.
- **"Recuperar como nota nova" depois de um renomear fora** (do #302): a nota nova usa o nome velho, ao lado da
  renomeada, então a pessoa fica com duas cópias do corpo. Isso é a leitura do código, não testado com o clique.

## O que não dá para testar sem pessoa (roteiro do harry, no teste final)

1. Digitar numa nota aberta no Kiwi e, ao mesmo tempo, editar a mesma nota no Obsidian: o aviso de conflito e os dois
   botões.
2. Renomear uma nota no Finder com texto por gravar: o aviso do #302, com "Recuperar como nota nova".
3. Colar de verdade (⌘V) um trecho de e-mail e de uma página da web.
