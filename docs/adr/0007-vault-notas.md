# ADR 0007: as notas são um vault de Markdown puro, e o índice vive na memória

- Status: aceito (T1316, spec #1107).
- Código:
  - [`app/src/notes/vault.ts`](../../app/src/notes/vault.ts): o vault, o índice, a busca e o watcher;
  - [`paths.ts`](../../app/src/notes/paths.ts): a fronteira do vault;
  - [`app/src/shared/wikilinks.ts`](../../app/src/shared/wikilinks.ts): os `[[links]]`;
  - `bun test src/notes` e `bun run notes:bench`.

## Contexto
As notas do Kiwi Notes (spec #1107) têm que abrir no Obsidian sem perder nada, e a pessoa pode editar as mesmas notas nos dois apps.

## Decisão
- **Um `.md` por nota, em `~/KiwiNotes`.** `KIWI_VAULT_DIR` troca a pasta, para testes e agentes. A pasta só nasce na primeira vez que alguém usa as notas. Cada nota tem frontmatter YAML e links `[[nota]]` / `[[nota|apelido]]` / `[[nota#seção]]` / `![[embed]]`.
- **O app não reescreve o que a pessoa não salvou.** Só mexe numa nota que ela salvou ou criou, ou no `[[link]]` de outra nota num rename. A escrita é atômica: grava ao lado e faz `rename`, então o Obsidian e o watcher nunca veem metade de uma nota.
- **Não há banco.** O índice (títulos, texto dobrado, links e tags) vive na memória e se refaz do disco ao abrir. O watcher (`fs.watch` recursivo, que é FSEvents no macOS) pega o que muda fora, como no Obsidian, no Finder ou num `git pull`, e manda o `notes.changed`.
- **O título é o nome do arquivo sem `.md`, como no Obsidian.** Um título repetido vira "Título 2", e os caracteres que o Obsidian e o macOS não aceitam num nome viram espaço.
- **`[[link]]` → nota, com a regra do Obsidian, num lugar só** (`makeResolver`):
  - sem barra, vale o nome do arquivo, em qualquer pasta, sem diferença de maiúscula nem acento; com dois iguais, o caminho mais curto;
  - com barra, o caminho;
  - o engine usa a mesma função no `notes.resolve`, no `notes.rename` e nos backlinks (#1323).
- **Rename:** move a nota e troca os links das outras que apontavam para ela, mantendo a seção, o apelido e o embed. Escreve só o nome quando ele basta para achar a nota, senão o caminho.
- **Toda escrita é condicional (revisão #1397).** Antes de trocar o arquivo, a escrita relê o disco e confere a versão; se mudou, não escreve.
  - o `save` devolve o conflito;
  - o `rename` relê aquela nota e tenta de novo;
  - o `create` passa para "Título 2".

  O `rename` parte do disco, nunca da memória: ele refaz o índice antes e reescreve cada nota a partir do que está no arquivo. Assim, uma edição feita no Obsidian que o watcher ainda não viu não some.
- **Delete:** vai para a Lixeira do macOS (`/usr/bin/trash`), de onde dá para voltar. Não apaga.
- **Conflito:** cada nota tem uma `version` (o sha256 do conteúdo). O `save` com uma `baseVersion` velha não escreve e devolve a nota de agora; a UI mostra "mudou fora".
- **A fronteira:** todo caminho é relativo ao vault. `..`, caminho absoluto, `~`, barra invertida, link simbólico (conferido em cada pedaço que existe) e pasta com ponto (`.obsidian`, `.trash`) dão `E_OUTSIDE_VAULT`. O índice não entra em link simbólico nem em pasta com ponto.

## Desempenho
Com 1.000 notas sintéticas (`bun run notes:bench`, M1 Pro):
- abrir e indexar: ~130 ms;
- busca: mediana de ~9 ms (a meta era < ~200 ms);
- backlinks: ~3 ms;
- rename com links: ~130 ms, porque refaz o índice do disco antes, para não perder edição de fora; sem isso era ~5 ms.

Duas coisas fizeram diferença:
- o trecho da busca só é montado para os resultados que voltam (montar para todos custava 288 ms);
- a resolução de links prepara os mapas uma vez, até as notas mudarem (do zero, os backlinks custavam 624 ms).
