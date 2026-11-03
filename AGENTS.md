# Kiwi Notes: regras para agentes e pessoas

O trabalho é coordenado no canal **kiwinotes** do Kiwi Channels. Toda mudança nasce de uma task (`T<n>`) filed sob um spec aprovado.

## Privacidade (inegociável)
- Nada sai do Mac: sem telemetria, sem analytics, sem STT nem LLM na nuvem. A única exceção é o Claude Code (decisão #34), e só onde um spec disser.
- Nunca commite áudio, transcrições reais, modelos baixados ou credenciais.
- **Agente não usa o microfone real.** Nada que ligue o mic: `record.start`, o atalho, ou uma ação do app (agent control) que grave, mesmo que o Terminal já tenha a permissão. Para ver o overlay, use `overlay.state`, que não liga o mic. Diagnóstico com áudio sintético (`say`) ou com os arquivos que o harry gravar para isso. Teste com o mic real é só do harry, e quem pede é o lead (#320).
- **Agente não mexe na sessão do harry.** Nos testes, nada de AppleScript (`osascript`), abrir ou controlar outro app, colar nem escrever no clipboard real: a colagem cai no app que estiver na frente, que pode ser uma conversa dele. O `insert.text` dos agentes vai sempre com `dryRun: true` (o app em `KIWI_DEBUG=1` faz isso sozinho). Colagem de verdade é teste do harry, pedido pelo lead (#489).

## Branches e PRs
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
- Comportamento do app: rode com `ELECTROBUN_AGENT_CONTROL=1` e dirija pelo MCP do Livewire.
- A máquina é compartilhada (M1 Pro, 16 GB): não rode benchmarks pesados em paralelo com outro agente. Pegue `kiwi lock bench` antes.
