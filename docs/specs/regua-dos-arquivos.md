# A régua dos arquivos

O que todo tipo de arquivo cumpre nas Notas (spec #21156 do Kiwi, task T21236). O harry pediu (#21008, #21065, #21080) que planilha, docx e afins sejam melhores no Kiwi que no app padrão, sem nenhuma função que seja exceção de um tipo de arquivo. Esta página é a regra escrita, e `app/test/regua/` é a prova que roda sozinha.

## A regra

**Um tipo de arquivo novo só entra no app com a linha dele toda preenchida nesta tabela.** O teste da régua quebra quando um tipo de `VIEWER_TYPES` não tem linha. Cada "falta" aponta o spec do Kiwi ou a issue que a fecha, e cada "n/a" leva o motivo.

## Os 12 itens

| # | O item | Vale para | Como se confere |
|---|---|---|---|
| 1 | **Abre rápido** e legível de primeira, sem ajuste da pessoa | todos | teste: a fixture difícil abre pelo leitor do app em até 1,5 s, com o texto de dentro (a 1ª abertura, a fria, tem de ficar em até 3 s; acima de 1,5 s, ela se repete até 3 vezes e falha se nenhuma fica em 1,5 s). O docx abre nas Notas pelo motor do T21151, que desenha num canvas: a prova dele é o `app/scripts/docx-check.ts`, com a mesma regra |
| 2 | **Arquivo grande** não trava: rola liso ou avisa o limite | todos | teste: acima do limite (5 MB de texto, 25 MB de binário) vem o aviso; a planilha e o csv de 50 mil linhas e a nota de 2 MB abrem em até 10 s |
| 3 | **Buscar dentro** (⌘F) | todos com texto | pela leitura do código (é da tela) |
| 4 | **Entra na busca do app** e no ⌘K | todos com texto | teste: a palavra que só existe dentro do arquivo é achada pelo `vault.search` |
| 5 | **Editar**, com desfazer e refazer | os editáveis | teste: grava uma mudança pelo caminho do app (o desfazer é da tela) |
| 6 | **Gravar não estraga:** o que o Kiwi não entende fica como estava | os editáveis | teste: depois de gravar, o arquivo é o original byte a byte, menos a mudança (tabs, acento, `\r\n`) |
| 7 | **Histórico de versões** | os editáveis | pela leitura do código (é da tela) |
| 8 | **O Kiwi Cat lê** | todos com texto | teste: o `notes_read` ou o `files_read` traz o texto de dentro |
| 9 | **O Kiwi Cat edita, e a pessoa vê ao vivo** | os editáveis | teste: o escritor do agente (falso) troca um trecho; o ao vivo é da tela |
| 10 | **Recusa em vez de arriscar:** o que não dá para abrir ou gravar com segurança fica só leitura, com o aviso | todos | teste: o texto que não é UTF-8 fica só leitura e não é gravado; o binário estragado não abre |
| 11 | **Tudo local:** nenhum pedido de rede | todos | teste: as conferências acima rodam com o `fetch` preso, e nenhum pedido sai |
| 12 | **O trackpad do Mac:** rolar com dois dedos para todo lado, pinça para dar zoom, e os gestos que o app padrão tem (#21198) | todos | pela leitura do código (é da tela) |

## A tabela, tipo × item

Como ler as células:
- **cumpre**: o item já vale para o tipo;
- **falta spec #N** ou **falta issue #N**: ainda não vale, e o spec do Kiwi ou a issue do GitHub fecha;
- **n/a: motivo**: o item não se aplica;
- **abre fora**: o tipo segue no app padrão, e o harry decide depois quais ganham visualizador.

O teste lê esta tabela entre os marcadores. Nos itens com teste, um "cumpre" que quebra falha o `bun test`, e um "falta" que passa também falha, pedindo a troca para "cumpre" aqui. Na coluna das extensões, `CODE_TYPES` e `MEDIA_TYPES` são as listas de `app/src/shared/file-view.ts`.

<!-- regua:inicio -->
| Tipo | Extensões | 1. Abre rápido | 2. Arquivo grande | 3. Buscar dentro (⌘F) | 4. Busca do app e ⌘K | 5. Editar | 6. Gravar não estraga | 7. Histórico | 8. O gato lê | 9. O gato edita | 10. Recusa em vez de arriscar | 11. Tudo local | 12. Trackpad |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **nota** | `md` | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | falta spec #21198 |
| **txt** | `txt` | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre |
| **log** | `log` | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre |
| **json** | `json` | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre |
| **yaml** | `yaml` `yml` | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre |
| **csv** | `csv` `tsv` | cumpre | cumpre | falta spec #21065 | cumpre | falta spec #21065 | falta spec #21065 | cumpre | cumpre | falta spec #21033 | cumpre | cumpre | cumpre |
| **código** | `CODE_TYPES` | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre |
| **pdf** | `pdf` | cumpre | cumpre | cumpre | cumpre | n/a: o Kiwi só mostra o pdf | n/a: o Kiwi só mostra o pdf | n/a: o Kiwi só mostra o pdf | cumpre | n/a: o Kiwi só mostra o pdf | cumpre | cumpre | cumpre |
| **docx** | `docx` | cumpre | cumpre | cumpre | cumpre | falta spec #21080 | falta spec #21080 | falta spec #21080 | cumpre | falta spec #21155 | cumpre | cumpre | cumpre |
| **xlsx** | `xlsx` | cumpre | cumpre | falta spec #21065 | cumpre | falta spec #21065 | falta spec #21065 | cumpre | cumpre | falta spec #21033 | cumpre | cumpre | cumpre |
| **imagem** | `png` `jpg` `jpeg` `gif` `webp` `heic` `heif` `bmp` | cumpre | cumpre | n/a: sem texto (o OCR fica fora da régua) | n/a: sem texto (o OCR fica fora da régua) | n/a: o Kiwi só mostra a imagem | n/a: o Kiwi só mostra a imagem | n/a: o Kiwi só mostra a imagem | n/a: sem texto (o OCR fica fora da régua) | n/a: o Kiwi só mostra a imagem | cumpre | cumpre | cumpre |
| **svg** | `svg` `drawio.svg` | cumpre | cumpre | n/a: abre como imagem, e o texto é a marcação do desenho | n/a: abre como imagem, e o texto é a marcação do desenho | n/a: o Kiwi só mostra o desenho | n/a: o Kiwi só mostra o desenho | n/a: o Kiwi só mostra o desenho | n/a: abre como imagem, e o texto é a marcação do desenho | n/a: o Kiwi só mostra o desenho | cumpre | cumpre | cumpre |
| **drawio** | `drawio` | cumpre | cumpre | cumpre | cumpre | n/a: o diagrama se edita no draw.io, e o Kiwi só mostra | n/a: o diagrama se edita no draw.io, e o Kiwi só mostra | n/a: o diagrama se edita no draw.io, e o Kiwi só mostra | cumpre | n/a: o diagrama se edita no draw.io, e o Kiwi só mostra | cumpre | cumpre | falta spec #21198 |
| **mídia** | `MEDIA_TYPES` | cumpre | cumpre | n/a: sem texto (o OCR fica fora da régua) | n/a: sem texto (o OCR fica fora da régua) | n/a: o Kiwi só toca o áudio e o vídeo | n/a: o Kiwi só toca o áudio e o vídeo | n/a: o Kiwi só toca o áudio e o vídeo | n/a: sem texto (o OCR fica fora da régua) | n/a: o Kiwi só toca o áudio e o vídeo | cumpre | cumpre | falta spec #21198 |
| **quadro branco** | `canvas` | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre | cumpre |
| **abre fora** | `doc` `xls` `pages` `numbers` `pptx` | abre fora | abre fora | abre fora | abre fora | abre fora | abre fora | abre fora | abre fora | abre fora | abre fora | abre fora | abre fora |
<!-- regua:fim -->

## Os arquivos difíceis

Ficam em `app/test/regua/arquivos/` e são gerados por `bun test/regua/arquivos.ts --write` (em `app/`). O conteúdo é todo inventado: o estoque de uma loja. Cada fixture tem a palavra `quindimrosa`, que só existe dentro dela. As fixtures são estas:
- a planilha com mescla, validação, painel congelado, gráfico e fórmula;
- o docx com alteração controlada, equação e tabela;
- o csv com `;`, acento e `\r\n`;
- o `.py` com tabs;
- o pdf, a imagem, o svg, o diagrama, o áudio e o quadro branco.

**As grandes não entram no repo.** A planilha e o csv de 50 mil linhas, o json de 5 MB e os arquivos acima do limite são gerados na hora do teste, num tmp.

## O que a régua ainda não confere sozinha

Os itens 3, 7 e 12, o "legível de primeira" e o "ao vivo" só se veem na tela. Para eles, o estado da tabela vem da leitura do código. Quando um spec fecha um desses itens, a troca na tabela vai no PR dele, com o script de tela e o print.
