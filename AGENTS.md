# Kiwi Notes: regras para agentes e pessoas

O trabalho é coordenado no canal **kiwinotes** do Kiwi Channels. Toda mudança nasce de uma task (`T<n>`) filed sob um spec aprovado.

## Privacidade (inegociável)
- Nada sai do Mac: sem telemetria, sem analytics, sem STT nem LLM na nuvem. A única exceção é o Claude Code (decisão #34), e só onde um spec disser.
- O que o app baixa, decidido pelo harry: a atualização do app pelo GitHub Releases (ADR 0008, #1966) e os modelos de voz. São só downloads, e nada da pessoa vai junto.
- Nunca commite áudio, transcrições reais, modelos baixados ou credenciais.
- **Agente não usa o microfone real.** Nada que ligue o mic: `record.start`, o atalho, ou uma ação do app (agent control) que grave, mesmo que o Terminal já tenha a permissão. Para ver o overlay, use `overlay.state`, que não liga o mic. Diagnóstico com áudio sintético (`say`) ou com os arquivos que o harry gravar para isso. Teste com o mic real é só do harry, e quem pede é o lead (#320).
- **Agente não mexe na sessão do harry.** Nos testes, nada de AppleScript (`osascript`), abrir ou controlar outro app, colar nem escrever no clipboard real: a colagem cai no app que estiver na frente, que pode ser uma conversa dele. O `insert.text` dos agentes vai sempre com `dryRun: true` (o app em `KIWI_DEBUG=1` faz isso sozinho). Colagem de verdade é teste do harry, pedido pelo lead (#489).
- **Agente não dispara diálogo do macOS.** Nada que possa abrir um pedido do sistema na tela do harry: permissões (`permissions.request`, `AXIsProcessTrustedWithOptions`, mic), Automação ou Ajustes. Fluxo de permissão se testa só com o helper falso, e a chave `defaults` de `com.kiwinotes.helper` não se mexe. Rodar o app ou o helper de verdade só quando todas as permissões já estão dadas, e mesmo assim sem mic e com `dryRun` (#536).

## Branches e PRs
- **1 spec = 1 issue = 1 PR** (#4331). Cada ponto (uma correção, uma feature, um botão) é um spec. Um pedido com vários pontos vira vários specs.
- Aprovado o spec, quem pega a task abre a issue no repo (`gh issue create`), com o link do spec do Kiwi (#N) e a task (`T<n>`).
- O PR resolve só aquela issue e leva `Closes #<issue>` no corpo, para o merge fechá-la.
- O PR leva **um print ou um vídeo** do resultado, o que for mais fácil, no corpo do PR e no canal da task, para o harry ver se está certo (#4370). Ele sai do WebKit headless ou da CLI (`bun run cli screenshot`, `bun run cli ui … --script`), nunca abrindo o app na tela dele. Num PR só de docs, um print do trecho mudado. O revisor confere que ele existe e bate com o que o PR diz.
- `main` só muda por PR e está sempre buildável. Nunca faça force-push nela.
- Trabalhe em `kn/T<n>-<slug>`, por exemplo `kn/T3-stt-benchmark`. Uma task por branch e por PR.
- O corpo do PR diz a task (`T3`), o que mudou e como você verificou (os comandos e o que observou).
- Quem revisa é outra pessoa ou agente (`kiwi task review T3`). O lead faz o merge com squash.

## Pastas de trabalho (worktrees)
- Vários agentes dividem esta máquina. A pasta principal (`kiwinotes/`) fica **sempre em `main`**: ninguém troca de branch nela.
- Cada task tem o próprio worktree: `git worktree add ../kiwinotes-wt/T<n> -b kn/T<n>-<slug> origin/main`. Trabalhe, faça os commits e o push dali.
- Depois do merge: `git worktree remove ../kiwinotes-wt/T<n>`.

## Código do VoiceInk (GPL-3.0)
- O Kiwi porta o motor local do VoiceInk (ADR 0004). Todo arquivo portado, em Swift ou TS, leva no topo: `// Portado de VoiceInk/<caminho> @ <commit> (GPL-3.0). Mudanças: …`.
- Só a parte local: nada de provedores de nuvem, Sparkle, RemoteConfig ou anúncios.

## Layout
- `app/`: o app Electrobun Livewire (main em Bun) com a UI em React + TS + Vite (`app/ui/`).
- `native/`: o helper Swift (sidecar), um Swift Package com áudio, atalho, overlay, inserção e notificações.
- `docs/specs/`: os specs aprovados. `docs/adr/`: as decisões de arquitetura (uma por arquivo, curta).

## Testes
- Lógica TS: `bun test`. Lógica Swift: `swift test` em `native/`.
- **Teste pela CLI headless** (`bun run cli`, `app/README.md`): o app inteiro (as capacidades do AppEngine, o helper, o ditado com dryRun) sem nada na tela de ninguém e com os dados num tmp. É o padrão para testar comportamento.
- **Mudou a limpeza, o tom ou a inserção do ditado?** Rode `bun run test:dictation` em `app/`, a bateria de regressão de `app/test/dictation/`. São casos de texto e casos falados (`say` → STT, sem mic), e ela sai com exit 1 se algum caso falhar. O modo falado usa o STT: pegue `kiwi lock bench` antes. Um caso novo que mostra um problema de verdade entra com `known` e a task do bug.
- Comportamento do app: rode com `ELECTROBUN_AGENT_CONTROL=1` e dirija pelo MCP do Livewire, **só com horário combinado** com a pessoa do Mac (veja abaixo).
- A máquina é compartilhada (M1 Pro, 16 GB): não rode benchmarks pesados em paralelo com outro agente. Pegue `kiwi lock bench` antes.
- **Build novo no Mac de uma pessoa:** nunca deixe dois Kiwi Notes rodando. O agente só fecha o build que **ele mesmo** abriu, pelo caminho da worktree dele (`pkill -f "<sua worktree>/app/build/.*/Kiwi Notes.app/Contents/MacOS"`), e confere com `pgrep -fl "Kiwi Notes|kiwi-helper"`. O app da pessoa quem fecha é ela: todo roteiro de teste começa por "feche o app antigo (menu › Sair do Kiwi Notes)". Desde o T992, um build novo fecha o antigo sozinho; o risco que sobra é um build anterior ao T992.
- **Rodar o app aparece na tela**, mesmo isolado (`KIWI_DATA_DIR` num tmp, `KIWI_DEBUG=1`) e pelo MCP: põe um 2º ícone na barra e abre janelas (#1267). Só com horário combinado. Sem combinar, teste por `bun test`/`swift test` e pelo helper falso.
