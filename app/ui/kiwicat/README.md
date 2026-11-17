# O Kiwi Cat do app (T14885, spec #14813)

O gato do hub, do overlay, de Ajustes e do onboarding. O desenho é o do pacote
(`docs/design/kiwicat-v2/agente/ByteKiwiCat.tsx`), sem mudança: a névoa em WebGL2
(`ui/kiwicat-v2/renderer.ts`, o `FogRenderer(CAT_SHAPE)`), o rosto num canvas 2D e
os emotes em SVG, nas camadas do pacote. O motor three.js de antes saiu; o que
estava nele fica no histórico (`docs/arquivo.md`).

## A API

`createKiwiCat(root, options)` desenha o gato dentro de `root` e devolve o controle.
O gato é um quadrado de `min(width, height)`, centrado embaixo da caixa.

- `inputs`: `estado` (os 8 estados de hoje: `repouso`, `dormindo`, `acordou`,
  `ouvindo`, `thinking`, `agindo`, `pronto`, `erro`), `voz` (0–1, ou `null` sem
  Control), `parado` (o reduzir movimento do host), `limite` (o `erro` é o limite de
  uso) e `cor` (aceita, mas a escolha fica escondida até o spec das paletas).
- `update(inputs)` muda só o que veio. `visibility(hidden)` para de desenhar com o gato
  escondido. `setBackground("light" | "dark")` troca a tinta dos emotes. `dispose()`
  solta os timers e os listeners.
- **Um contexto WebGL2 por janela.** Todos os gatos de uma janela dividem um `FogRenderer` (o `draw` é síncrono e cada
  gato copia o quadro para o canvas 2D dele); o último gato a sair chama o `FogRenderer.dispose()`. O WebKit tem um teto
  de contextos ativos e só libera a vaga no GC, mesmo com o `loseContext`: um contexto por gato, criando e descartando
  (Ajustes, onboarding), passava do teto e derrubava o mais antigo, que podia ser o do gato na tela.
- `root.dataset.estado` e `root.dataset.emote` dizem o que o gato mostra (o estado e o
  emote do pacote); os scripts de UI leem daí.

## As peças

| Arquivo | O que faz |
|---|---|
| `ui/hub/cat-state.ts` | a tabela 1.1: estado de hoje → estado + emote do pacote (`catLook`) |
| `ui/kiwicat/visual.ts` | os tempos: o `pronto` volta ao `repouso` em 1,1 s, o sono depois de 240–360 s parado, o `acordou` segura 0,32 s |
| `ui/kiwicat-v2/cat-motion.ts` | o movimento do pacote (molas, respiração, piscada), em TS puro |
| `ui/kiwicat-v2/cat-face.ts` | as orelhas, os olhos e a boca, num canvas 2D |
| `ui/kiwicat-v2/cat-emotes.ts` | os emotes em SVG |
| `ui/kiwicat/cat.ts` | junta tudo: as camadas, o relógio e a cadência |

A cadência: trabalhando, no ritmo do navegador (o overlay pede 30 fps); parado
(`repouso`, `dormindo`), `QUIET_FPS`; escondido, nada; no reduzir movimento, um quadro
parado e um novo a cada troca de estado.

**A GPU lenta** (o `SlowGuard` de `visual.ts`, a proteção do gato de antes): se os últimos 60 quadros trabalhando
saíram, em média, abaixo de 24 fps, o gato fica no quadro parado do reduzir movimento, e `fogStats.slow` vira `true`.
Não volta sozinho. O repouso, a 18 fps de propósito, não entra na conta.

## As provas

- `bun test ui/kiwicat ui/kiwicat-v2 ui/hub`: a tabela, os tempos e o movimento.
- `bun scripts/kiwicat-renderer-check.ts`: o WebGL2 nos 8 estados, o reduzido, o ritmo
  parado e o escondido.
- `bun scripts/kiwicat-v2/gato-igual.ts`: o gato do app contra o pacote, pixel a pixel
  (limite 1 % acima de 8/255), com o relógio parado e a mesma semente.
- `bun scripts/kiwicat-v2/peso.ts`: a CPU, com o `kiwi lock bench`.
- No hub e no overlay: `kiwicat-hub-check.ts`, `kiwicat-ask-check.ts`,
  `kiwicat-overlay-check.ts`, `kiwicat-bubble-check.ts`, `kiwicat-bubble-swap-check.ts`.
- `bun scripts/kiwicat-v2/preview.ts` refaz a imagem da prévia da posição
  (`assets/preview-cutout.webp`).

Tudo no WebKit headless: nada na tela, sem mic.
