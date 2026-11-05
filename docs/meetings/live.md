# A transcrição ao vivo (R3 / T4943 / issue #196)

Spec #4823. As escolhas são as do [ADR 0009](../adr/0009-reunioes.md), aceito com a opção **B** do harry (#5131). A captura é o R1 ([capture.md](capture.md)), e a nota é o R4 ([notes.md](notes.md)).

## O caminho
1. O R1 grava cada pacote no spool e o passa ao R3 (`MeetingCapture.onSamples`).
2. Em cada canal, um `SlidingWindowAsrManager` (`.streaming`, Parakeet Ultra) transcreve. No canal sistema, o Sortformer dá os rótulos ao vivo (`KIWI_MEETING_DIARIZER` troca o diarizador).
3. O núcleo puro (`KiwiHelperCore/Meeting/Live`) decide:
   - **o que é final:** só palavras firmes do ASR, cortadas numa pausa (0,8 s), no fim de uma frase, numa troca de falante ou a cada 25 s; depois de 2 s de silêncio, o último trecho também fecha;
   - **o relógio:** o tempo do stream vira o relógio da reunião (16 kHz). O "você" pausado no mute não desloca nada;
   - **quem falou:** "Você" no mic; no sistema, "Pessoa 1, 2…" na ordem em que falam;
   - **o eco:** com a saída no alto-falante (ou desconhecida), um final do "você" espera o sistema passar dele. Se um final do sistema perto dele tem as mesmas palavras, ele sai do "você". Com fone, nada é filtrado;
   - **o dicionário:** o pós-processamento do ditado vale nos finais.
4. O helper manda:
   - `meeting.segment {session, channel, id, start, end, startFrame, endFrame, speaker, text, final}`, sempre com `session` e `channel` (#5064);
   - `meeting.settled {session, channel, frame}`: antes dali, nada novo sai no canal;
   - `meeting.warning`: o canal sistema só com zeros por 10 s (`system_audio_silent`, a permissão, #5030) ou a transcrição que não subiu.
5. No `meeting.stop`, os streams terminam e os últimos finais saem. Então, só no fim (opção B):
   - o **VBx** roda sobre o canal sistema inteiro, lido do spool;
   - os grupos dele herdam os rótulos ao vivo com que mais se sobrepõem, um para um, e os outros viram "Pessoa N" novas;
   - os finais que mudam de grupo saem num `meeting.relabel`;
   - depois vem `meeting.drained` do sistema.

## Quando o áudio sai do disco (o app, `src/bun/meeting-acks.ts`)
- O R4 avisa (`onCommitted`) quando o texto está salvo na nota. Só então o app manda o `meeting.ack` (#5061).
- **Você:** a marca d'água anda durante a reunião até o menor entre o `settled` e o começo do primeiro final ainda não salvo, com 2 s de contexto.
- **Sistema:** nada sai no meio da reunião (o VBx precisa de tudo). No fim, o app grava a correção na nota (`MeetingNotes.relabel`: escrita condicional, os nomes dados pela pessoa ficam), e então um ack com contexto 0 apaga tudo.
- Se o ASR de um canal falha, ele não diz `drained`, e o áudio fica para a recuperação.

## Depois de uma queda
- No boot, o helper transcreve o que sobrou no spool, reunião por reunião, e o app escreve na nota pela `session`.
- A nota guarda até onde cada canal está salvo (`meeting_progress`). O que acaba antes disso conta como salvo: libera o áudio e não aparece duas vezes.

## Testes
- `swift test`: o núcleo (`LiveMeetingTests`, `SpeakerRelabelTests`) e o fsync do spool.
- `bun test src/bun/meeting-acks.test.ts src/notes/meetings.test.ts`: as acks, o relabel com um falante renomeado durante a reunião e a recuperação sem duplicar.
- A medida com os modelos: `spikes/meeting-bench/run-live.sh` (com `kiwi lock bench`). Ele roda `kiwi-helper --meeting-live` nas reuniões sintéticas do R0 e dá a nota com o mesmo `score.ts`.
