# Kiwi Notes: regras para agentes e pessoas

O trabalho é coordenado no canal **kiwinotes** do Kiwi Channels. Toda mudança nasce de uma task (`T<n>`) filed sob um spec aprovado.

## Privacidade (inegociável)
- **Todo exemplo é fictício, por inteiro** (#17952). Nome, nota, pasta, projeto, empresa, cliente, e-mail, ID, caminho, texto, número: tudo o que aparece em código, teste, fixture, commit, corpo de PR, issue, print ou doc é inventado na hora (`Ana`, `Projeto X`, `exemplo`). Nada vem do Mac, das notas, das instruções globais nem do trabalho de quem usa a máquina: nem um pedaço, nem trocando o nome. Na dúvida, invente outro. As regras abaixo (#14082, #14435 e a guarda antes do push) detalham esta.
- **Tudo é local, menos o agente que a pessoa escolher** ([ADR 0011](docs/adr/0011-agente-e-privacidade.md)). Sem telemetria, sem analytics, sem STT na nuvem, e nenhum outro modelo de IA, nem local, no lugar do agente. O agente vem desligado. Ligado, ele recebe o texto do pedido, os trechos que lê pelas ferramentas do Kiwi e a transcrição de uma reunião gravada, quando ela termina; o áudio nunca vai. O login é do próprio agente: o Kiwi nunca pede, lê nem guarda senha ou token.
- O que o app baixa, decidido pelo harry: a atualização do app pelo GitHub Releases (ADR 0008, #1966), os modelos de voz e o adaptador ACP do agente, só com o clique da pessoa, numa versão fixa e conferida, e sem a cópia do Claude Code que vem junto dele (#8368, #8403). São só downloads, e nada da pessoa vai junto.
- **Os testes usam um agente falso.** Nenhum agente do time liga o agente de verdade nem usa a assinatura do harry. O agente de verdade, só o harry testa, e quem pede é o lead.
- Nunca commite áudio, transcrições reais, modelos baixados ou credenciais.
- **Nada do contexto privado do Mac no repo** (#14082). As instruções globais, as notas, os caminhos e os nomes do trabalho de quem usa a máquina não entram em código, teste, pasta falsa, print nem doc. Dado de exemplo é inventado (`exemplo`, `Ana`, `Projeto X`). O CI barra os termos conhecidos com o `app/scripts/privacy-check.ts`, por uma lista em hash. Para um termo novo, rode `bun scripts/privacy-check.ts --hash "…"` e ponha a linha no `privacy-terms.txt`.
- **Agente não usa o microfone real.** Nada que ligue o mic: `record.start`, o atalho, ou uma ação do app (agent control) que grave, mesmo que o Terminal já tenha a permissão. Para ver o overlay, use `overlay.state`, que não liga o mic. Diagnóstico com áudio sintético (`say`) ou com os arquivos que o harry gravar para isso. Teste com o mic real é só do harry, e quem pede é o lead (#320).
- **Agente não mexe na sessão do harry.** Nos testes, nada de AppleScript (`osascript`), abrir ou controlar outro app, colar nem escrever no clipboard real: a colagem cai no app que estiver na frente, que pode ser uma conversa dele. O `insert.text` dos agentes vai sempre com `dryRun: true` (o app em `KIWI_DEBUG=1` faz isso sozinho). Colagem de verdade é teste do harry, pedido pelo lead (#489).
- **As notas do harry não vão ao repo, nunca** (#14435, #14438). Elas apontam para a pasta de trabalho dele, com dados confidenciais. Um agente pode abrir uma nota neste Mac para entender um erro ou testar. O conteúdo dela não vai a commit, teste, fixture, print, corpo de PR nem issue. O log do app, só com o ok dele, e só horários, números e eventos: nunca nome de nota ou de pasta. Testes, prints e exemplos usam conteúdo inventado, de outro assunto.
- **A guarda antes do push** (spec #14415). O `bun install` liga o hook `pre-push` (`core.hooksPath` = `.githooks`), e o CI repete a guarda em cada PR. Ela roda nos commits que vão subir, linha por linha e nas mensagens: a lista em hash, os IDs de nuvem (service account do GCP, `projects/<id>`, `gs://`, ARN e chave da AWS), as chaves e os tokens que o guardrail reconhece pelo formato, os nomes de máquina `<nome>.local` e, por OCR local (o Vision do macOS), o texto dos prints novos. Se algo barra, o push não sai, e a saída diz o arquivo, a linha e o motivo, nunca o valor.
  - **Valores de exemplo** passam: `prj-exemplo…`, `sa-exemplo@prj-exemplo….iam.gserviceaccount.com`, `gs://exemplo-…`, a conta AWS `123456789012`, `exemplo.local`.
  - **Falso positivo:** uma exceção por arquivo e por linha em `app/scripts/privacy-exceptions.txt`, com o motivo, revisada no PR. Nunca por termo. `bun scripts/push-guard.ts --line <arquivo> <n>` dá a linha certa.
  - **Nunca** `git push --no-verify`.
  - **Worktree antiga:** um branch de antes da guarda não tem a pasta `.githooks`, e o git não roda hook nenhum. Rebaseie na `main` antes do push.
- **Agente não dispara diálogo do macOS.** Nada que possa abrir um pedido do sistema na tela do harry: permissões (`permissions.request`, `AXIsProcessTrustedWithOptions`, mic), Automação ou Ajustes. Fluxo de permissão se testa só com o helper falso, e a chave `defaults` de `com.kiwinotes.helper` não se mexe. Rodar o app ou o helper de verdade só quando todas as permissões já estão dadas, e mesmo assim sem mic e com `dryRun` (#536).

## Branches e PRs
- **1 spec = 1 issue = 1 PR** (#4331). Cada ponto (uma correção, uma feature, um botão) é um spec. Um pedido com vários pontos vira vários specs.
- Aprovado o spec, quem pega a task abre a issue no repo (`gh issue create`), com o link do spec do Kiwi (#N) e a task (`T<n>`).
- O PR resolve só aquela issue e leva `Closes #<issue>` no corpo, para o merge fechá-la.
- O PR leva **um print ou um vídeo** do resultado, o que for mais fácil, no corpo do PR e no canal da task, para o harry ver se está certo (#4370). Ele sai do WebKit headless ou da CLI (`bun run cli screenshot`, `bun run cli ui … --script`), nunca abrindo o app na tela dele. Num PR só de docs, um print do trecho mudado. O revisor confere que ele existe e bate com o que o PR diz.
- **Os prints ficam fora da `main`, no branch órfão `evidence`** (spec #13895): uma pasta por task, `T<n>/`, em WebP. Uma vez por máquina: `git worktree add ../kiwinotes-wt/evidence evidence`. Para cada print: copie para `../kiwinotes-wt/evidence/T<n>/`, `git -C ../kiwinotes-wt/evidence pull --rebase`, depois `add`, `commit` e `push`. No corpo do PR, o link é `https://github.com/kiwi-init/kiwinotes/blob/evidence/T<n>/arquivo.webp?raw=true`. Nada de print em `docs/` na `main`.
- `main` só muda por PR e está sempre buildável. Nunca faça force-push nela.
- Trabalhe em `kn/T<n>-<slug>`, por exemplo `kn/T3-stt-benchmark`. Uma task por branch e por PR.
- O corpo do PR diz a task (`T3`), o que mudou e como você verificou (os comandos e o que observou).
- Quem revisa é outra pessoa ou agente (`kiwi task review T3`). O lead faz o merge com squash.

## Releases
- **Só com o ok do harry**, e quem solta é o lead.
- **A versão é `vANO.MÊS.N`**, no formato do Channels (spec #13879). O N conta os releases do mês: `v2026.11.1`, `v2026.11.2`, `v2026.12.1`. Não há mais rc.
- **O passo a passo:**
  1. Na `main` verde, o próximo tag: `cd app && bun scripts/update-feed.ts next $(date +%Y-%m) $(git tag -l 'v*')`.
  2. Um PR com o `app/package.json` nessa versão, sem o `v`, e o CHANGELOG com a seção dela no lugar de "Ainda sem versão".
  3. Depois do merge: `git tag vANO.MÊS.N <sha do merge>` e `git push origin vANO.MÊS.N`.
  4. O `release.yml` confere que o tag bate com o `package.json`, assina, notariza e publica o "Kiwi Notes ANO.MÊS.N". As notas listam os PRs desde o release anterior, com um rodapé de onde baixar e como conferir. O release também sobrescreve o feed antigo das rc (`updates-rc`), para quem está numa rc receber a versão nova.
  5. Confira o release: as notas, o `.dmg`, o `.tar.zst` e o `-update.json`, e que ele virou o "latest".

## Ordem do trabalho
- O trabalho segue a ordem dos rooms do Kiwi Channels: **1. #meetings** (reuniões, fase 2) → **2. #overall-levelup** (nivelar a qualidade do app em todos os aspectos e funções) → **3. #mega-idea** (o agente e o Kiwi-cat).
- A mega-ideia só começa quando o overall level up estiver 100% limpo.
- Dentro de cada room, os specs andam por fase, 1 ou 2 por vez.
- Uma correção urgente (algo quebrado na `main` ou num build do harry) pode passar na frente, se o lead disser.

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
- `docs/specs/`: os specs aprovados e as notas de cada parte do app. `docs/adr/`: as decisões de arquitetura (uma por arquivo, curta). `docs/design/`: a marca, os mockups e a arte do Kiwi Cat que o app usa (o ícone e o gato leem daqui). `docs/research/`: as pesquisas. O que saiu do repo, e o commit em que estava, fica em `docs/arquivo.md`.
- `licenses/`: as licenças do código portado de outros projetos (veja o `NOTICE`).

## Testes
- Lógica TS: `bun test`. Lógica Swift: `swift test` em `native/`.
- **Teste pela CLI headless** (`bun run cli`, `app/README.md`): o app inteiro (as capacidades do AppEngine, o helper, o ditado com dryRun) sem nada na tela de ninguém e com os dados num tmp. É o padrão para testar comportamento.
- **Mudou a limpeza, o tom ou a inserção do ditado?** Rode `bun run test:dictation` em `app/`, a bateria de regressão de `app/test/dictation/`. São casos de texto e casos falados (`say` → STT, sem mic), e ela sai com exit 1 se algum caso falhar. O modo falado usa o STT: pegue `kiwi lock bench` antes. Um caso novo que mostra um problema de verdade entra com `known` e a task do bug.
- Comportamento do app: rode com `ELECTROBUN_AGENT_CONTROL=1` e dirija pelo MCP do Livewire, **só com horário combinado** com a pessoa do Mac (veja abaixo).
- A máquina é compartilhada (M1 Pro, 16 GB): não rode benchmarks pesados em paralelo com outro agente. Pegue `kiwi lock bench` antes.
- **Build novo no Mac de uma pessoa:** nunca deixe dois Kiwi Notes rodando. O agente só fecha o build que **ele mesmo** abriu, pelo caminho da worktree dele (`pkill -f "<sua worktree>/app/build/.*/Kiwi Notes.app/Contents/MacOS"`), e confere com `pgrep -fl "Kiwi Notes|kiwi-helper"`. O app da pessoa quem fecha é ela: todo roteiro de teste começa por "feche o app antigo (menu › Sair do Kiwi Notes)". Desde o T992, um build novo fecha o antigo sozinho; o risco que sobra é um build anterior ao T992.
- **Rodar o app aparece na tela**, mesmo isolado (`KIWI_DATA_DIR` num tmp, `KIWI_DEBUG=1`) e pelo MCP: põe um 2º ícone na barra e abre janelas (#1267). Só com horário combinado. Sem combinar, teste por `bun test`/`swift test` e pelo helper falso.
