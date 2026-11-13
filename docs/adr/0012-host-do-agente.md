# ADR 0012: o host do agente

- Status: aceito (T8478, spec #4576, aprovado pelo harry em #8474). O adaptador do Claude Code entrou no T8540 (spec #8368, aprovado em #8477), e o agente dentro do app no T8678 (spec #8339, aprovado em #8675).
- Segue o [ADR 0011](0011-agente-e-privacidade.md) (o que vai para o agente) e a escolha do harry pelo adaptador ACP (#8368).
- Código:
  - [`app/src/agent/host.ts`](../../app/src/agent/host.ts): abre o agente, fala ACP com ele e devolve os eventos;
  - [`app/src/agent/claude.ts`](../../app/src/agent/claude.ts): acha o Claude Code instalado e diz a versão e se ele está logado;
  - [`app/src/agent/errors.ts`](../../app/src/agent/errors.ts): os erros, com as mensagens que a pessoa lê;
  - [`app/src/agent/fake/`](../../app/src/agent/fake/): o agente falso, que fala ACP, e o `claude` falso;
  - [`app/src/agent/adapter/`](../../app/src/agent/adapter/): o adaptador do Claude Code. A lista fixa (`pinned.ts`), o download (`download.ts`), a régua de versão (`version.ts`), a abertura (`open.ts`) e a prova (`proof.ts`);
  - [`app/scripts/cli-agent.ts`](../../app/scripts/cli-agent.ts): `bun run cli agent status`, `ask "…"`, `download`, `remove` e `proof`;
  - [`app/src/agent/service.ts`](../../app/src/agent/service.ts) e [`app-service.ts`](../../app/src/agent/app-service.ts): o agente dentro do app, que as capacidades `agent.*` chamam (T8678).

## Contexto
A mega-ideia precisa que o Kiwi converse com um agente de CLI: o Claude Code, para o harry, e outro agente para outra pessoa. O harry escolheu ligar o Claude Code pelo adaptador ACP (#8368), que o Kiwi baixa na primeira vez. O ACP (Agent Client Protocol) é um protocolo aberto: o cliente (o Kiwi) abre o programa do agente e conversa com ele em JSON-RPC pelo stdin e o stdout. O Gemini e o OpenCode falam ACP sozinhos; o Claude Code fala pelo adaptador.

Este ADR descreve a peça do Kiwi que faz isso, ainda sem tela e sem rede. O download do adaptador é do spec #8368, e a tela (Ajustes › Agente) vem depois dele.

## Decisão
- **Uma interface própria do Kiwi,** a classe `AgentHost`:
  - `start()` abre o agente e a sessão;
  - `ask(texto, onEvent)` manda um pedido e devolve a resposta inteira;
  - `cancel()` cancela o pedido em andamento;
  - `stop()` fecha o agente.

  Os eventos são poucos: `status` (`thinking`, ou `running` com o nome da ferramenta), `text`, `permission` e `done`. A tela e as ferramentas do Kiwi vão usar só esta interface, nunca o ACP direto.
- **Por baixo, o ACP v1, com a biblioteca oficial** (`@agentclientprotocol/sdk` 2.6.0, da Zed Industries, Apache-2.0, numa versão fixa). O crédito está no Sobre e no `THIRD_PARTY_NOTICES.txt`. O agente falso usa o lado "agente" da mesma biblioteca, então os testes falam o protocolo de verdade, e não uma imitação nossa.
- **O host recebe o programa a abrir** (o comando e os argumentos). Neste spec é o agente falso. No #8368 será o adaptador baixado, aberto pelo Bun que vem dentro do Kiwi, com `CLAUDE_CODE_EXECUTABLE` apontando para o Claude Code instalado.
- **Um pedido por vez.** Um segundo `ask` com o primeiro em andamento é recusado com `E_AGENT_BUSY`. O `cancel()` manda o `session/cancel`, e o pedido termina com `stopReason: "cancelled"`.
- **A sessão é retomada.** O id da sessão fica em `<dados>/agent/session.json`. Ao abrir, o host tenta, nesta ordem:
  1. o `session/resume`, se o agente diz que sabe (o adaptador do Claude Code sabe);
  2. senão, o `session/load`. A conversa antiga que o agente repete nele não entra na resposta do pedido novo;
  3. senão, ou se a sessão guardada não existe mais, uma sessão nova.

  Um erro de login, de limite ou de rede na retomada sobe como erro, e não vira uma sessão nova. `forgetSession()` faz a próxima abertura começar do zero.
- **O agente fica isolado.** Ao abrir ou retomar a sessão, o host pede:
  - **uma pasta de trabalho só do agente:** `<dados>/agent/work`, que é o `cwd` da sessão e do processo;
  - **nenhum servidor MCP** (`mcpServers: []`);
  - **no `_meta.claudeCode.options`,** que o adaptador passa ao SDK do Claude Code por cima dos padrões dele:
    - `settingSources: []`: não carrega as configurações da pessoa (as de `~/.claude`, as do projeto e as locais), com os hooks, as regras, o CLAUDE.md e os servidores MCP do terminal;
    - `strictMcpConfig: true`: só valem os servidores que o Kiwi mandar;
    - `tools: []`: nenhuma ferramenta embutida (o shell, a edição de arquivos e a web). Neste spec o agente só conversa;
    - `allowDangerouslySkipPermissions: false`: o modo que pula as permissões fica desligado (T8540). A prova do builder mostrou por quê: sem isso, um `"defaultMode": "bypassPermissions"` no `~/.claude/settings.json` da pessoa virou `--permission-mode=bypassPermissions --allow-dangerously-skip-permissions` no Claude Code. Com isso, a sessão abre em `--permission-mode=default`, e toda ferramenta passa pelo pedido de permissão do Kiwi.

  Um agente que não é o Claude Code ignora esse `_meta`.

  **O que o `_meta` não segura** (revisão do T8478): o próprio adaptador lê o `~/.claude/settings.json` da pessoa, pelo `resolveSettings` do SDK, mesmo com `settingSources: []`. Ele usa esse arquivo para:
  - o modo de permissão padrão (`permissions.defaultMode`);
  - o bloqueio do bypass;
  - a escolha de modelo;
  - o `apiKeyHelper`.

  Os hooks e os servidores MCP não voltam por esse caminho: a sessão recebe só o `settings` que o Kiwi mandar. O modo de permissão que pula tudo está fechado pelo `allowDangerouslySkipPermissions: false`; um `acceptEdits` ou um `auto` da pessoa ainda passariam, e por isso a tela que der ferramentas ao agente fixa o modo pelo ACP (`session/set_mode`).
- **Nenhuma permissão é dada.** Sem tela, todo `session/request_permission` é respondido com a opção de recusar (ou com `cancelled`), e o evento `permission` conta qual ferramenta foi recusada. O Kiwi também diz ao agente que não lê nem escreve arquivos por ele, e que não abre terminal (`clientCapabilities`).
- **Os erros viram seis casos,** com mensagens em português:
  - os quatro do spec: `E_AGENT_NOT_INSTALLED`, `E_AGENT_NOT_LOGGED_IN`, `E_AGENT_LIMIT` e `E_AGENT_OFFLINE`;
  - os do host: `E_AGENT_BUSY` e `E_AGENT_FAILED`.

  A classificação olha primeiro o que o protocolo define (o `authRequired`, código -32000, e um `data.reason`), depois o `ENOENT` de um programa que não existe, e só por fim as palavras da mensagem. O que o agente disse fica no `detail`, para o log, e nunca vai para a mensagem da pessoa.
- **O Claude Code instalado:**
  - **achar:** o host procura o `claude` no PATH e nas pastas do instalador (`~/.local/bin`, `~/.claude/local`, `/opt/homebrew/bin` e `/usr/local/bin`). Um app aberto pelo Finder não tem o PATH do terminal;
  - **a versão:** pelo `claude --version`;
  - **o login:** pelo `claude auth status`. Contam só o código de saída e o `authMethod`, e o resto (a conta, o e-mail, a organização) é descartado ali mesmo. O Kiwi nunca lê nem guarda credenciais (ADR 0011).
- **Nada liga sozinho.** Criar o host não abre nada. Só o `start()` abre o agente.
- **Os falsos:** `fake/agent.ts` responde, demora (`/lento`), pede permissão (`/permissao`) e falha de cada um dos quatro jeitos (`/sem-login`, `/limite`, `/sem-rede`), e também cai no meio (`/cai`). Ele guarda as sessões na pasta onde roda, para provar a retomada entre aberturas. `fake/claude.ts` responde o `--version` e o `auth status`. Todo teste e a CLI dos agentes usam os dois.

## O adaptador do Claude Code (T8540, spec #8368)
O Claude Code não fala ACP sozinho. O harry escolheu o adaptador oficial do ACP, baixado na primeira vez que a pessoa liga o agente (#8368).

- **A versão fixa:** `@agentclientprotocol/claude-agent-acp` 0.106.0, feito para o Claude Code 2.1.322 (a versão do `manifest.json` do SDK que ele usa). Ela só muda numa versão nova do Kiwi.
- **A lista fixa de pacotes,** cada um conferido contra o `integrity` (sha512) que o npm publica, antes de ir para o disco:

  | pacote | versão | licença |
  |---|---|---|
  | `@agentclientprotocol/claude-agent-acp` | 0.106.0 | Apache-2.0 |
  | `@anthropic-ai/claude-agent-sdk` | 0.3.322 | fechada (da Anthropic) |
  | `@agentclientprotocol/sdk` | 2.6.0 | Apache-2.0 |
  | `diff` | 9.0.0 | BSD-3-Clause |
  | `zod` | 4.6.7 | MIT |

  São 4,4 MB baixados e 27 MB na pasta. As dependências "peer" do SDK (`@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`) ficam de fora: o adaptador só importa o `sdk.mjs` do SDK, e ele só usa módulos do próprio Node/Bun.
- **Sem a cópia do Claude Code.** O SDK declara, como dependência opcional, um Claude Code inteiro para cada plataforma (`@anthropic-ai/claude-agent-sdk-darwin-arm64`, 324 MB). O Kiwi não instala pelo npm: ele baixa só a lista acima. E abre o adaptador com o `CLAUDE_CODE_EXECUTABLE` no `claude` instalado (no caminho como o Kiwi achou, sem resolver o link, para pegar a atualização sozinha do Claude Code). Sem a variável, o adaptador procuraria a cópia, que não existe, e falharia: ele nunca usa outra cópia.
- **O download:**
  - só a pedido: `bun run cli agent download`, e depois o clique em Ajustes › Agente;
  - tudo ou nada: uma pasta `.part` que só vira `<dados>/agent/adapter/0.106.0` no fim, com o marcador `kiwi-adapter.json`;
  - um pacote que chega diferente da lista (o sha512, ou o nome e a versão do `package.json` de dentro) é recusado, e nada fica instalado (`E_ADAPTER_TAMPERED`). A falta de rede é `E_ADAPTER_OFFLINE`, e um 404 é `E_ADAPTER_DOWNLOAD`;
  - é um GET sem cookie, sem conta e sem token. `agent remove` apaga a pasta.
- **Aberto pelo Bun do Kiwi** (`process.execPath`, no app o Bun de dentro do .app). A pessoa não instala Node nem mais nada.
- **A régua de versão** (`version.ts`): serve o Claude Code igual ou mais novo que o 2.1.322, na mesma versão principal (`2.x`). Mais antigo é `E_AGENT_TOO_OLD` (a pessoa atualiza o Claude Code). Outra versão principal é `E_AGENT_TOO_NEW`: o agente fica indisponível até sair um Kiwi novo, e o plano B abaixo existe para esse caso. A prova de verdade confirma se essa régua funciona.
- **Antes de abrir,** as conferências seguem a ordem das mensagens: instalado, a versão, o login e o adaptador baixado (`E_ADAPTER_MISSING`).
- **A guarda de assinatura do adaptador** (`--hide-claude-auth`, que recusa uma conta da assinatura do Claude) só liga com essa opção na linha de comando. O Kiwi não passa a opção.

### A prova do builder (feita, com um `claude` falso)
`KIWI_ADAPTER_PROOF=1 bun test src/agent/adapter/proof.test.ts` (e `bun run cli agent proof`, sem `--real`) baixa a lista fixa do npm e abre o adaptador de verdade, pelo Bun, com um `claude` falso que anota como foi chamado e responde o mínimo do protocolo do SDK. Em 2026-11-12:
- o adaptador abriu o programa indicado pelo Kiwi, uma vez, na pasta de trabalho do agente;
- com `--tools= --setting-sources= --strict-mcp-config --permission-mode=default`, sem `--mcp-config` e sem `--allow-dangerously-skip-permissions`;
- a sessão abriu sem nenhum pedido, em menos de 1 s.

### A prova de verdade (do harry)
`bun run cli agent proof --real`, que o lead pede ao harry. Ela baixa o adaptador se faltar, abre uma sessão no Claude Code instalado **sem mandar nenhum pedido** e mostra:
- o processo que o adaptador abriu (o caminho tem de ser o do `claude` do terminal) e as opções de isolamento dele;
- a versão e o login (só o método);
- os comandos e as opções (o modelo, os agentes) que a sessão recebeu. Um comando, uma skill, um plugin ou um agente pessoal do harry nessa lista é uma configuração que entrou.

A sessão da prova abre com `persistSession: false` (vira `--no-session-persistence`, e a prova confere), para não deixar nada gravado em `~/.claude/projects/`. Ela espera a lista de comandos chegar, com um teto de 5 s; se não chegar, o `ok` é `false` e o relatório diz isso, porque uma lista vazia não prova que nada pessoal entrou (T8603).

O resultado entra aqui quando o harry rodar.

## O agente dentro do app (T8678, spec #8339)
O app passa a ligar o agente, baixar o adaptador, mandar um pedido e desligar, por trás da tela (a seção de Ajustes é o spec #8373).

- **As capacidades** (contrato 1.41.0):
  - `agent.status`: o estado. Com `{refresh: true}`, confere também o Claude Code instalado;
  - `agent.enable`: liga. Na primeira vez, só com `{consent: true}`, depois da tela do ADR 0011;
  - `agent.disable`, `agent.download`, `agent.ask {text}`, `agent.cancel`, `agent.remove` e `agent.configure {model, effort}`.
- **Os eventos:**
  - `agent.status` leva o estado inteiro: o progresso do download em bytes, o programa abrindo ou fechando, um pedido começando ou acabando;
  - `agent.turn` leva a resposta ao vivo de um pedido, com o id dele: `started`, `status` (`opening`, `thinking`, `running` com a ferramenta), `text`, `permission`, `done` (com o texto inteiro) ou `error` (com o código).
- **Pedir e baixar voltam logo.** A chamada do AppEngine tem teto de 10 s (`maxRequestTime`), e uma resposta do agente leva mais. O `agent.ask` devolve o id, e o resto chega pelos eventos.
- **O que o app lembra:** o `agent` nas settings (global), com `enabled`, `consented`, `model` e `effort`. Ele só muda pelas capacidades `agent.*`: o `settings.set` recusa a chave. A sessão do agente (`session.json`) e o adaptador baixado já ficavam no disco.
- **O ciclo do programa:**
  - ele abre no primeiro pedido e fica aberto;
  - fecha ao desligar, ao remover o adaptador, depois de 10 minutos sem uso (`AGENT_IDLE_MS`) e quando o app sai: o `close()` no `quit()` espera o processo sair, e o `killNow()` no `process.on("exit")` manda o SIGTERM, que o adaptador trata limpo;
  - **um programa ainda abrindo também fecha:** o desligar, o `close()` e o `killNow()` param ele na hora, sem esperar a abertura, e a abertura tem um teto de 60 s (`startTimeoutMs`), que dá `E_AGENT_FAILED`. Um agente que não responde nunca prende o Desligar nem a saída do app;
  - desligar ou sair no meio de um pedido termina ele como cancelado.
- **O modelo e o esforço são do Kiwi.** Na prova de verdade (#8666), a sessão abriu com os do terminal do harry (`fable`, `high`), lidos pelo adaptador do `~/.claude/settings.json`. Agora:
  - o host aplica os valores dos ajustes do app pelo `session/set_config_option` do ACP, logo depois de abrir, e antes de um pedido se eles mudaram;
  - o padrão é `default` nos dois, o padrão do Claude Code;
  - um valor que o agente não oferece fica de fora, e a sessão segue com o que tinha (`applyConfig` devolve o `refused`);
  - o `agent.status` mostra o que o Kiwi pede (`model`, `effort`) e o que a sessão aberta tem (`session`);
  - **a conferir no roteiro do harry:** o `fable` veio do `SettingsManager` do adaptador. O que o `setModel("default")` vira no Claude Code de verdade (o padrão da conta, ou de novo o do `settings.json`) só a sessão de verdade mostra.
- **Desligado, nada abre nem vai à rede.** `agent.ask` e `agent.download` dão `E_AGENT_DISABLED`. O `agent.status` sem `refresh` não abre programa nenhum. O `refresh` (a seção abriu, o "Tentar de novo") roda só o `claude --version` e o `claude auth status`, como o `claudeStatus` do host.
- **Os códigos novos:**
  - `E_AGENT_CONSENT`: ligar sem o aceite;
  - `E_AGENT_DISABLED`;
  - `E_ADAPTER_CANCELLED`: o download cancelado apaga a `.part`;
  - `E_NO_AGENT`: um build sem o serviço.
- **Para os testes, só no headless** (`KIWI_HEADLESS=1`), e o app de verdade não lê nenhuma delas:
  - `KIWI_FAKE_AGENT=1`: o agente falso e o `claude` falso;
  - `KIWI_ADAPTER_REGISTRY` e `KIWI_ADAPTER_PACKAGES`: um registro do npm falso e a lista de teste;
  - `KIWI_AGENT_IDLE_MS`.

## As ferramentas do Kiwi (T8956, spec #7496)
O agente lê o cofre por um servidor MCP do próprio app (`src/agent/tools/`), e só por ele:
- **HTTP local dentro do app**, e não stdio. O servidor usa o cofre e o índice que já estão abertos (a busca pelo sentido e o texto dos anexos inclusos), pelas mesmas capacidades de leitura das janelas (`notes.search`, `notes.list`, `notes.get` e `meetings.list`). Um servidor stdio seria um 2º Bun, aberto pelo `claude`, com outro índice.
- **Só no próprio Mac e só com o programa aberto.** Ele escuta em `127.0.0.1`, numa porta sorteada, com uma senha nova a cada abertura no cabeçalho `X-Kiwi-Token`, e recusa um pedido com `Origin` (uma página do navegador). Ele abre com o programa do agente e fecha junto: ao desligar, depois de 10 min sem uso e na saída do app.
  - A senha aparece na linha de comando do `claude` (o `--mcp-config` do SDK). No macOS, só os processos da própria pessoa leem essa linha, e eles já leem o cofre direto. A prova troca a senha por `***`.
- **Como chega ao Claude Code** (conferido no adaptador 0.106.0 e na doc do Agent SDK):
  - o `mcpServers` do `session/new` vira o `--mcp-config` com o servidor `kiwi`, junto do `--strict-mcp-config`;
  - o `tools: []` tira só as ferramentas embutidas, e as MCP continuam;
  - o `allowedTools: ["mcp__kiwi__*"]` libera só as do Kiwi. Um curinga sem o servidor (`mcp__*`) seria ignorado.
  - O host só manda o servidor a um agente que anuncia `mcpCapabilities.http`.
- **A permissão:** um pedido de permissão que chegue ao host é aceito só para `mcp__kiwi__*`, e o resto continua recusado.
- **As seis ferramentas** são só de leitura (`readOnlyHint`): `notes_search`, `notes_outline`, `notes_read`, `notes_list`, `meetings_list` e `meetings_get`.
  - Os nomes usam sublinhado, porque a API do Claude não aceita ponto.
  - O texto vem como está. Cada resposta tem um teto (12 mil caracteres de texto, 30 resultados, 200 notas, 50 reuniões), e o que passa vem com o `proximoOffset` e um aviso.
  - A transcrição sai sem as marcas internas (`%%meeting-segment…%%`).
- **O que a pessoa vê:** cada uso vira um status do pedido, com o que foi lido (`agent.turn`, o `target`, contrato 1.43.0), e o "Testar" mostra "Lendo Projetos/Kiwi.md…".
- **A prova:** `bun run cli agent proof --tools` abre a sessão com o servidor do Kiwi sobre um cofre vazio, sem pedido, e diz se o Claude Code conectou e pediu o `tools/list`.
  - A do builder (adaptador de verdade, `claude` falso que conecta como o Claude Code) passou em 2026-11-12: `--mcp-config` só com o `kiwi`, `--allowedTools=mcp__kiwi__*`, `--tools=`, `--strict-mcp-config`, e o `tools/list` chegou.
  - A de verdade (`--real --tools`) é do harry, e quem pede é o lead.

## A escrita nas notas (T9251, spec #8356)
O harry decidiu (#8356) que o agente escreve direto na nota, e a pessoa desfaz se não gostar. O mesmo servidor ganha três ferramentas, que só aparecem quando o app dá a ele o escritor (`src/agent/tools/writer.ts`):
- **`notes_create`, `notes_append` e `notes_write`.** Criar, acrescentar (no fim da nota ou de uma seção) e trocar (uma seção, ou a nota inteira). Nenhuma apaga, renomeia nem move.
  - As anotações do MCP dizem que elas escrevem (`readOnlyHint: false`), e só o `notes_write` troca texto que já existia (`destructiveHint`).
  - A permissão não muda: o `mcp__kiwi__*` já cobre as três.
- **Pelo mesmo salvar das Notas.** O escritor só chama `notes.get`, `notes.save`, `notes.create` e `notes.folder`, na pasta de notas aberta, com a fronteira do cofre (só `.md`, sem `..`, sem link simbólico para fora).
- **Uma edição da pessoa nunca se perde.**
  - O `notes_read` devolve a `versao` da nota, e o `notes_write` exige a versão lida.
  - O `notes.save` grava só se o arquivo ainda está naquela versão: o cofre confere de novo logo antes de trocar o arquivo.
  - Se a nota mudou no meio, nada é escrito, e o agente recebe `E_CHANGED` com o pedido de ler de novo.
  - O `notes_append` sem versão lê de novo e tenta outra vez, até 3 vezes.
  - Com a nota aberta e uma edição por gravar, a janela junta a escrita do agente com a da pessoa (o merge do T5454). Sem edição pendente, ela só recarrega.
- **A cópia de antes, em dois lugares, os dois fora do cofre:**
  - nas Versões da nota: o `notes.save` com `snapshot: true` (contrato 1.44.0) grava o texto de antes na hora, sem o intervalo de 2 minutos;
  - no registro do agente (`src/agent/activity.ts`, em `<dados>/agent/activity/`), gravada antes da escrita e tirada se ela não acontece. É desta cópia que o desfazer precisa (abaixo): o limite de 50 versões por nota não a apaga.
- **O registro de cada pedido:** o que foi lido e o que mudou, com a nota, a hora, o tipo, o tamanho antes e depois, a versão que a escrita deixou e a pasta de notas. Fica 30 dias, e o `agent.activity` (e o `bun run cli agent activity`) mostra.
- **As notas de reunião ficam só para leitura.** A escrita numa nota com `type: meeting` é recusada, e também a que deixaria uma nota comum com esse frontmatter.
- **O teto é de 40 mil caracteres por escrita.** O que passa volta com um aviso claro, dizendo para mudar por seção ou acrescentar em partes.
  - O corpo que o servidor aceita subiu de 64 KB para 256 KB, para caber o teto mesmo no pior caso do JSON: 3 bytes por caractere (CJK) ou 6 num `\uXXXX`.
  - Assim, o que passa do teto chega à ferramenta e volta com o aviso, e não com um 413 do servidor.
- **O que a pessoa vê:** o status ao vivo diz "Escrevendo em Projetos/Kiwi.md…", e a dica do "Testar" diz que o agente pode mudar as notas e que o texto de antes fica nas Versões.
- **Não entrava em release** antes do desfazer e da tela "Atividade do agente". As duas chegaram (specs #9353 e #9480), e a escrita sai na próxima release que o harry aprovar.

## O desfazer (T9398, spec #9353)
O agente escreve direto na nota, e a pessoa desfaz se não gostar. O `agent.undo` (e o `bun run cli agent undo <pedido> [--change N]`, pelo headless de pé) volta o pedido inteiro ou uma mudança dele, com a cópia do registro (`src/agent/undo.ts`):
- **Nota por nota.** Cada nota volta ao texto de antes da primeira escrita do agente nela, ou fica como está, com o motivo (`E_LATER_WRITE`, `E_CHANGED`, `E_GONE`, `E_OTHER_FOLDER`, `E_EXPIRED`, `E_NO_COPY`). Uma recusada não impede as outras.
- **Nunca por cima da pessoa.** Só age com a nota exatamente na versão que o agente deixou, e a conferência vai junto com a ação:
  - voltar o texto é o `notes.save` com `baseVersion` (o cofre confere de novo logo antes de trocar o arquivo) e `snapshot: true`, que grava o texto do agente nas Versões na hora;
  - a nota que o agente criou vai para a Lixeira pelo `notes.delete` com `baseVersion` (contrato 1.45.0): o cofre relê o arquivo logo antes de tirá-lo do lugar. São os 10 minutos do Desfazer do app, e depois a Lixeira do macOS.
- **Uma mudança só,** se o agente não escreveu de novo naquela nota depois, nem no mesmo pedido nem num pedido seguinte. Senão a mais nova vem primeiro, e o aviso diz qual.
- **A pasta de notas** é conferida pela chave (o caminho), não pelo id da abertura: a mesma pasta reaberta continua desfazendo. As chamadas levam o `folderId` de agora, e o app recusa se a pasta trocar no meio.
- **O registro anota** a hora em cada mudança desfeita (`undone`). Desfazer de novo não faz nada e diz. Um desfazer que gravou e caiu antes de anotar só anota da próxima vez.
- **30 dias pela idade da mudança.** Depois disso, não há mais o que desfazer, mesmo com a cópia no disco.
- **O número de cada cópia nunca se repete** no pedido: o último usado fica no `request.json` antes de a cópia ser gravada.
- **É da pessoa:** não vira ferramenta do agente e não precisa dele ligado. Sem "refazer": o texto do agente fica nas Versões.

## A tela "Atividade do agente" (T9493, spec #9480)
A seção em Ajustes › Agente, logo abaixo do "Testar" (`ui/settings/AgentActivity.tsx`), põe na tela o registro e o desfazer. Aparece também com o agente desligado.
- **A lista:** os pedidos dos últimos 30 dias, do mais novo ao mais velho; os 50 mais novos, e um "Mostrar mais" até 200 (o teto do `agent.activity`). Cada um com a hora, a primeira linha do pedido, o que o agente leu, resumido, e cada mudança.
- **[Ver]** é o `agent.change` (contrato 1.46.0, `src/agent/change-view.ts`), que só lê:
  - o antes é a cópia do registro ("" numa nota criada);
  - o depois exato é a nota de agora, se ela ainda está na versão que o agente deixou, ou a cópia da escrita seguinte dele na mesma nota (a 1ª de duas escritas). Senão, é a nota de agora, com o aviso de que ela mudou depois;
  - a nota que sumiu, outra pasta de notas aberta (conferida pela chave, como o desfazer) e a mudança já desfeita mostram só o antes, com o aviso.
  O comparador é o das Versões (`ui/notes/diff.ts`).
- **[Desfazer]** é o `agent.undo`, sem regra nova, de uma mudança ou do pedido inteiro (o do pedido aparece com mais de uma mudança e enquanto sobra alguma). Sem confirmação, porque nada se perde. O resultado vem nota por nota em palavras simples, e o `E_LATER_WRITE` traz o `later` (o pedido e a hora dele) para a tela dizer "desfaça antes o pedido de hoje, 14:32".
- **Atualiza sozinha** pelo evento `agent.activityChanged`, que o registro manda quando um pedido começa, quando o agente lê ou muda uma nota e quando algo é desfeito, também pela CLI.

## O filtro do guardrail (T9833, spec #9818)
O detector de segredos (`src/guardrail/detector.ts`, spec #9690) passa a valer no caminho até o agente (`src/guardrail/filter.ts`):
- **No acesso:** o `notes_read`, o `notes_outline`, o `notes_search` e o `meetings_get` entregam cada segredo, e cada dúvida (até a pergunta à pessoa, #8357), trocado por um marcador, `‹segredo 3 · k7q2›`.
  - O detector olha a nota inteira, e só depois o texto é cortado. Os tamanhos e os offsets são os do texto que o agente vê, e o corte nunca parte um marcador.
  - A busca monta o trecho do texto filtrado e não devolve um achado cujas palavras só aparecem dentro de um segredo.
- **No pedido:** o texto da pessoa passa pelo mesmo filtro antes de ir ao agente, e é ele, filtrado, que o registro guarda.
- **O marcador** leva o código da sessão (`SecretGuard`, um por vida do serviço) e um número que não se repete nela. O mesmo segredo da mesma nota leva sempre o mesmo número.
- **A escrita** troca os marcadores pelo original antes de conferir e gravar, no texto e no nome da seção, e só na nota de onde eles saíram. Um marcador de outra nota, de um pedido, de outra sessão ou de antes de o app reabrir é recusado (`E_SECRET_MARKER`), e o agente lê de novo. Um texto que só parece marcador é texto.
- **A escrita que tira um segredo** (o agente trocou o trecho sem mandar o marcador de volta) vale. O registro anota `removedSecrets`, e a tela avisa; o [Desfazer] e as Versões trazem o segredo de volta.
- **O registro** guarda só contagens (`held` em cada leitura, `requestHeld` no pedido; contrato 1.47.0), e a Atividade diz "O Kiwi segurou 2 segredos em Projetos/Kiwi". O segredo só existe na memória do guard e na cópia de antes de cada escrita, que é do desfazer e nunca vai ao agente.
- Títulos, caminhos e participantes passam sem filtro, como decidido no spec.

## Plano B: abrir o Claude Code direto, sem o adaptador
Se o adaptador deixar de servir (uma versão que não roda com o Bun do app, um isolamento que não segura, ou o projeto parado), entra um segundo motor por trás da mesma interface `AgentHost`. Ele abre o `claude` instalado em modo de programa:
- `claude -p --input-format stream-json --output-format stream-json --verbose`;
- `--resume` para retomar a sessão;
- `--tools ""` e `--strict-mcp-config` para o isolamento.

A tela e as ferramentas não mudam, porque só falam com a interface. O custo é traduzir os eventos do `stream-json` nos mesmos `status`, `text` e `done`.

## O que só se prova com o Claude Code de verdade
Fica para a prova de verdade do harry (`bun run cli agent proof --real`, acima):
- **o formato real dos erros pelo adaptador.** O adaptador manda a falha detalhada (`rate_limited`, `auth_required`…) só para os clientes da JetBrains (a extensão AIR). Para os outros, o que chega é a mensagem. Os casos de limite, de rede e de login precisam ser vistos acontecendo;
- **o formato do `claude auth status`** no Claude Code instalado;
- **o isolamento de ponta a ponta:**
  - que o `settingSources: []` deixa de fora os hooks, as regras, o CLAUDE.md e os servidores MCP da pessoa;
  - que o `tools: []` desliga todas as ferramentas embutidas;
  - se a memória automática e os plugins também ficam de fora;
  - e o que o adaptador ainda tira do `~/.claude/settings.json` (o modo de permissão, o modelo e o `apiKeyHelper`), e se algo disso pede um `settings` próprio do Kiwi no `_meta`.

  A prova imprime as opções com que o Claude Code foi aberto e os comandos, os modelos e os agentes que a sessão recebeu;
- **a retomada** (`session/resume`) com o adaptador, entre uma abertura e outra.

## Consequências
- **A tela de Ajustes › Agente** usa o `AgentHost` e o `claudeStatus()`. Ela troca a recusa automática das permissões por uma pergunta à pessoa, quando houver ferramentas.
- **As ferramentas do Kiwi para o agente** (o índice, a busca, a leitura por seção) entram como um servidor MCP do próprio Kiwi, no `mcpServers` da sessão, sem mexer no isolamento (seção acima, T8956).
- **Outro agente que fala ACP** (o Gemini, o OpenCode) entra trocando só o programa que o host abre.
- **Atualizar a biblioteca do ACP:** trocar a versão fixa no `package.json` e rodar `bun scripts/third-party-notices.ts`. A 2.0 quebrou a API antiga, então uma versão nova pede rodar os testes do `src/agent/`.
