# Perceber a reunião, o pop-up e o atalho (R2 / T4941 / issue #195)

Spec #4823 (detalhe do R2 no #4901). Decisões do harry: o Kiwi **sugere** gravar e nunca grava sozinho (#4756); quando o app solta o mic, **só sugere parar** (#4846).

## Como percebe
- O helper lê os *process objects* do CoreAudio (macOS 14.2+): quais processos estão com entrada de mic (`kAudioProcessPropertyIsRunningInput`). **Não abre o mic e não pede permissão.** Porte do OpenWhispr `resources/macos-mic-listener.swift` (MIT, @ `ed28e3c`): `MicUsage` (puro) e `MicListener`. Sem o modo "aggregate" do original, que não diz qual app pegou o mic.
- Cada processo vira o **app responsável** por ele (o GPU do WebKit vira o Safari; o helper do Chrome, o Chrome). Assim o próprio Kiwi, inclusive o ditado e o canal "você", fica de fora pelo pid.
- Contam como reunião (`MeetingApps.defaults`): Teams, Zoom, Webex, Slack, FaceTime e os navegadores (Chrome, Arc, Edge, Brave, Firefox, Safari), onde roda o Meet. O app troca a lista com `config.set meetingApps` (os ajustes do R6).
- `kiwi-helper --mic-users` mostra uma leitura, em JSON, e sai.

## O que faz (`MeetingDetector`, puro, com relógio falso no `swift test`)
| Situação | O que acontece |
|---|---|
| Um app de reunião pega o mic | "Gravar esta reunião?" num painel que não rouba o foco; some em 20 s |
| Desmutar, push-to-talk, o app soltar e pegar o mic de novo | Não pergunta outra vez: **um pop-up por reunião**. A reunião é esquecida depois de 10 min sem o mic |
| Atalho de reunião (⌃⌥R) | Grava (o app no mic, ou nenhum) ou para, com ou sem o pop-up |
| Gravando, o app solta o mic (o Meet faz isso no mute) | O canal "você" pausa junto (`meeting.pauseMine`) e volta quando o app pega o mic |
| "Pausar meu mic" (⌃⌥M, ou o mic da pílula) | Pausa ou volta o canal "você"; o desmute do app não desfaz a pausa da pessoa |
| Gravando, o app fica **~2 min seguidos** sem o mic | "A reunião acabou? [Parar] [Continuar]". **Nunca para sozinho**; pergunta de novo só depois de o app pegar e soltar o mic outra vez |
| Gravando | A pílula de reunião: o ponto vermelho, o tempo, o mic e o ✓ para parar. Ela sai da frente enquanto a pílula do ditado aparece (o Fn segue ditando) |

O detector só conta a gravação depois do `meeting.started` do R1 ([captura](capture.md)), venha o pedido de onde vier (o pop-up, o atalho ou o app).

## Testes
- `swift test --filter 'MeetingDetectorTests|MicUsageTests'`: a lógica toda, com relógio falso.
- `kiwi-helper --overlay-snapshot <dir>`: `meeting-*-light.png` e `meeting-*-dark.png`, desenhados fora da tela.
- CLI headless com `KIWI_DEBUG=1`: `debug.meetingMicUsers` inventa os processos no mic, e o helper responde com `meeting.suggested`; o `meeting.start` headless é recusado (`headless_no_mic`).
- O pop-up, o atalho, o mute e o fim no Teams de verdade são teste do harry, pelo roteiro do lead.
