# Roadmap da mega-ideia: o agente e o Kiwi-cat

Versão 4, de 2026-11-13. É o roadmap do #7561 com as decisões que o harry tomou depois; a versão 4 tira a fase 6 (#11437). O harry liberou o início da mega-ideia no #8339. Os números com `#` são mensagens do canal `kiwinotes` no Kiwi Channels.

## O que é
O Kiwi Notes ganha um agente: a pessoa fala (ou digita) um pedido, e o agente de CLI que ela escolheu lê as notas e as reuniões, responde e organiza. O Kiwi-cat é a cara desse agente: o gato do ícone, animado, que mostra o que o agente está fazendo.

## Já decidido

### A ligação com o agente
- **O app abre o agente,** sem terminal e sem `join` (#4693, #7498).
- **Pelo ACP, com o adaptador do Claude Code baixado na primeira vez** que a pessoa liga o agente (#8368). O download só acontece com o clique dela, numa versão fixa e conferida. O adaptador usa o Claude Code que já está instalado no Mac, com o login dele.
- **Só o Claude Code** (#8364, #11437). Outros agentes (Codex, Gemini, OpenCode), o agente no Channels e o diagrama no BonsAI saíram do escopo de entrega.
- **Só o agente que a pessoa escolheu faz o trabalho de IA** (#7496, #7498). Nenhum outro modelo, nem local, lê ou resume no meio.
- **O Kiwi só dá ferramentas que não interpretam:** o índice, a busca, o sumário, a leitura por seção, a montagem de arquivos e o medidor.
- **A memória** é escrita pelo próprio agente, e a sessão é retomada (#7497).

### A regra da Anthropic sobre a assinatura (#8353, #8373)
- A Anthropic não permite que um app de terceiros ofereça o login do Claude nem guarde ou repasse as credenciais. Ela permite a pessoa usar a própria assinatura no Claude Code original, sem modificação.
- **Por isso:** o login é feito no próprio Claude Code. O Kiwi nunca pede, lê nem guarda senha ou token; ele só mostra se o agente está logado. O Kiwi não modifica o Claude Code nem leva uma cópia dele dentro do app.
- **Seguimos desenvolvendo para o uso do harry.** Antes de divulgar a função para outras pessoas, a Kiwi Init confirma com a Anthropic por escrito (#8373).
- **Um risco anotado:** a documentação do Claude Code avisa que o uso por programas pode passar a pedir uma chave paga por uso, em vez da assinatura. A ponte é desenhada para essa troca custar pouco.

### Como o agente trabalha
- **Ele escreve direto na nota, e a pessoa desfaz** (#8356). O snapshot antes de cada escrita e o [Desfazer] são obrigatórios desde a primeira versão que escreve.
- **O guardrail** só segura senha, token, credencial e dado pessoal sensível. IP, VPN e CSV passam (#4717). **Na dúvida, ele pergunta à pessoa, mostrando o trecho** (#8357).
- **Depois de uma reunião gravada,** o agente prepara sozinho uma proposta (o resumo e o que entra na nota do projeto), e a pessoa aprova (#8360). Gasta um pedido do plano a cada reunião.
- **A reunião:** o Kiwi sugere gravar e nunca grava sozinho. O mic nunca fica aberto (#4756).

### Falar com o agente
- **O atalho é o Control** (#7545), com o mesmo motor do Fn do ditado:
  - **segurar:** o agente ouve enquanto a pessoa segura; soltar manda o pedido;
  - **dois toques:** fixa a escuta; mais um toque finaliza e manda;
  - **Esc** cancela, sem mandar nada.
- **Três cuidados do atalho:**
  1. Só vale o Control sozinho. Com outra tecla ou um clique junto, o Kiwi ignora, e o atalho normal funciona.
  2. Se o Ditado da Apple usar "duas batidas no Control", o Kiwi avisa em Ajustes.
  3. O Fn e o Control nunca gravam juntos: quem começou primeiro fica com o mic.
- **Também por texto:** clicar no gato e digitar, para quando não dá para falar (#8362).
- **Ele responde por balões** (#7486).

### O Kiwi-cat
- **Um gato só para todos os agentes.** Só a cor da névoa muda (#4655, #4659).
- **A cor da névoa por agente,** escolhida pela pessoa (#7709): a original do Kiwi, a padrão daquele agente ou uma personalizada.
- **Onde ele aparece:** no app, no canto inferior direito das abas Notas, Ditado e Reuniões, em repouso. Fora do app, no overlay, no centro da tela, sem repouso. Os status ficam em inglês (thinking, running bash…). O agente trabalha em background, e a pessoa pode trocar de aba.
- **100% em código, sem Rive** (#7583, #7588): three.js dentro do WebKit, um módulo só (`app/ui/kiwicat/`) para o app e o overlay. A névoa é um shader de ruído iluminado por trás; não é fumaça nem blur (#7549).
- **O design e os estados são do agente Codex** (#7467), com a instrução em `docs/brand/kiwi-cat/estados/INSTRUCAO.md`.
- **A prancha dos 8 estados está aprovada** (#8276) e fica em `docs/brand/kiwi-cat/estados/`: `repouso`, `dormindo`, `acordou`, `ouvindo`, `thinking`, `agindo`, `pronto` e `erro`, cada um com os olhos e o símbolo de quadrinho dele.
- **As orelhas largas** (#7718), com alvo de até 25 graus, são critério da entrega do gato em código: nas imagens do ícone elas só giram 5 graus sem defeito.

## As fases
Cada linha é 1 spec, 1 issue e 1 PR. Andam 1 ou 2 por vez.

### Fase 0. Preparação
1. **A regra de privacidade com o agente** (spec #7498, ADR 0011): tudo é local, menos o agente que a pessoa escolher.
2. **O que o Channels já resolve:** pesquisado em 2026-11-12. O Channels nunca abre o agente (a pessoa abre no terminal), então a ponte é do Kiwi Notes. Aproveita-se só o desenho, sem copiar código (a licença dele é AGPL): o status do agente em três estados, as perguntas com botões, o resumo de memória entre sessões e a detecção de segredo.
3. **O roteiro de movimento do Kiwi-cat** (spec #7718), depois da prancha aprovada.

### Fase 1. A ponte (o agente funcionando, com segurança)
4. **Ajustes › Agente e o host do agente:** acha o Claude Code, mostra se está logado, a pessoa liga e testa. O download do adaptador com um clique. Um pedido por vez, com cancelar. Erros claros: não instalado, não logado, limite atingido e sem rede. Um **agente falso** para os testes, sem gastar a assinatura de ninguém. A cor da névoa por agente. A tela "o que vai para o agente", com o texto do ADR 0011.
5. **As ferramentas do Kiwi para o agente (MCP):** `notes.search`, `outline`, `read` por seção, `write`, `meetings.get` e `project.status`.
6. **Snapshot e desfazer,** e a lista "Atividade do agente": cada pedido, o que mudou, [Ver] e [Desfazer].
7. **O guardrail,** nas três camadas. O agente não lê o cofre por fora: as ferramentas próprias dele ficam presas a uma pasta de trabalho.
8. **Projetos:** o que é um projeto para o Kiwi (a pasta e a nota principal). É a base do `project.status`, do fluxo de reunião e do resumo executivo.

### Fase 2. Falar com o agente
9. **O atalho Control.**
10. **A névoa do Kiwi-cat:** o shader, com a cor, a voz e o estado.
11. **O gato em código:** as camadas, os olhos, as orelhas largas, os símbolos e a máquina de estados.
12. **O gato no app:** o canto inferior direito das três abas, e um liga/desliga em Ajustes.
13. **O gato no overlay:** o centro da tela, em qualquer app, entrando e saindo com animação. Depende de três correções de janela no Electrobun Livewire, feitas num clone local e propostas por PR, que só a jow ou o agente dela aprova e faz o merge (#7590).
14. **Os balões.**
15. **Falar por texto.**

### Fase 3. Memória e economia de tokens
16. **O Estado do projeto e o diário do agente.** O arquivo "O que o agente sabe sobre mim", as instruções fixas do agente e o dicionário do ditado virando o glossário dele.
17. **O agente econômico:** o medidor das 5 h e da semana, o modo econômico e o prompt fixo para o cache.
18. **A bateria de tokens.**

### Fase 4. As notas se organizam
19. **O Modelo de nota** (#7463).
20. **Reunião → projeto** (#7480), com a proposta automática depois da reunião (#8360).
21. **O resumo executivo num formato fixo.**
22. **Arquivos** (#4587): o agente lê e analisa csv, xlsx, docx e pdf, e o Kiwi gera txt, pdf, xlsx e docx com os dados dele.
23. **Referências** (#4587): o agente pesquisa a documentação e põe os links na nota do projeto. É uma permissão a mais.

### Fase 5. A primeira impressão
24. **O onboarding v1** (#7476).
25. **As rotinas** (v2): o resumo do dia e os pendentes da segunda. Nada roda sem estar ligado.

**Fica para depois do v1:** a edição ao vivo, com o texto entrando animado na nota aberta.

## Em todo spec
- **Um roteiro curto de teste só do harry,** porque o mic e o agente de verdade só ele testa.
- **Os testes dos agentes usam o agente falso.**
- **Um orçamento de desempenho para o gato:** parado, CPU perto de zero; ele para de desenhar com a janela escondida e com o Reduzir movimento.
