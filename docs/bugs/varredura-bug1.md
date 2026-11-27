# Varredura de bugs: a metade do bug1

Spec #32486 do Kiwi Channels, task T32494 (@patient-ocelot). A varredura só mapeia: cada bug virou uma issue com o rótulo `bug`, a reprodução e a gravidade, e quem corrige são os builders.

Tudo rodou na `main` em `e613641a`, pela CLI headless e pelo WebKit headless, com os dados num tmp, sem mic, sem diálogo do macOS e sem nada na tela de ninguém. Os exemplos são inventados (Ana, Projeto X).

## As issues

| issue | gravidade | área | o quê |
|---|---|---|---|
| #457 | P0 | Notas | os erros da Lixeira e do OCR punham o nome da nota ou do anexo no `kiwi.log` (corrigido fora do mapa: T32572, PR #460) |
| #461 | P0 | Headless (os testes) | sem `KIWI_FAKE_AGENT=1`, a CLI dos testes usava o agente de verdade (corrigido fora do mapa: T32699, PR #462) |
| #449 | P1 | Calendário | `calendar.update` só com `start` (o "muda para as 15h" do agente) ou só com `end` grava outra duração |
| #465 | P1 | Notas | o botão direito no título da 1ª linha da nota não dá o "Renomear título e seus links" |
| #450 | P2 | Calendário | o Feito numa vez da repetição apaga as vezes de antes, ainda abertas |
| #466 | P2 | Calendário | na cascata das sobreposições, a caixa de cima cobre a hora do item de baixo |

## O que rodou, por área

### Notas
- Pela CLI headless (`notes.*`, `folders.*`), os caminhos de erro:
  - títulos com `/`, `..`, `:`, tab, quebra de linha, emoji, 250 letras, multibyte longo, `CON`, só espaço e vazio;
  - um nome em NFD criado fora do app;
  - renomear só a caixa, por cima de uma nota que existe (mesma caixa e outra), para uma pasta nova, para fora do vault, para um não-`.md`;
  - pastas: mover para dentro de si, renomear só a caixa, apagar com conteúdo;
  - gravar depois de a nota sumir do disco;
  - os `[[links]]` (com `#seção`, `|apelido` e `![[embed]]`) ao renomear e mover, sem mexer no código;
  - a busca com e sem acento; as tags (renomear, maiúscula e minúscula); duplicar; a nota do dia com data que não existe; `createFromLink` com `..`;
  - o HTML do exportar com `<script>`, `onerror` e `javascript:` (sai escapado).
- O log: o que as Notas deixam no `kiwi.log` (#457).
- Os checks de tela que não estão no CI: `notes-reload`, `notas-pasta`, `note-model`, `note-width`, `files`, `docx`, `planilha`, `planilha-edita`, `txt-typing`, `trackpad`, `editor-jump`, `context-menu`, `references` e `celula`. Todos passaram; o `trackpad` falhou uma vez (o ⌘+ no csv) e passou de novo.
- Os roteiros de `scripts/ui-scripts/` das Notas, dos arquivos, da árvore, da barra e da busca (#465 saiu do `notas-refactor`).

### Calendário
- Pela CLI headless (`calendar.*`) e pelo `parseWhen`/`rewriteWhen`: título com data, tag do tipo, 🔔, 🔕 ou 🔁 (barrados), o item que passa da meia-noite, 24 h exatas, o fim antes do começo, mudar só o começo ou só o fim (#449), a repetição no período e no mês seguinte, o Feito numa vez da repetição (#450), o período com `from` depois do `to`.
- `calendar-ui` (pt e en: as 4 vistas, o hover, o painel largo, o filtro, arrastar, esticar, o + Novo, o link para as Notas) e `calendar-line-jump`.
- A Semana no tema escuro, com itens sobrepostos (#466).

### Início e o Hub
- `home-hub`, `home-views`, `hub-crumb` e `intro-hub` (fora do CI), mais os roteiros `hub-*` e `intro-*` de `scripts/ui-scripts/`.
- `home.today`, `home.pending` e `home.week` pela CLI, com nomes longos, emoji e NFD.
- A Início e as abas no tema escuro.

### Ajustes
- `settings-ui`, `settings-tabs`, `settings-topics` e `ajustes-models` (fora do CI). O `settings-topics` falhou uma vez ("Abrir a memória" deixou a linha fora da vista) e passou de novo.
- Os roteiros `ajustes-*`, `aparencia*` e `barra-*` de `scripts/ui-scripts/`, com o agente falso.
- Os Ajustes no tema escuro.

### Inglês e português
- `calendar-ui` nas duas línguas; os checks de inglês das Notas e dos Ajustes já rodam no CI (`english-checks`).

## Roteiros instáveis (sem issue)
- `trackpad-check`: o ⌘+ no `Loja/precos.csv` não aumentou uma vez, com a máquina carregada.
- `settings-topics-check`: a linha da Memória fora da vista uma vez, também com a máquina carregada.

## Sugestão (não é defeito)
**Os roteiros de `scripts/ui-scripts/` sem quem os rode.** Dos 105 roteiros que rodei, 85 não têm um check nem um passo do CI que os rode. A semente de que precisam (as pastas `Docs/` e `Dados/`, um `fluxo.drawio`) e a env (`KIWI_FAKE_UI`, `KIWI_FAKE_UPDATES`, `KIWI_FAKE_SPELLING`, o helper, o modelo do sentido, `--motion`) só aparecem no nome de um passo. Rodados como o README ensina, eles falham por falta dela e não pelo app, e assim um defeito de verdade fica escondido no meio: o #465 estava assim. O `barra-rolagem` ficou desatualizado depois das abas internas dos Ajustes (T31770): o assunto Notas não rola mais. Proposta: cada roteiro declarar no JSON a semente e a env, e um check rodar todos.
