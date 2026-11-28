# Varredura de bugs 2: a gota, o Calendário e as abas dos Ajustes

Spec #33713 do Kiwi Channels, task T33747 (@friendly-hare). A varredura só mapeia. Cada bug virou uma issue com:
- o rótulo `bug`;
- a reprodução;
- a gravidade;
- o print, quando é de tela.

Quem corrige é o próximo spec.

Tudo rodou na `main` em `c93fdbf8`, pelo `bun test`, pela CLI headless e pelo WebKit headless (`cli ui`), com os dados num tmp e o agente falso. Os roteiros de tela rodaram com o `kiwi lock bench`. Não houve mic, toda inserção foi com `dryRun`, não abriu diálogo do macOS e não houve nada na tela de ninguém. Os exemplos são inventados (Ana, Projeto X, Ensaio da banda).

Antes de abrir cada issue, conferi as issues abertas e as 11 do spec #33093. As do Calendário que já estão em correção (#449, #450 e #466) não se repetem aqui. O #484 é o #449 num caminho que a correção dele não cobre.

## As issues

| issue | gravidade | área | o quê |
|---|---|---|---|
| #484 | P1 | Calendário | numa nota com `agenda:`, mudar só o começo (o `calendar_update` do agente) grava `15:00-11:00`, e um fim antes do começo passa |
| #485 | P2 | Calendário | o Sim do Kiwi ("passe para amanhã, 9h") numa pendência repetida atrasada só anda a série 1 dia, muda a hora de todos os dias e a sugestão volta |
| #486 | P2 | Calendário | os avisos releem do disco toda nota com caixa aberta a cada 30 s: ~317 ms de CPU por conferência com 3.000 notas |
| #491 | P2 | Calendário | o "+ Novo" no Mês sugere o 1º dia da grade, que cai no mês anterior (Dezembro → 30/11) |
| #492 | P2 | Calendário | o "+ Novo" com o tipo Nota diz "Vai para Calendário.md", e cria `<título>.md` |
| #493 | P2 | Calendário | um título com `#foco`, 🔔 ou `@ 2…` no "+ Novo" dá "Não consegui gravar na nota", sem o motivo |
| #494 | P2 | Calendário | a Agenda em pt diz "Sexta-Feira, 27 De Novembro" (o `text-transform: capitalize`) |
| #495 | P2 | Calendário | na janela estreita (760 px), a cabeça dos dias da Semana se sobrepõe |
| #496 | P2 | A gota e a barra | na janela estreita (640 px), os botões das Notas ficam por cima das abas |
| #497 | P2 | Ajustes | o "Ligar o agente" do gato dormindo abre a última aba do Agente, não a Geral, onde está o interruptor |

## O que rodou, por área

### A gota (#470)
- `hub-goo-check` (claro e escuro):
  - a ida e a volta quadro a quadro, com pescoço, gota solta e sem rastro;
  - o pior quadro em tempo real: 63 ms no claro e 56 ms no escuro, com meta de 100;
  - a seção lenta e a troca no meio;
  - o "reduzir movimento" do Mac e do Kiwi.

  Tudo ok.
- `goo-speed-check`: em 1000 e 1600 px, a frente anda ≥ 1 px por quadro e o maior salto fica abaixo do da `main`. Ok.
- `hub-tabs-ui-check`, `hub-crumb-check`, `hub-english-check` e `speed-check`: ok.
- `cli ui` com movimento:
  - cliques seguidos sem esperar: Notas › Ajustes › Notas › Calendário › Notas › Ditado › Notas, e depois Ajustes, Notas e Ajustes a 120 ms;
  - em 1300 e em 640 px, em pt e em en.

  A gota assenta e não sobra cópia dos botões (`.kn-goo-ghost` = 0). A 640 px, o lugar dos botões já está em cima das abas (#496).
- `bun test ui/hub/goo*`: ok.

### O Calendário (#445, #447)
- `calendar-ui-check` (pt e en):
  - as 4 vistas, o hover com o ⤢, o painel largo com Item · Nota · Ligações e o ⤡;
  - o filtro por tipo e por projeto, que fica ao recarregar;
  - arrastar e esticar, que escrevem na nota;
  - o "+ Novo", o link para a nota na linha e o vídeo do painel largo.

  Ok. Também `calendar-line-jump-check` e `kiwicat-hub-check`: ok.
- `bun test` do Calendário (`ui/calendar`, `src/bun/calendar*`, `src/shared/calendar*`, as ferramentas do agente): ok, dentro dos 303 da varredura.
- Sondas no `calendarService`, com um cofre de verdade num tmp:
  - só o `start` e só o `end` numa nota com `agenda:` (#484);
  - títulos de nota com `/`, `:`, `?`, `#` e `..`: vira o nome limpo, ou recusa com `E_BAD_ARGS`;
  - uma nota com o mesmo título vira `Plano 2.md`;
  - títulos de linha com `[[link]]`, crase, `%%` e `- [ ]`;
  - títulos que a linha leria como tag, sino ou data (#493).
- A sugestão do painel do Kiwi com uma pendência `🔁 dia` atrasada (#485): o `suggestion` e o `calendar.update`, como o Sim faz.
- Os avisos:
  - o `alertsVia` e o `alertsBetween`, já vistos na varredura 1;
  - o custo de uma conferência com 0, 500 e 3.000 notas com caixa aberta (#486).
- As ferramentas do agente (`calendar_list`, `calendar_create`, `calendar_update`): pelo `calendarService`. O `pathOfId` com a vez da repetição e a escrita pelo journal (Atividade e Desfazer) estão certos.
- `cli ui`:
  - o "+ Novo" no mês seguinte, com o tipo Nota e com o título com `#foco` (#491, #492, #493);
  - as 4 vistas e o "+ Novo" a 760×560, em pt e en (#495).

### As abas dos Ajustes (#441, #443)
- `settings-tabs-check`:
  - uma barra de abas por assunto (9), e a última aba guardada por assunto;
  - ← e → nas abas, ↑ e ↓ na lista;
  - o "Abrir a aba Geral" com o foco;
  - `?topic=meetings&tab=yours`, e o id de aba de outro assunto.

  Ok. Também `settings-topics-check`, `settings-ui-check`, `settings-english-check` e `hover-expand-check`: ok.
- `bun test ui/settings`: ok.
- Leitura do `Settings.tsx` e do `topics.ts`:
  - o `?topic=` e o `?tab=`;
  - o `reveal` com o `row=` numa aba escondida;
  - os links de dentro do hub (`memoryTitle()`, `routinesTitle()`, já na língua do app);
  - a janela estreita, com a lista e o "‹ Voltar".
- `cli ui`:
  - os Ajustes a 600×520 (a lista e o Agente, em pt e en), ok;
  - o "Ligar o agente" do gato dormindo depois de abrir Agente › Memória (#497), em pt e en.

### Inglês e português
- Os roteiros de cima nas duas línguas, quando o roteiro tem as duas.
- Os nomes das abas dos Ajustes: as 20 chaves `settings.tab.*` estão em pt e en.
- Só a Agenda em pt tem o erro de caixa (#494).

## Sugestões (gosto, não defeito)
- Pelo código (não rodei), na Agenda uma linha também se arrasta: o `dayAt` acha a seção de outro dia, e o item muda de dia. A tela não diz que dá para arrastar ali. Vale decidir se a Agenda arrasta ou não.
