# Captura de reuniões (R1 / T4938 / issue #194)

Contrato do spec aprovado no Kiwi #4823, detalhe R1 no #4901. O helper recebe `meeting.start {app?, chunkDuration?}` apenas por uma ação da pessoa. `meeting.stop` encerra ambas as fontes; `meeting.pauseMine` e `meeting.resumeMine` param e retomam só o mic. Não há captura na abertura, na recuperação ou em um poll de permissões. O helper headless recusa start/resume antes de construir fontes.

## Fluxo para o R3

- Cada canal (`mine`, `system`) é mono Float32 a 16 kHz. O relógio comum começa no start; `startFrame` é a posição nele, inclusive após uma pausa ou troca de dispositivo. O mic reutiliza `MicChoice`, `AudioCapture`, o watchdog e a troca de engine, com a retenção do ditado desligada.
- `MeetingCapture.onSamples(channel, startFrame, [Float])` entrega os pacotes depois da escrita durável, para ASR e diarização. Chamado pelas threads das fontes; o consumidor deve serializar seu próprio estado. Não leva áudio pelo socket.
- O process tap da saída é privado e não silencia a saída. O porte MIT do OpenWhispr está fixado no commit `ed28e3cc22a4f831abd5cf7c31f4ea275fb76d3c`; a licença está em `docs/licenses/OpenWhispr-MIT.txt`. Uma mudança na saída encerra a captura com erro, preservando o que já foi gravado.
- O spool fica em `<pasta do socket>/meeting-buffer/<sessão UUID>/`. Pastas 0700, arquivos 0600. Cada `.part` recebe Float32 little-endian a cada buffer, sem cabeçalho que dependa de um fechamento limpo. O arquivo vira `.pcm` quando completa o pedaço ou ao parar. Não é um WAV.
- Padrão provisório: pedaços de **10 s**, alterável por `chunkDuration` (0,02 a 60 s). O R0/ADR 0009 decide o valor final; o R1 não escolhe modelo ou diarizador.
- `meeting.chunk` / `meeting.pending` entregam só metadados: `{session,chunkId,channel,startFrame,frames,sampleRate:16000,format:"f32le",path}`. Os arquivos ainda abertos não entram na lista.
- Na abertura, `meeting.chunk {recovered:true,...}` reapresenta os pedaços que sobraram. Uma fração incompleta do último Float32 é descartada; os demais frames ficam disponíveis. Não reinicia a gravação. O **R3** transcreve esses pedaços e confirma a gravação do texto.
- Depois que o texto estiver firme **e persistido**, R3 manda `meeting.ack {session,channel,finalThroughFrame,contextFrames?}`. O padrão de contexto é **32.000 frames (2 s)**. Só são apagados pedaços cujo fim é `<= finalThroughFrame − contextFrames`; o pedaço que cruza a fronteira fica. O restante (inclusive a cauda ainda provisória do ASR) continua no disco. Marcas antigas não recuam a fronteira.
- `meeting.stop` **sela**, não descarta a fala ainda não transcrita. Após drenar a última janela, R3 confirma o watermark final com `contextFrames:0`; então não sobra áudio. Se a transcrição falhar, a fala fica recuperável no próximo boot. Não se deve usar stop como confirmação de texto.

Eventos: `meeting.started` (sessão, app, saída `headphones|speaker|unknown` e mic escolhido), `meeting.stopped` (sessão e contagem de pedaços pendentes), `meeting.level` (canal e RMS), `meeting.error` (código). O tipo da saída vem do terminal do stream Core Audio, não de presumir que todo Bluetooth é fone.

## Consentimento e testes

`NSAudioCaptureUsageDescription` está no helper e no app empacotado. O macOS pede o consentimento de áudio do sistema ao iniciar o agregado com tap. Não existe preflight público sem prompt para esse caminho: `permissions.systemAudio` fica `undetermined` (ou `restricted` antes de 14.2), sem inventar um grant a partir de buffers zerados. `permissions.request {permission:"systemAudio"}` é um clique explícito para abrir o painel de ajustes; não faz captura nem pede gravação de tela. Não entra nos pedidos automáticos da abertura nem do ditado. Um mic ainda não autorizado é recusado antes de qualquer fonte começar, e o fluxo de primeiro uso pede a permissão de mic.

Referências: [Core Audio taps, Apple](https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps), [porte OpenWhispr](https://github.com/OpenWhispr/openwhispr/blob/ed28e3cc22a4f831abd5cf7c31f4ea275fb76d3c/resources/macos-audio-tap.swift).

`swift test --jobs 2` cobre fontes falsas, dois canais, chunking, 0600, pausa, buffers atrasados, relógio comum, queda com pedaço parcial, watermark/contexto, drenagem final e comandos headless. `bun test src/bun/permissions.test.ts src/shared/ipc.test.ts` usa helper falso. Nenhum agente executa captura real, abre permissões ou toca áudio. A captura real e a validação no Teams ficam para o harry, em roteiro enviado pelo lead; a transcrição de recuperação e a drenagem real dependem do R3.
