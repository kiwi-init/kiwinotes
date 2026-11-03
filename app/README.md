# app/

O app do Kiwi Notes: Electrobun Livewire (main em Bun) com a UI em React + TypeScript + Vite (`ui/`). Vive na barra de menu, sem ícone no Dock.

## Rodar

```sh
cd app
bun install
bun dev        # builda a UI, abre o app na barra de menu, com ELECTROBUN_AGENT_CONTROL=1
bun dev:hmr    # igual, mas as janelas carregam do Vite (porta 5178) com HMR
bun test       # lógica TS (IPC etc.)
bun run typecheck
```

Na primeira vez, `scripts/hutch.ts` baixa o Hutch fixado em `hutch-pin.json` (confere o sha256) para `~/.hutch/kiwinotes/`, e o Hutch baixa o Livewire 2026.10.2 de `kiwi-init/electrobun-livewire`.

## Dirigir o app (agentes)

Com o app de pé:

```sh
bun run agent apps
bun run agent call actions.invoke '{"name":"open-window","params":{"window":"settings"}}'
bun run agent screenshot /tmp/settings.png 1
```

## O ditado (T58)

O app sobe o helper Swift (`native/`) e fala com ele por um socket unix (`src/bun/sidecar.ts`, [ADR 0001](../docs/adr/0001-ipc.md)). Um ditado faz `transcript.final` → limpeza (regras, LLM local opcional, tom do app em que a pessoa ditou) → snippets → `insert.text` → histórico → pílula em `done` (`src/bun/dictation.ts`).

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
