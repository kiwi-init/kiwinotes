# ADR 0004: o overlay do ditado é um NSPanel nativo no sidecar

- Status: aceito (T56).
- Código: [`native/Sources/kiwi-helper/Overlay.swift`](../../native/Sources/kiwi-helper/Overlay.swift) (painel e SwiftUI) e [`OverlayModel.swift`](../../native/Sources/KiwiHelperCore/OverlayModel.swift) (estado, posição e textos, com `swift test`).

## Contexto
A pílula do ditado aparece ao gravar, mostra a onda ao vivo e os estados gravando/transcrevendo/pronto/erro. Ela não pode roubar o foco nem o teclado do app em que a pessoa está ditando. Havia duas opções: uma janela Livewire transparente (React, como as outras janelas) ou um NSPanel nativo no sidecar.

## Decisão
**NSPanel nativo no sidecar, desenhado em SwiftUI.**
- **Latência:** o atalho e o áudio já estão no sidecar (ADR 0001). A pílula aparece no próprio `hotkey.down` e a onda é alimentada direto do `LevelMeter`, sem passar 30 mensagens por segundo pelo Bun e pela WebView, e sem esperar o primeiro paint de uma WKWebView.
- **Foco:** `NSPanel` com `.nonactivatingPanel`, `canBecomeKey`/`canBecomeMain` falsos e `ignoresMouseEvents`, mostrado com `orderFrontRegardless`. O app em foco continua o mesmo; conferi com a janela da frente antes e depois. Uma janela Livewire precisaria disso tudo exposto pela FFI do Electrobun.
- **Onde aparece:** nível `.statusBar`, `canJoinAllSpaces` e `fullScreenAuxiliary`, ou seja, por cima de app em tela cheia e em todo Space. Fica centralizada no topo da tela que tem o mouse, logo abaixo da barra de menu ou da notch (`OverlayLayout`).
- **Estilo:** cores e movimento vêm de `app/ui/src/styles/tokens.css`: `--accent` e `--danger` escuros, a spring `--pop` para entrar e para o ✓, a `--glide` para a largura mudar entre estados e o `--fast`/`--ease` para sumir. O *Reduzir movimento* do sistema troca tudo por fade.

## Estados
| de onde vem | estado | some sozinho |
|---|---|---|
| `record.started` | `listening` (onda) | não, mesmo num toggle longo |
| `record.stopped` | `processing` (três pontos) | depois de 10 s sem notícia do app |
| `overlay.state done` (Bun, depois de inserir) | `done` (✓) | 0,7 s |
| `record.error` ou `overlay.state error` | `error` (mensagem de até 38 caracteres) | 2,5 s |
| `record.cancelled` ou `overlay.state hidden` | some | — |

## Consequências
- O Bun só manda `overlay.state` para `done` e `error` (T58). Um estado desconhecido volta `unknown_state`.
- O design da pílula fica em Swift, não no React. Se os tokens mudarem, `OverlayStyle` precisa acompanhar.
- O sidecar agora roda um `NSApplication` como *accessory* (sem Dock e sem menu, nunca se ativa sozinho) no lugar do `CFRunLoopRun`.
- `kiwi-helper --overlay-snapshot <pasta>` desenha um PNG por estado, fora da tela, para ver a pílula sem microfone e sem permissão de gravação de tela.
