# Varredura: Reuniões (área 2 do spec #7424, T7439)

A varredura foi feita em 2026-11-12, na `main` de `8f5a113` a `2965b9c`. Ninguém ligou o mic nem o áudio do sistema
(AGENTS.md). O helper recusa o `meeting.start` sem mic, e o tap do sistema só existe com uma reunião de verdade. Por
isso, a varredura cobre o que vem depois da captura:
- **a nota da reunião:** o `MeetingNotes` com o `Vault` de verdade num tmp, recebendo os segmentos como o helper manda
  (finais e provisórios, os dois canais, com o `session`);
- **a aba Reuniões:** o roteiro `hub-reunioes.json` pela `cli ui`, com o engine headless e o `KIWI_FAKE_MEETING`;
- **a captura e o ao vivo do helper:** os testes Swift dele, com o `kiwi lock bench`.

## Resumo

| | Resultado |
|---|---|
| `swift test --filter 'Meeting\|LiveMeeting\|Capture'` (o helper) | 105/0 |
| `bun test` das reuniões (`meetings`, `meeting-notes`, `meeting-acks`) | 34/0 |
| A nota da reunião (10 cenários) | 1 bug: **T7723** |
| Renomear quem falou e o relabel do fim (8 cenários) | sem bug |
| A aba Reuniões (`hub-reunioes.json`, 40 passos) | sem bug |
| Bugs achados | 1, com task própria e o teste que falha na `main` |

## Bugs

### T7723: a nota some durante a gravação e a fala some calada

**Passo:** durante a gravação, a pessoa apaga a nota da reunião ou muda o `type` nas propriedades.

- **O esperado:** a fala que vem depois vai para uma nota, e a pessoa fica sabendo.
- **O que acontece:** cada `segment()` e o `finish()` dão `E_NOT_FOUND "meeting note not found"`, e a fala não fica em
  lugar nenhum. A gravação segue na tela como se nada tivesse acontecido. O erro vai só para o console, porque o
  `MeetingNoteSession` do app não tem `onError`. Como nada foi gravado, o áudio desse trecho não é liberado no helper,
  mas também nenhuma nota vai receber esse texto.
- **A causa:** o `segment()` procura a nota antes de guardar a fala no `pending`.

## O que funciona (com o passo que conferiu)

- **A reunião normal:**
  - os dois canais ("Você" e "Pessoa 1") entram na ordem;
  - o provisório não entra;
  - o fim grava o `end` e a `duration` (900 s numa de 15 min).
- **Escrever durante a gravação:** 10 rodadas de "a pessoa grava 'Minhas notas' pela janela (`saveEdit`, com a base de
  quando começou) e a transcrição chega no meio". Ficaram as 10 anotações e as 10 falas.
- **Renomear e mover a nota no meio:** pelo app (renomear e mover de pasta) e pelo Finder (com o watcher), a transcrição
  segue na nota nova, achada pelo `session`, sem criar outra.
- **Apagar a seção "## Transcrição" no meio:** a seção volta com a fala nova, e o texto da pessoa fica.
- **Nomes e falas com sinais:** `**Ana** [[x]]`, `[[Segredo]]`, `<script>`, `---`, `%%comentário%%` e `^bloco` saem
  escapados, sem virar link, comentário nem frontmatter. O `type:` continua um só.
- **Duas reuniões no mesmo minuto e no mesmo app:** duas notas ("… Reunião do Zoom.md" e "… 2.md"), cada uma com a sua
  fala.
- **Uma reunião de 2 h:** 2.400 falas, com 1.200 flushes. A nota fica com 492 KB e as 2.400 linhas. O pior flush levou
  246 ms, num tmp e com a máquina carregada.
- **Renomear quem falou:** de "Pessoa 1" para "Ana (RH)", "Ana \*Souza\*", "Ana [ext] #1", "Dra. Ana | RH",
  "José_da_Silva" e "Ana: chefe":
  - todas as linhas trocam;
  - a fala que chega depois já vem com o nome novo;
  - voltar para "Pessoa 1" funciona;
  - renomear para um nome que já fala dá `E_EXISTS`, sem juntar as falas;
  - o relabel do fim (o VBx) mantém o nome que a pessoa deu.
- **A aba Reuniões, os 40 passos de `hub-reunioes.json`:** a lista (só as reuniões, a mais nova primeiro, a duração e os
  participantes), o card ao vivo, pausar e voltar o meu mic, renomear, apagar com Desfazer, abrir nas Notas, parar pelo
  card e os ajustes do pop-up e da lista de apps. Nenhum erro na página.

## Para observar (não é bug confirmado)

- **O resumo da reunião não existe no app:** nenhuma capacidade nem código. O spec #7424 cita "resumo"; se for uma
  feature planejada, é para outro spec, porque pede o Claude Code (a decisão #34).
- **O custo de reescrever a nota inteira:** cada flush lê e regrava a nota toda. Numa de 2 h, são ~500 KB a cada ~5 s.
  Medi 246 ms no pior caso. Fica para a área Desempenho (T7443), medido com o `kiwi lock bench`.

## O que não dá para testar sem pessoa (roteiro do harry, no teste final)

1. Uma reunião de verdade no Zoom, no Meet ou no Teams:
   - o pop-up "Gravar esta reunião?";
   - o texto ao vivo na nota;
   - o "A reunião acabou?" depois de ~2 min sem o app no mic.
2. O áudio do sistema e o mic juntos: a fala dele vira "Você", e a dos outros vira "Pessoa N".
3. O mic compartilhado com o app de reunião, e um AirPods (Bluetooth) no meio.
4. Apagar a nota da reunião durante a gravação, depois do T7723: a fala não pode sumir.
