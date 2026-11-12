# Varredura: Histórico, Ajustes, Hub e Sobre (área 6 do spec #7424, T7442)

A varredura foi feita em 2026-11-12, na `main` de `86286ef` a `1410178`. Tudo rodou pelo engine headless, com os dados
num tmp, e pelos roteiros de `scripts/ui-scripts/` (`bun run cli ui`, WebKit headless). Nada apareceu na tela de
ninguém, e o atualizador não baixou nada: no headless ele é o `UPDATES_OFF`, e o "Verificar atualizações" foi
conferido pelos testes dele.

## Resumo

| | Resultado |
|---|---|
| Os roteiros da área (11, de `ajustes-*`, `aparencia*`, `hub-*` e `sobre-*`) | 9 ok; 1 pede o helper; 1 velho (veja abaixo) |
| `history-ui-check` (o "Enviar para nota…" do Histórico, com a CSP) | 7/7 |
| `bun test` do atualizador e dos ajustes (`updates`, `settings`) | 39/0 |
| Os ajustes guardados depois de reiniciar o engine | sem bug |
| O `settings.json` que não é JSON | 1 bug: **T7816** |
| Bugs achados | 1, com task própria e o teste que falha na `main` |

## Bugs

### T7816: um `settings.json` que não é JSON derruba o app ao abrir as Notas

**Passo:** na pasta de dados, o `settings.json` está cortado (`{"cues": false, "dailyFolder": "Diário/2026", `), por
exemplo editado à mão ou restaurado pela metade de um backup. As Notas abrem (`notes.list`).

- **O esperado:** os ajustes voltam ao padrão, o app segue, e o arquivo torto fica guardado ao lado.
- **O que acontece:**
  - o `settings.get` dá `E_FAILED "JSON Parse error"`;
  - 4 s depois do `notes.list`, o processo do engine cai, com a rejeição sem dono do boot da busca pelo sentido e do
    `folders-workspace`;
  - um `settings.set` não conserta o arquivo, porque lê antes de gravar.
- **No app:** o mesmo código roda no processo principal do Bun, sem handler de `unhandledRejection`. Então o app deve
  fechar toda vez que abre, até a pessoa apagar o arquivo. Isso é dedução: o app não foi aberto (AGENTS.md).

## O que funciona (com o passo que conferiu)

- **Os ajustes ficam guardados:** 10 ajustes mudados pelo `settings.set` voltam iguais depois de parar e subir o
  engine de novo. São eles: modelos, nota do dia e anexos (as pastas), OCR, busca pelo sentido, mostrar extensões, sons,
  largura da nota, uma busca salva e o tamanho do texto.
- **Os valores inválidos são recusados**, sem gravar:
  - `noteWidth` -5 e "larga";
  - o mic "../../etc";
  - a nota do dia em "../fora" (`E_OUTSIDE_VAULT`);
  - a pasta de modelos vazia;
  - `ocr` "sim";
  - o tamanho do texto "gigante";
  - uma chave que não existe.
  - Também são recusados um atalho das Notas igual ao de pausar o mic e um campo das reuniões que não existe.
- **Um campo torto no arquivo** (`noteWidth: "abc"`, com o resto certo) vira o padrão só nele, e os outros ajustes
  ficam.
- **Os roteiros que passaram:**
  - `ajustes-microfone` 17/17;
  - `ajustes-sentido` 13/13, com o e5 baixado e o SHA conferido;
  - `aparencia` 26/26;
  - `hub-abas-foco` 29/29;
  - `hub-diagnostico` 8/8;
  - `hub-hover` 19/19;
  - `hub-notas-teclas` 31/31;
  - `hub-sobre` 12/12;
  - `sobre-sem-imagem` 7/7.
  - Nenhum erro de página nem de CSP.
- **O clique no texto com cada tamanho de letra:** numa nota de 60 linhas, o clique cai na linha certa em "Padrão"
  (linha 25), "Grande" (12), "Maior" (40) e "Máximo" (33). Conferido pela marca digitada no lugar e gravada no disco.
- **O Histórico:**
  - o "Enviar para nota…" (nota nova e nota que existe, sem mandar duas vezes no clique duplo) sobe sem violação de
    CSP;
  - o `history.search` recusa o `limit` fora de 1–500;
  - o `history.delete` de um id que não existe, ou com `../`, devolve `false`, sem erro e sem apagar nada.
- **O atualizador:** os 39 testes do `updates.test.ts` e do `settings.test.ts` passam, com o fetch de mentira.

## Para observar (não é bug confirmado)

- **O roteiro `aparencia-clique.json` está velho:** ele procura `.cm-line` com "Linha 25 do teste", mas as linhas de
  um parágrafo agora aparecem como um `<p>` só, no texto renderizado fora do cursor. O passo dá timeout, mas o
  comportamento que ele confere funciona (veja acima). Trocar o clique por coordenadas do texto, ou separar as linhas
  da nota por linha em branco, conserta o roteiro.
- **O `ajustes-modo-preciso.json` pede o helper e o Whisper:** sem eles (`--no-helper`), o passo "o helper carregou o
  Whisper" não tem como passar. O ditado preciso foi conferido na área 1 (T7438).

## O que não dá para testar sem pessoa (roteiro do harry, no teste final)

1. "Verificar atualizações" no Sobre, com um build de verdade, e o "Atualizar e reiniciar" quando houver versão nova.
2. Os temas claro e escuro e o tamanho do texto, na tela dele.
3. Trocar o atalho das Notas e do ditado nos Ajustes, e conferir que o novo funciona e o velho não.
