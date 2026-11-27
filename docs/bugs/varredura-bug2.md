# Varredura de bugs: a metade do bug2

Spec #32486 do Kiwi Channels, task T32495 (@friendly-hare). A varredura só mapeia: cada bug virou uma issue com o rótulo `bug`, a reprodução e a gravidade, e quem corrige são os builders.

Tudo rodou na `main` em `e613641a`, pela CLI headless e pelo WebKit headless, com os dados num tmp e o agente falso. Não houve mic real (só o `say`), toda inserção foi com `dryRun`, não abriu diálogo do macOS e não houve nada na tela de ninguém.

## As issues

| issue | gravidade | área | o quê |
|---|---|---|---|
| #456 | P0 | Ditado | a nota rápida põe a 1ª frase do ditado no `kiwi.log` e no "Salvar diagnóstico" (corrigido fora do mapa: T32572, PR #460) |
| #452 | P1 | Ditado | um termo só de número no dicionário troca outro termo pelo número (`fala do kiwi` → `Fala do 0`) |
| #455 | P2 | Ditado | Ditado preciso: desligar e ligar no meio do download fica em erro por 10 min |
| #458 | P2 | Ditado | 5 avisos da pílula passam de 38 letras e saem cortados (4 em pt, 1 em en) |
| #453 | P2 | Ditado | a nota rápida de uma letra só nasce como `A..md` |
| #454 | P2 | Ditado (ferramenta) | `test:dictation` aponta para o `headless.out` que ela mesma apagou |
| #459 | P2 | O Kiwi | um ditado que começa no meio do aviso do Calendário grava a voz do Kiwi |

## O que rodou, por área

### Ditado
- `bun test` de `src/cleanup`, `src/agent`, `src/headless` e dos módulos do ditado, das reuniões, da voz, do log e do helper em `src/bun`: 1154 pass, 3 skip, 0 fail.
- `bun run test:dictation` inteiro: texto 113/113, falados 28/28 e falso positivo 30/30. O modo preciso foi pulado porque o Whisper small não está baixado neste Mac.
- Caminhos de erro, por sonda e pela CLI (`cli dictate --text`, `--note`):
  - a limpeza com texto vazio, emoji, caractere de controle, os comandos falados sozinhos e números por extenso;
  - o dicionário com termos de regex (`C++`, `$&`), acento, maiúscula e termo só de número (#452);
  - os snippets: o gatilho inteiro, no meio da frase, aproximado ("meu imeio"), repetido, de emoji só, e o plural que não pode casar;
  - a nota rápida com `/`, `:`, `#`, `[[ ]]`, `|`, `..`, `CON`, 400 letras, só emoji e uma letra (#453);
  - o Histórico: `toNote` duas vezes (não duplica), um caminho com `..` (barrado), uma nota que não existe, `retry` sem helper, `delete` de um id que não existe, a busca com caracteres de regex;
  - o modo preciso: ligar e desligar no meio do download (#455);
  - o log: o que o ditado e a nota rápida deixam no `kiwi.log` (#456).
- O tamanho de cada aviso da pílula em pt e en contra os 38 de `OverlayModel.maxMessageLength` (#458).

### Reuniões
- `MeetingNotes` com um cofre real num tmp:
  - o texto com markdown e `%%`;
  - renomear para um nome com `_`, `*`, `$&` e `[x]`;
  - um nome repetido (recusado);
  - a virada da meia-noite;
  - o relabel do VBx;
  - o app reiniciado no meio, com a fala e o fim entrando na nota certa.
- `mem:scenarios` roteiro 3: 5 min de reunião do `say` nos dois canais pelo pipeline inteiro do helper (`--meeting-live --realtime --segments-live`), escrita pelo `MeetingNotes` de verdade. Gravou 81 falas. O principal foi de 29,5 a 30,7 MB no pico e ficou em 26,4. O helper foi de 93,6 a 794,5 MB no pico e ficou em 86,7. O pico é o VBx do fim, já registrado em `docs/research/ram.md` (838 MB) e previsto no ADR 0009.
- `meeting-note-ui-check` e `meetings-english-check`: ok.
- Não abri issue para um erro duplo: com a nota apagada **e** o app reiniciado no meio da reunião, a fala seguinte se perde (`meeting note not found`). Só com a nota apagada, o T7723 recria; só com o app reiniciado, a fala entra.

### O Kiwi
- Os roteiros de tela, todos com o agente falso: `agent-control`, `agent-control-overlay`, `agent-english`, `agent-media`, `agent-memory`, `agent-onboarding`, `agent-proposal`, `agent-ui`, `agent-usage`, `bubble-english`, `bubble-links`, `bubble-tail`, `bubble-text-file`, `bubble-wide`, `cat-edits-code`, `docx-gato`, `kiwicat-ask`, `kiwicat-bubble`, `kiwicat-bubble-swap`, `kiwicat-hub`, `kiwicat-overlay`, `kiwicat-renderer`, `kiwicat-speech`, `memory-handedit`, `open-file-agent`, `planilha-gato`, `references`, `routines`, `routines-new`, `speech-media`, `summary` e `welcome`. Todos ok.
- `cat-scroll-check`: falhou 1 vez em 4. Nas Notas no tema escuro, a nota não rolou até o fim, e o polegar parou em 316 (o esperado era 558). As 3 rodadas seguintes passaram. Fica como roteiro instável, não como bug do app.
- Os avisos do Calendário: o `alertsBetween`, o `whenText` (hoje, amanhã, dia todo, véspera) e a regra de não falar com o mic aberto (#459).
- A voz: o `textoSeguro` tira os segredos e os marcadores do texto que vai ao ElevenLabs, e a queda para a voz local está certa.
- As ferramentas do agente:
  - a memória recusa um segredo e um marcador;
  - o calendário grava pelo journal, então a Atividade e o Desfazer pegam;
  - o limite do cofre já tem teste.
- `mem:scenarios` roteiro 4 (o agente falso, 40 pedidos e 20 leituras): o principal foi de 68,2 a 123,7 MB no pico e ficou em 101,4 (+33, abaixo do limite de 50).

### O helper e o app
- `swift test` em `native/`: 445 pass.
- `first-run-check` (as permissões pelo helper falso), `history-ui-check` e `history-english-check`: ok.
- `mem:scenarios` roteiro 2 (50 ditados do `say`, todos ok): o principal foi de 69,7 a 81,9 MB no pico e ficou em 73. O helper foi de 40,9 a 48,7 MB no pico e ficou em 26,9.
- A CPU em repouso (`cpu:scenarios --only repouso,repouso-foco`): o repouso ficou em 0,59% somado (a tela em 0,33% e o helper em 0,13%) e o repouso com a janela na frente em 0,75% (a tela em 0,53% e o helper em 0,10%). Tudo abaixo dos tetos, que são 1% para a tela, 1% para o helper e 2% somado. Os roteiros de índice não rodaram nesta varredura: nem o bug1 nem o bug2 os rodou, e quem os cobre é o CI da `main`.
- As atualizações: o `compareVersions` com `ANO.MÊS.N`, rc e `v`. A trava do canal de UI (`ui-channel-fetch`) recusa `..`, `%2e%2e`, query, usuário e outro host no redirect.
- O log: o `kiwi.log` de uma sessão inteira de ditado. Só a nota rápida vazava texto (#456).

### Inglês e português
- Os roteiros em inglês: `agent-english`, `bubble-english`, `history-english` e `meetings-english`, todos ok.
- Os avisos da pílula nas duas línguas (#458).

## Sugestões (gosto, não defeito)
- Um item de dia inteiro com aviso "na hora" avisa às 9h dizendo "Agora". "Hoje" diria melhor.
