# ADR 0005: o overlay do ditado é um NSPanel nativo no sidecar

- Status: aceito (T56).
- Código: [`native/Sources/kiwi-helper/Overlay.swift`](../../native/Sources/kiwi-helper/Overlay.swift) (painel e SwiftUI) e [`OverlayModel.swift`](../../native/Sources/KiwiHelperCore/OverlayModel.swift) (estado, posição e textos, com `swift test`).

## Contexto
A pílula do ditado aparece ao gravar, mostra a onda ao vivo e os estados gravando/transcrevendo/pronto/erro. Enquanto grava, ela tem dois botões: ✕ cancela e ✓ termina. Ela não pode roubar o foco nem o teclado do app em que a pessoa está ditando, nem quando alguém clica nela. Havia duas opções: uma janela Livewire transparente (React, como as outras janelas) ou um NSPanel nativo no sidecar.

## Decisão
**NSPanel nativo no sidecar, desenhado em SwiftUI.**
- **Latência:** o atalho e o áudio já estão no sidecar (ADR 0001). A pílula aparece no próprio `hotkey.down` e a onda é alimentada direto do `LevelMeter`, sem passar 30 mensagens por segundo pelo Bun e pela WebView, e sem esperar o primeiro paint de uma WKWebView.
- **Foco:** `NSPanel` com `.nonactivatingPanel` e `canBecomeKey`/`canBecomeMain` falsos, mostrado com `orderFrontRegardless`. Clicar no painel não ativa o sidecar nem tira a janela key do app da frente. A view aceita o primeiro clique (`acceptsFirstMouse`), senão o botão de uma janela que nunca é key pediria dois. Uma janela Livewire precisaria disso tudo exposto pela FFI do Electrobun.
- **Cliques:** o painel é maior que a pílula (cabe a mensagem de erro e a sombra). Para não bloquear uma faixa do que está embaixo, o Dock inclusive, ele só aceita mouse enquanto os botões estão na tela e o cursor está em cima da própria pílula. Um timer de 30 Hz liga e desliga o `ignoresMouseEvents`, só durante o `listening`.
- **Onde aparece:** nível `.statusBar`, `canJoinAllSpaces` e `fullScreenAuxiliary`, ou seja, por cima de app em tela cheia e em todo Space. Fica embaixo, centralizada na tela que tem o mouse, 12 pt acima do Dock (o `visibleFrame`), ou da borda quando o Dock está escondido ou de lado (`OverlayLayout`). Foi o @harry quem escolheu (#262), com o overlay do Wispr Flow como referência.
- **Estilo:** pílula escura com ✕ (círculo cinza) à esquerda, a onda de barras brancas no meio e ✓ (círculo branco) à direita. A onda é simétrica: o nível mais novo é a barra do meio e os mais antigos vão para as duas pontas, um pouco mais baixos. O verde do ✓ de pronto, o vermelho do erro e as springs vêm de `app/ui/src/styles/tokens.css`: `--pop` para entrar e para o ✓, `--glide` para a largura mudar entre estados e `--fast`/`--ease` para sumir. O *Reduzir movimento* do sistema troca tudo por fade.

## Estados
| de onde vem | estado | some sozinho |
|---|---|---|
| `record.started` | `listening` (✕, onda, ✓) | não, mesmo num toggle longo |
| `record.stopped` | `processing` (três pontos) | depois de 10 s sem notícia do app |
| `overlay.state done` (Bun, depois de inserir) | `done` (✓) | 0,7 s |
| `record.error` ou `overlay.state error` | `error` (mensagem de até 38 caracteres) | 2,5 s |
| `record.cancelled` ou `overlay.state hidden` | some | — |

## Botões
- **✕** descarta o áudio e emite `record.cancelled {reason:"overlay"}`.
- **✓** termina como soltar a tecla ou bater de novo no toggle: emite `record.stopped {reason:"overlay", mode}` e a pílula vai para `processing`.
- Se a tecla ainda está apertada quando alguém clica, soltá-la depois não faz nada (`HotkeyGesture.endedFromOverlay`).

## Consequências
- O Bun só manda `overlay.state` para `done` e `error` (T58). Um estado desconhecido volta `unknown_state`.
- O design da pílula fica em Swift, não no React. Se os tokens mudarem, `OverlayStyle` precisa acompanhar.
- O sidecar agora roda um `NSApplication` como *accessory* (sem Dock e sem menu, nunca se ativa sozinho) no lugar do `CFRunLoopRun`.
- `kiwi-helper --overlay-snapshot <pasta>` desenha um PNG por estado, fora da tela, para ver a pílula sem microfone e sem permissão de gravação de tela.
