# app/

O app do Kiwi Notes: Electrobun Livewire (main em Bun) com a UI em React + TypeScript + Vite (`ui/`). Vive na barra de menu, sem ícone no Dock.

## Rodar

```sh
cd app
bun install
bun dev        # builda a UI, abre o app na barra de menu, com ELECTROBUN_AGENT_CONTROL=1
bun dev:hmr    # igual, mas as janelas carregam do Vite (porta 5178) com HMR
bun test       # lógica TS (IPC, limpeza, a lógica e o editor da janela Notas…)
bun run test:dictation   # a bateria do ditado pela CLI headless: test/dictation/casos.jsonl (texto) e falados.jsonl (say → STT); --only text|wav
bun scripts/notes-ui-check.ts   # a janela Notas num Chromium headless (sem janela na tela), contra o vault de mentira
bun scripts/settings-ui-check.ts   # o atalho das notas nas Configurações, num WebKit headless com a CSP das views
bun run typecheck   # pede o devkit: numa worktree nova, rode antes `bun run prepare:eb` (ou um build)
bun run ui:build    # as UIs do AppEngine, uma por janela, em dist/<janela> (ADR 0006)
```

### Ditar pela CLI (T1740)

Com o modo headless de pé (`bun run cli start`, T1739), um ditado inteiro sai sem microfone nem colagem. O `insert.text`
vai sempre em dryRun, e o campo é descrito, não lido:

```
bun run cli dictate /tmp/frase.wav --app slack             # STT de verdade (say -o /tmp/frase.wav --data-format=LEI16@16000 "…")
bun run cli dictate --text "hum manda o laudo" --app teams --field-before "Oi."
bun run cli dictate --text "git status" --app ghostty      # tom literal: sem espaço automático
bun run cli dictate --text "comprar pão" --note            # a nota rápida
bun run cli dictate --batch casos.jsonl                    # bateria: um caso por linha, com "expect"
```

O relatório traz `raw`, `text`, `tone`, `latencyMs` e `insert {plan, reason, autoSpace, spaced, typed}`. O `typed` é
exatamente o que entraria no campo (null no `clipboardOnly`, quando nada entra). Um ditado que falhou
(`skipped: "error"`) sai com exit 1, e a bateria também, se algum caso falhar ou algum `expect` (`text`, `typed`,
`tone`, `plan`, `spaced`, `contains`) não bater. Um WAV relativo é da pasta de onde a CLI roda (no `bun run cli`, a
`app/`). Áudio só sintético.

As janelas são UIs do AppEngine (ADR 0006). Para testar uma troca de UI sem rebuild, num canal **local**: `bun run ui:publish settings --ui-version 0.1.1-local`, `bun run ui:serve` e o app com `KIWI_UI_CHANNEL=http://127.0.0.1:5179`. Nunca abra janela do app na tela de outra pessoa sem combinar (AGENTS.md).

Na primeira vez, `scripts/hutch.ts` baixa o Hutch fixado em `hutch-pin.json` (confere o sha256) para `~/.hutch/kiwinotes/`, e o Hutch baixa o Livewire 2026.10.2 de `kiwi-init/electrobun-livewire`.

## Testar sem tela: a CLI headless (agentes, T1739)

O jeito padrão de um agente testar o app inteiro. Roda o motor do app (o `Session`, o helper Swift e as capacidades do contrato do AppEngine) no **Bun puro, fora do Electrobun**: não existe ícone na barra, janela nem pílula. Fica forçado:
- `KIWI_DEBUG=1`: todo `insert.text` é dryRun e nenhuma permissão é pedida;
- `KIWI_HEADLESS=1`: o helper sobe com `--headless`, sem tap do atalho, sem pílula e sem mic, e recusa `permissions.request` e `record.start`;
- os dados e o vault em `--data`: nunca o `~/Library/Application Support/KiwiNotes` nem o `~/KiwiNotes`.

```sh
cd app
bun run prepare:eb                         # uma vez por worktree (o contrato do AppEngine vem do devkit)
(cd ../native && swift build)              # o helper; ou use --no-helper para só as capacidades
bun run cli start --data /tmp/kn-test      # sobe em segundo plano e espera ficar de pé
bun run cli invoke notes.create '{"title":"Oi","content":"texto"}' --data /tmp/kn-test
bun run cli invoke notes.list --data /tmp/kn-test
bun run cli events --data /tmp/kn-test     # notes.changed, history.added, dictation.done, status, helper.event
bun run cli logs --follow --data /tmp/kn-test
bun run cli dictate …                      # T1740: ditar um wav ou um texto, com dryRun
bun run cli screenshot … / ui …            # T1742: prints e roteiros das janelas
bun run cli stop --data /tmp/kn-test
```

- **Saída e exit codes:** a saída é JSON. O exit code é 0 se deu certo, 1 se a capacidade respondeu erro (o JSON traz o `code`: `E_BAD_ARGS`, `E_NO_CAPABILITY`, `E_OUTSIDE_VAULT`…), 2 para uso errado e 3 quando não há headless de pé.
- **A pasta dos dados:** sem `--data`, vale `KIWI_HEADLESS_DATA`, senão `$TMPDIR/kiwinotes-headless`. Uma pasta que é (ou fica dentro de) `~/Library/Application Support/KiwiNotes`, `…/app.kiwinotes.desktop` ou `~/KiwiNotes`, symlinks resolvidos, é recusada com `E_REAL_DATA` (T1827).
- **O protocolo** (o socket `<data>/control.sock`, 0600, um JSON por linha: `status`, `invoke`, `dictate`, `subscribe`, `stop`) está em `src/headless/server.ts` e no #1745.

### Ver as janelas pela CLI, fora da tela (T1742)

Com o headless de pé (`bun run cli start --data DIR --no-helper`), as janelas de verdade abrem num WebKit headless, sem nada na tela de ninguém:

```sh
bun run cli screenshot notes --scale 1,2 --theme light,dark --note Pessoas/Ana.md --data DIR
bun run cli ui notes --script passos.json --out /tmp/prints --data DIR
```

- **O que roda:** o build da janela (o mesmo `vite build` do `ui:build`, guardado em `node_modules/.cache/kiwi-cli-ui/` e refeito quando `ui/` ou `src/` mudam), servido com a `VIEWS_CSP`. O `window.engine` imita o do preload e leva cada `invoke` ao headless, e os eventos do headless (`notes.changed`, `history.added`) chegam à página.
- **O padrão:** WebKit, porque o Chromium headless ignora o `-webkit-font-smoothing` (#1765), em 2x, claro, no tamanho da janela (`src/shared/window-specs.ts`) e com reduced motion, sem animação no print. Para mudar: `--browser chromium`, `--size WxH`, `--motion`. Com `--dist DIR`, usa um build pronto, como o de outro worktree para o antes e depois.
- **A saída:** JSON com os PNGs (um `--note` que não abre vira um aviso em `problems`), se a UI chamou `engine.ready()`, os erros da página e de CSP (`problems`), o que tentou sair para a rede (`blocked`) e as capacidades chamadas. Qualquer problema dá exit 1, e o PNG sai assim mesmo.
- **Isolamento:** a página não sai para a rede, e o `clipboard.write` nunca chega ao engine: o texto fica em `clipboard` no relatório. O `blocked` não lista WebSocket, porque a rota do Playwright não pega esse tipo de conexão. Mesmo assim, nada sai do Mac: a CSP só deixa `ws://127.0.0.1:*`.
- **Os passos** (`scripts/ui-steps.ts`): `click`, `fill`, `type`, `press` (⌘K é `"Meta+k"`), `hover`, `waitFor`, `wait`, `expectText`, `expectCount`, `screenshot` e `invoke`, que é uma capacidade direto no engine, como uma edição no Obsidian. No `notes.save`, `"baseVersion": "current"` usa a versão de agora; um save que não grava faz o passo falhar. O script para no primeiro passo que falha e deixa `falhou-passo-N.png`.

```json
{ "window": "notes", "theme": "dark", "steps": [
  { "press": "Meta+k" }, { "type": "projeto" }, { "press": "Enter" },
  { "expectText": ".kn-side-item[aria-current=page]", "text": "Projeto X" },
  { "screenshot": "projeto.png" }
] }
```

Na primeira vez: `bunx playwright-core install webkit`. Num worktree novo: `bun run prepare:eb`, sem o qual o Vite não builda.

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

**Ditado vira nota (T1320).** Com ⌥ segurado ao apertar o atalho, o ditado vira uma nota nova em `~/KiwiNotes/Caixa de entrada/`, em vez de ser colado. O título sai da 1ª frase, e o frontmatter leva `date` e `source: dictation`. No Histórico, o ícone de nota de cada ditado ("Enviar para nota…") manda o texto para uma nota nova ou para o fim de uma que existe. O trecho entra com a legenda `*🎙 ditado às HH:MM*` e, nela, o id do ditado num comentário do Obsidian (`%%dictation:<id>%%`, que ele esconde). É pelo id que mandar de novo não duplica, mesmo com dois ditados iguais no mesmo minuto (T1565). Para conferir o Histórico sem abrir o app: `bun run ui:build && bun scripts/history-ui-check.ts`, que usa o WebKit headless com a CSP das views.

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
