# ADR 0012: o host do agente

- Status: aceito (T8478, spec #4576, aprovado pelo harry em #8474).
- Segue o [ADR 0011](0011-agente-e-privacidade.md) (o que vai para o agente) e a escolha do harry pelo adaptador ACP (#8368).
- Código:
  - [`app/src/agent/host.ts`](../../app/src/agent/host.ts): abre o agente, fala ACP com ele e devolve os eventos;
  - [`app/src/agent/claude.ts`](../../app/src/agent/claude.ts): acha o Claude Code instalado e diz a versão e se ele está logado;
  - [`app/src/agent/errors.ts`](../../app/src/agent/errors.ts): os erros, com as mensagens que a pessoa lê;
  - [`app/src/agent/fake/`](../../app/src/agent/fake/): o agente falso, que fala ACP, e o `claude` falso;
  - [`app/scripts/cli-agent.ts`](../../app/scripts/cli-agent.ts): `bun run cli agent status` e `agent ask "…"`.

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
    - `tools: []`: nenhuma ferramenta embutida (o shell, a edição de arquivos e a web). Neste spec o agente só conversa.

  Um agente que não é o Claude Code ignora esse `_meta`.
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

## Plano B: abrir o Claude Code direto, sem o adaptador
Se o adaptador deixar de servir (uma versão que não roda com o Bun do app, um isolamento que não segura, ou o projeto parado), entra um segundo motor por trás da mesma interface `AgentHost`. Ele abre o `claude` instalado em modo de programa:
- `claude -p --input-format stream-json --output-format stream-json --verbose`;
- `--resume` para retomar a sessão;
- `--tools ""` e `--strict-mcp-config` para o isolamento.

A tela e as ferramentas não mudam, porque só falam com a interface. O custo é traduzir os eventos do `stream-json` nos mesmos `status`, `text` e `done`.

## O que só se prova com o Claude Code de verdade
Fica para o spec #8368, na prova que o harry roda no Mac dele:
- **o formato real dos erros pelo adaptador.** O adaptador manda a falha detalhada (`rate_limited`, `auth_required`…) só para os clientes da JetBrains (a extensão AIR). Para os outros, o que chega é a mensagem. Os casos de limite, de rede e de login precisam ser vistos acontecendo;
- **o formato do `claude auth status`** no Claude Code instalado;
- **o isolamento de ponta a ponta:**
  - que o `settingSources: []` deixa de fora os hooks, as regras, o CLAUDE.md e os servidores MCP da pessoa;
  - que o `tools: []` desliga todas as ferramentas embutidas;
  - e se a memória automática e os plugins também ficam de fora. A prova imprime as ferramentas e os servidores MCP da sessão;
- **a retomada** (`session/resume`) com o adaptador, entre uma abertura e outra.

## Consequências
- **A tela de Ajustes › Agente** usa o `AgentHost` e o `claudeStatus()`. Ela troca a recusa automática das permissões por uma pergunta à pessoa, quando houver ferramentas.
- **As ferramentas do Kiwi para o agente** (o índice, a busca, a leitura por seção) entram como um servidor MCP do próprio Kiwi, no `mcpServers` da sessão, sem mexer no isolamento.
- **Outro agente que fala ACP** (o Gemini, o OpenCode) entra trocando só o programa que o host abre.
- **Atualizar a biblioteca do ACP:** trocar a versão fixa no `package.json` e rodar `bun scripts/third-party-notices.ts`. A 2.0 quebrou a API antiga, então uma versão nova pede rodar os testes do `src/agent/`.
