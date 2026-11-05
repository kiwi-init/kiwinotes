# A aba Reuniões do hub (R6 / T4947 / issue #198)

Spec #4823 (detalhe do R6 no #4901). O formato da nota é o do R4 (T4945), combinado no #5059.

## O que mostra
- **A lista:** as notas com `type: meeting` no frontmatter, em qualquer pasta, agrupadas por dia, a mais nova primeiro. Cada linha traz a hora (`start`), a duração (`duration`, em segundos), o app e os participantes. Uma nota sem algum desses campos aparece mesmo assim, com ele vazio.
- **Ações:** clicar abre a nota nas Notas (o hub troca de seção). O lápis renomeia, e a lixeira manda para a Lixeira do app, com "Desfazer" (o `notes.restore` dos 10 min).
- **O card ao vivo:** enquanto grava, mostra o app, o tempo, "Pausar meu mic" e "Parar". O estado vem dos eventos do helper (`meeting.started`, `meeting.stopped` e `meeting.minePaused`). Os botões só agem no clique da pessoa.
- **Os ajustes de reunião:** o atalho de gravar e parar, o de "pausar meu mic", o pop-up ligado ou desligado e os apps que contam. Ficam em `settings.meetings` e vão ao helper no `config.set` do R2 ([detect.md](detect.md)).
- Não há "ouvir o trecho": o áudio é apagado (#4840).

## Contrato (UI ↔ engine)
`meetings.list`, `meetings.live`, `meetings.stop`, `meetings.pauseMine {paused}`, o evento `meetings.live` e `settings.set {meetings: {…só os campos dados}}`.

## Testes
- `bun test src/bun/meetings.test.ts`: a leitura da nota do R4, a ordem, os rótulos, o estado ao vivo, as capacidades e os ajustes.
- `KIWI_FAKE_MEETING=Teams bun run cli start --data DIR --no-helper` e depois `bun run cli ui hub --script scripts/ui-scripts/hub-reunioes.json --data DIR`. O falso (`FakeMeetingHost`) faz o card ao vivo aparecer sem helper e sem mic. O roteiro cria as notas, confere a lista, pausa, renomeia, apaga e desfaz, abre nas Notas, para pelo card e mexe nos ajustes.
