# T5352 · L20: índice de notas com cache, aliases e fsync

Issue #171, onda 1 do levelup (spec Kiwi #5289). Tudo em pastas temporárias, sem tocar no `~/KiwiNotes`.

## Medida (`bun run notes:bench`, M1 Pro, sob `kiwi lock bench`)
| | 1 mil antes | 1 mil depois | 10 mil antes | 10 mil depois |
|---|---|---|---|---|
| abrir e indexar | 145 ms | 89 ms | 1645 ms | 814 ms |
| reabrir (o boot seguinte) | 134 ms | 83 ms | 1613 ms | 731 ms |
| rename com links | 151 ms | 30 ms | 1987 ms | 216 ms |
| rename para outra pasta | 143 ms | 24 ms | 1870 ms | 204 ms |
| notas relidas pelo rename | 1000 | 0 | 10000 | 0 |

**Onde o tempo estava** (perfil com 10 mil notas): percorrer as pastas com `lstat` ~150 ms, ler os arquivos ~390 ms, um 2º `stat` por nota ~150 ms, e o resto (hash, dobrar o texto, YAML, links) ~55 ms. Por isso:
- **Cache em memória:** pelo inode, pelo tamanho e pelo mtime, o scan reaproveita a entrada sem reler. O rename, a pasta movida, o desfazer e o watcher ainda partem do disco (revisão #1397), mas só com `lstat`. Uma pasta renomeada por fora é reconhecida pelo inode, e as notas só trocam de caminho.
- **Leitura mais rápida:** sem o 2º `stat`; os `lstat` de cada pasta e as leituras das notas que mudaram rodam em paralelo, até 64 e 16 de cada vez.
- **Sem cache em disco do índice:** o que se poupa nele é a análise, ~55 ms. Poupar a leitura pediria guardar uma cópia do texto de todas as notas fora do cofre, e isso não compensa.

## Aliases
`aliases:` (ou `alias:`) do frontmatter, em lista YAML, `[a, b]` ou texto, entram no resolver, como no Obsidian. O nome do arquivo ganha do apelido. Um rename não reescreve `[[Apelido]]`, que continua achando a nota.

| print | o que mostra |
|---|---|
| `01-apelido-e-link-que-falta-*` | `[[Ana Souza]]` (apelido da nota Ana) é link; `[[Fulano]]` fica apagado, porque não existe |
| `02-abriu-pelo-apelido-*` | o clique no apelido abriu a nota Ana |

## fsync
A escrita atômica da nota (e o registro da Lixeira) faz o `fsync` do arquivo temporário antes do `rename`, e o da pasta depois.
