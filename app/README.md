# app/

O app do Kiwi Notes: Electrobun Livewire (main em Bun) com a UI em React + TypeScript + Vite (`ui/`). Vive na barra de menu, sem ícone no Dock.

## Rodar

```sh
cd app
bun install
bun dev        # builda a UI, abre o app na barra de menu, com ELECTROBUN_AGENT_CONTROL=1
bun dev:hmr    # igual, mas as janelas carregam do Vite (porta 5178) com HMR
bun test       # lógica TS (IPC, limpeza, a lógica e o editor da janela Notas…)
bun scripts/notes-ui-check.ts   # a janela Notas num Chromium headless (sem janela na tela), contra o vault de mentira
bun run typecheck   # pede o devkit: numa worktree nova, rode antes `bun run prepare:eb` (ou um build)
bun run ui:build    # as UIs do AppEngine, uma por janela, em dist/<janela> (ADR 0006)
```

As janelas são UIs do AppEngine (ADR 0006). Para testar uma troca de UI sem rebuild, num canal **local**: `bun run ui:publish settings --ui-version 0.1.1-local`, `bun run ui:serve` e o app com `KIWI_UI_CHANNEL=http://127.0.0.1:5179`. Nunca abra janela do app na tela de outra pessoa sem combinar (AGENTS.md).

Na primeira vez, `scripts/hutch.ts` baixa o Hutch fixado em `hutch-pin.json` (confere o sha256) para `~/.hutch/kiwinotes/`, e o Hutch baixa o Livewire 2026.10.2 de `kiwi-init/electrobun-livewire`.

## Dirigir o app (agentes)

Com o app de pé:

```sh
bun run agent apps
bun run agent call actions.invoke '{"name":"open-window","params":{"window":"settings"}}'
bun run agent screenshot /tmp/settings.png 1
```

As janelas têm CSP sem `'unsafe-eval'` (T1378): um eval com resposta pela ponte (`evaluateJavascriptWithResponse`, que usa `new Function`) devolve erro, e não é bug do app. Para ler ou mexer na página, use o Agent Control (`bun run agent …`) ou o `executeJavascript`, que vem do WebView e não passa pela CSP.

## O ditado (T58)

O app sobe o helper Swift (`native/`) e fala com ele por um socket unix (`src/bun/sidecar.ts`, [ADR 0001](../docs/adr/0001-ipc.md)). Um ditado faz `transcript.final` → limpeza (regras, LLM local opcional, tom do app em que a pessoa ditou) → snippets → `insert.text` → histórico → pílula em `done` (`src/bun/dictation.ts`).

**Ditado vira nota (T1320).** Com ⌥ segurado ao apertar o atalho, o ditado vira uma nota nova em `~/KiwiNotes/Caixa de entrada/`, em vez de ser colado. O título sai da 1ª frase, e o frontmatter leva `date` e `source: dictation`. No Histórico, o ícone de nota de cada ditado ("Enviar para nota…") manda o texto para uma nota nova ou para o fim de uma que existe. O trecho entra com a legenda `*🎙 ditado às HH:MM*`, e mandar de novo não duplica. Para conferir o Histórico sem abrir o app: `bun run ui:build && bun scripts/history-ui-check.ts`, que usa o WebKit headless com a CSP das views.

- `bun run build` e `bun dev` compilam o helper antes (`scripts/build-helper.ts`) e o põem dentro do app, em `bin/kiwi-helper`. O `scripts/info-plist.ts` põe o `NSMicrophoneUsageDescription` no Info.plist.
- `KIWI_DATA_DIR=<pasta>`: dicionário, snippets e histórico fora dos reais.
- `KIWI_HELPER=<caminho>`: outro build do helper. `KIWI_LLM_MODE=auto|always` liga o LLM (o padrão é `off`, [ADR 0002](../docs/adr/0002-limpeza.md)).

### Testar sem microfone (agentes)

Agente não usa o mic, não cola e não mexe no clipboard (AGENTS.md). Com `KIWI_DEBUG=1`, todo `insert.text` sai com `dryRun`, e um áudio sintético faz o caminho de um ditado:

```sh
say -v "Flo (Português (Brasil))" -o /tmp/frase.aiff "hum oi ana segue o relatório do dicom"
KIWI_DEBUG=1 KIWI_DATA_DIR=/tmp/kiwi-teste bun dev
bun run agent call actions.invoke '{"name":"debug-transcribe","params":{"path":"/tmp/frase.aiff"}}'
```

A ação devolve o texto final, o tom e o tempo do lado do app; o ditado entra no histórico de teste.

## Layout

- `src/bun/`: processo principal (barra de menu, janelas, ações de agente, o sidecar e o fluxo do ditado).
- `src/shared/ipc.ts`: contrato com o sidecar Swift ([ADR 0001](../docs/adr/0001-ipc.md)).
- `ui/<janela>/`: uma entrada HTML por janela (`settings`, `history`), servidas em `views://ui/<janela>/index.html`.
- `ui/src/styles/tokens.css`: tokens (cores claro/escuro, raios, sombras, tipografia SF, movimento).
- `ui/src/kit/`: primitivas (`Window`, `Section`, `Row`, `Button`, `Switch`, `Segmented`, `Kbd`, `Empty`).

## Movimento

No estilo do Channels: CSS, sem biblioteca. `--fast`/`--slow` com `--ease` para fades; as springs `--glide` (janelas, seleções) e `--pop` (toques). Um controle pressionado afunda para 0.96; a seleção do segmentado desliza num pill só; a janela entra com `window-in`, e o conteúdo sobe em escada. A entrada só toca com o documento visível, porque o WebKit pausa animações em janela coberta. Reduced motion do sistema corta tudo.
