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

## Permissões que ficam entre builds (T1074)

Assinado ad hoc, cada build é um app novo para o macOS, e a Acessibilidade, o Monitoramento de Entrada e o Microfone voltam a pedir permissão. Para elas ficarem, rode **uma vez**, no terminal:

```sh
app/scripts/make-signing-identity.sh
```

- Ele cria no seu Keychain de login um certificado de assinatura autoassinado, o "Kiwi Notes Local Signing". Nada sai do Mac e ele não pede Apple ID.
- Ele pede a senha do seu Mac **no terminal**, para o `codesign` usar a chave sem perguntar. Nenhum diálogo do macOS abre. Se esse passo não der certo, o script apaga a identidade e sai com erro, porque sem ele todo build abriria um diálogo do codesign. Basta rodar de novo.
- Com o Keychain trancado (depois de dormir, por exemplo), o build não arrisca o diálogo de senha: sai ad hoc, com o aviso `signing: … is locked`. Com `KIWI_SIGN_IDENTITY`, ele falha.
- Não precisa marcar o certificado como confiável. O `security find-identity` mostra ele como `CSSMERR_TP_NOT_TRUSTED`, e isso é esperado.
- Daí em diante, o `bun run build` assina com ele (`info-plist: signed with "Kiwi Notes Local Signing"`), e o `verify-signature` confere que cada app tem o requirement `identifier "app.kiwinotes.desktop" and certificate leaf = H"…"`. Esse requirement é o mesmo em todo build, e é ele que o macOS guarda junto com a permissão. Para conferir num build: `codesign -d -r- build/stable-macos-arm64/"Kiwi Notes.app"`.
- Depois de criar a identidade, a permissão precisa ser dada **mais uma vez**, porque o build ad hoc anterior era outro app para o macOS. Se nos Ajustes aparecer mais de um Kiwi Notes, tire os extras com o **−**. A partir daí, ela fica.

Sem a identidade, o build sai ad hoc, como antes. Outras opções:

- `KIWI_SIGN_IDENTITY=-`: ad hoc, mesmo com a identidade no Keychain.
- `KIWI_SIGN_IDENTITY=<nome ou SHA-1>`: outra identidade. O build falha se ela não existir.
- `KIWI_SIGN_KEYCHAIN=<arquivo>`: procura num keychain fora da lista de busca, como nos testes.

Para desfazer, apague a identidade: `app/scripts/make-signing-identity.sh --remove`. O próximo build volta a ser ad hoc e as permissões voltam a ser pedidas.

O teste com um keychain de verdade fica de fora do `bun test`, porque ele cria um keychain temporário: rode com `KIWI_SIGN_KEYCHAIN_TEST=1 bun test scripts/signing.test.ts`.

## Layout

- `src/bun/`: processo principal (barra de menu, janelas, ações de agente, o sidecar e o fluxo do ditado).
- `src/shared/ipc.ts`: contrato com o sidecar Swift ([ADR 0001](../docs/adr/0001-ipc.md)).
- `ui/<janela>/`: uma entrada HTML por janela (`settings`, `history`), servidas em `views://ui/<janela>/index.html`.
- `ui/src/styles/tokens.css`: tokens (cores claro/escuro, raios, sombras, tipografia SF, movimento).
- `ui/src/kit/`: primitivas (`Window`, `Section`, `Row`, `Button`, `Switch`, `Segmented`, `Kbd`, `Empty`).

## Movimento

No estilo do Channels: CSS, sem biblioteca. `--fast`/`--slow` com `--ease` para fades; as springs `--glide` (janelas, seleções) e `--pop` (toques). Um controle pressionado afunda para 0.96; a seleção do segmentado desliza num pill só; a janela entra com `window-in`, e o conteúdo sobe em escada. A entrada só toca com o documento visível, porque o WebKit pausa animações em janela coberta. Reduced motion do sistema corta tudo.
