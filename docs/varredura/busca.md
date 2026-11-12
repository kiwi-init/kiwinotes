# Varredura: Busca (área 5 do spec #7424, T7441)

A varredura foi feita em 2026-11-12, na `main` em `86286ef`. Tudo rodou pelo `notes.search` do engine headless (o mesmo do
⌘K e da busca da árvore), com o vault de verdade num tmp e com o disco na mão. A busca pelo sentido usou o
multilingual-e5-small baixado pelo `ensureModel`, com o SHA conferido, numa pasta do scratchpad (`KIWI_MODELS_DIR`,
porque o headless não baixa), e rodou com o `kiwi lock bench`.

## Resumo

| | Resultado |
|---|---|
| Lexical (BM25), filtros e aproximação: 16 passos, mais 22 buscas com caracteres especiais | sem bug |
| Pelo sentido (e5): indexar, achar, reindexar e tirar | sem bug; um limite de qualidade em "Para observar" |
| As tags e as buscas salvas | sem bug |
| Bugs achados | 0 |

## O que funciona (com o passo que conferiu)

- **Sem acento nem maiúscula:** "REUNIAO DE ORCAMENTO" traz a "Reunião de orçamento" em primeiro.
- **A "frase exata"** casa mesmo quebrada em duas linhas da nota.
- **Os filtros:**
  - `tag:projeto` acha a tag filha `#projeto/kiwi` e a do frontmatter;
  - `-tag:rascunho` exclui;
  - `path:"Minha pasta"`, com espaço, e `-path:Projetos` funcionam.
- **A pasta escondida** (`.obsidian`) nunca aparece.
- **O erro de digitação:** "orcamneto" e "girasol" acham, com `approx: true`, e o exato vem antes do aproximado.
- **A ordem:** a nota com a palavra no título vem antes de uma que só repete a palavra 40 vezes no texto.
- **Os caracteres especiais**, sem erro nenhum:
  - `c++`, `C#`, `.*foo$`, `(grupos)`, `[colchetes]` e `\barra` acham a nota de código;
  - `[[`, `]]`, `"`, `-`, `--`, `tag:`, `path:`, `-tag:`, `#`, `%`, `*`, `?` e o caractere nulo voltam vazios;
  - `日本語` e `café ☕` acham.
- **Busca vazia ou só espaços:** volta vazia.
- **O `limit`:** 0, -1 e 1.5 dão `E_BAD_ARGS`. 1 e 5.000 funcionam.
- **O índice acompanha o disco:** criar, editar, renomear e apagar fora aparecem na busca em 1,5 s.
- **O snippet** mostra o trecho com a palavra.
- **O tempo:** com 220 notas, ~4 ms por busca.
- **Pelo sentido (e5):**
  - as 66 notas ficam prontas em 3 s;
  - "como economizar dinheiro" acha a nota de gastos, "meu cachorro" a do Rex, "férias na praia" a da viagem ao
    litoral e "o sistema ficou fora do ar" a do servidor, todas em 1º e com `semantic: true`;
  - "Rex" (exato) vem antes do sentido;
  - apagar fora tira a nota do índice (66 → 65);
  - nada sai do Mac: o headless nunca baixa o modelo.
- **As tags:**
  - `#Projeto` e `#PROJETO/Kiwi` contam junto com `#projeto/kiwi` (`projeto` 3, `Kiwi` 2);
  - o título `# …`, o `#2026` (só número), a âncora de URL, o `#codigo` em código e o `#bloco` num bloco de código
    não viram tag;
  - as do frontmatter, em lista ou em texto, entram;
  - a tarefa e a citação levam a tag.
- **As buscas salvas:** o engine aceita até 50, sem repetir a busca. O nome fica com até 120 caracteres, e a busca
  com até 500.

## Para observar (não é bug confirmado)

- **O sentido acha frases, mas não palavras soltas:** "sobremesa" (a nota do bolo), "imagens médicas" (a nota do
  PACS) e "felino" (a nota do gato) não voltam nada. O corte do `SemanticIndex` (`NEAR_FLOOR = 0,835` e
  `NEAR_MARGIN = 0,025`) deixa de fora o que uma palavra solta alcança com o e5 small. É uma escolha de qualidade
  calibrada, não um erro. Vale um teste com o harry, nas notas dele, para ver se "sobremesa" achar o bolo faz falta.
- **A busca com mais de 500 caracteres:** dá `E_BAD_ARGS "query must be a string"`, que não diz o motivo (o tamanho).
  Na janela não aparece aviso: o ⌘K cai na busca pelo título, e a árvore mostra "nada encontrado".
- **Uma tag com e sem acento** (`#Reunião` e `#reuniao`) aparece como duas na lista de tags, e a busca `tag:` acha as
  duas. É o mesmo que o Obsidian faz.

## O que não dá para testar sem pessoa (roteiro do harry, no teste final)

1. O ⌘K e a busca da árvore no cofre de verdade dele, com o tempo de resposta enquanto digita.
2. Buscar pelo sentido algo que ele lembra de uma nota, mas sem as palavras dela.
3. Salvar uma busca pelo ⌘K e achar ela na árvore depois de fechar e abrir o app.
