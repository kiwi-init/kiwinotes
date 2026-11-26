# ADR 0011: o agente e a privacidade

- Status: aceito (T8371, spec #7498, aprovado pelo harry em #8367). Emendado pelo spec #31616 (T31627): o provedor de voz que a pessoa liga, com a chave dela no Keychain (harry #31007, #31616).
- Substitui a exceção do Claude Code no AGENTS.md (decisão #34).
- Decisões do harry que entram aqui: #7496 e #7498 (só o agente escolhido faz o trabalho de IA), #4717 (o que o guardrail segura), #8357 (o guardrail na dúvida), #8360 (a proposta depois da reunião), #8368 (o adaptador ACP), #8373 (a regra da Anthropic) e #31007/#31616 (a voz do Kiwi por um provedor que a pessoa liga).
- Código: nenhum ainda. A ligação com o agente e a tela abaixo são do spec de Ajustes › Agente (Fase 1 do roadmap, no commit `2d5493a2` do repo antigo).

## Contexto
Até hoje, nada do Kiwi Notes sai do Mac: o ditado, as reuniões e as notas ficam no computador da pessoa. A mega-ideia traz um agente de IA: a pessoa pede algo por voz ou por texto, e o agente lê as notas e as reuniões, responde e organiza. Esse agente roda na nuvem. Para o harry, é o Claude Code com a assinatura dele; outra pessoa pode escolher outro agente.

Então a frase "nada sai do Mac" deixa de ser exata. Antes de qualquer código, esta decisão diz o que vai para o agente, o que nunca vai e quem envia.

## A regra
**Tudo é local, menos o agente que você escolher.**

## O que vai para o agente
Só com o agente ligado, e só nestes dois momentos:
- **quando você faz um pedido a ele.** Vai o texto do pedido: a sua fala vira texto no Mac, como no ditado, e o áudio nunca vai. Vão também os trechos de notas, de reuniões e de arquivos que o agente lê, pelas ferramentas do Kiwi, para atender aquele pedido, e o que o Kiwi achou nas suas notas sobre o pedido: a nota que o pedido cita, com o texto, ou os cartões das parecidas, pelo mesmo filtro de segredos (ADR 0013, decisão 1, #13624);
- **quando termina uma reunião que você gravou.** Vai a transcrição dela, para o agente preparar a proposta (o resumo e o que entra na nota do projeto), que você aprova ou não (#8360). Dá para desligar só essa proposta depois das reuniões em Ajustes › Agente, sem desligar o agente: uma reunião pode ser sensível. O interruptor é do spec da tela.

## O que nunca vai
- **O áudio** do ditado e das reuniões.
- **Nada enquanto o agente está desligado.**
- **O que o guardrail segura:** senha, token, credencial e dado pessoal sensível (#4717). IP, VPN e CSV de trabalho passam. Quando o Kiwi fica em dúvida se um trecho é sensível, ele pergunta a você, mostrando o trecho (#8357); até essa pergunta existir, o trecho em dúvida é segurado (spec #9818). O filtro troca cada segredo por um marcador antes de o texto sair, e a tela diz que nenhum detector pega 100%.
- **Telemetria.** O Kiwi não tem servidor e não coleta nada.

## Quem envia
- **O Kiwi abre o programa do agente** (para o harry, o Claude Code) e conversa com ele dentro do Mac. Quem fala com a nuvem é esse programa, com a conta da própria pessoa, e vale a política de dados daquele agente.
- **Para o Claude Code, a conversa passa por um adaptador ACP** (#8368). O Kiwi baixa esse adaptador da internet na primeira vez que a pessoa liga o agente:
  - só com o clique dela;
  - numa versão fixa e conferida;
  - é só um download: nada da pessoa vai junto.

  O download leva só o adaptador, sem a cópia do Claude Code que vem junto dele no pacote, e o Kiwi aponta o adaptador para o Claude Code que já está instalado no Mac, com o login dele (#8403).
- **Só o agente escolhido faz o trabalho de IA:** ler, resumir, organizar e decidir (#7496, #7498). Nenhum outro modelo, nem um local, lê ou resume no meio do caminho. As ferramentas do Kiwi (o índice, a busca, o sumário, a leitura por seção, a montagem de arquivos e o medidor) não interpretam nada.

## O login é do agente, não do Kiwi
- **A pessoa entra na conta dela no próprio programa do agente.** O Kiwi nunca pede, lê nem guarda a senha ou o token: ele só mostra se o agente está logado.
- **O Kiwi usa o programa do agente como ele foi instalado,** sem modificar e sem levar uma cópia dentro do app.
- **É a regra da Anthropic para a assinatura** (#8353): um app de terceiros não pode oferecer o login do Claude nem guardar ou repassar as credenciais da pessoa. A pessoa pode usar a própria assinatura no Claude Code original, sem modificação.

## O agente vem desligado
- A pessoa liga em **Ajustes › Agente**. Desligado, o Kiwi não abre o agente, não baixa o adaptador e não manda nada.
- Na primeira vez que a pessoa liga, uma tela diz o que vai e para quem. O texto está abaixo. A tela em si é do spec de Ajustes › Agente.

### O texto da tela "o que vai para o agente"
`{agente}` é o nome do agente escolhido (por exemplo, Claude Code), e `{empresa}` é quem faz o agente (por exemplo, Anthropic). A linha do adaptador só aparece para um agente que precise dele.

> **Antes de ligar o {agente}**
>
> **O que vai para o {agente}**
> - O que você pedir a ele. A sua voz vira texto aqui no Mac, e o áudio não vai.
> - Os trechos das suas notas, reuniões e arquivos que ele ler para atender o pedido, e o que o Kiwi Notes achou nas suas notas sobre o pedido.
> - A transcrição de uma reunião que você gravou, quando ela termina, para ele preparar o resumo. Você aprova antes de entrar na nota, e pode desligar só isso em Ajustes › Agente.
>
> **O que nunca vai**
> - O áudio do ditado e das reuniões.
> - Nada enquanto ele estiver desligado.
> - Senhas, tokens, credenciais e dados pessoais sensíveis: o Kiwi Notes troca cada um por um marcador antes de o texto sair, e na dúvida também segura. Nenhum detector pega 100%.
>
> **Quem envia**
>
> O Kiwi Notes conversa com o {agente} aqui no seu Mac. Quem manda para a nuvem é o {agente}, com a sua conta, e vale a política de dados da {empresa}. O Kiwi Notes não tem servidor e nunca vê a sua senha.
>
> Para conversar com o {agente}, o Kiwi Notes baixa um adaptador agora. Nada seu vai junto.
>
> Você desliga quando quiser, em Ajustes › Agente.
>
> [Ligar o {agente}] [Agora não]

## A voz do Kiwi por um provedor que a pessoa liga (emenda, spec #31616)
O Kiwi fala com a voz local (ADR 0014). Ligada pela pessoa, a fala pode sair por um **provedor de voz na nuvem**; hoje, só o ElevenLabs. É um extra: o Kiwi Notes não vende nem embute o serviço (#31613), e cada pessoa usa a própria conta.

- **Vem desligado.** Sem ligar em Ajustes › Agente › Voz, nada vai ao provedor, e o Kiwi fala com a voz local.
- **O que vai:** só o texto que o Kiwi vai falar, frase por frase, e a voz e o modelo que a pessoa escolheu. Antes de sair, o texto passa pelo mesmo filtro de segredos do agente, e o que ele segura não vai, nem como marcador.
- **O que nunca vai:** o áudio do microfone, as notas, as reuniões e o resto do que o agente leu: o provedor de voz recebe só a fala.
- **A chave é da pessoa, e fica no Keychain do macOS.** Aqui o Kiwi guarda uma credencial, diferente do agente: a pessoa cola a chave da API dela, e ela vai direto para o Keychain (`com.kiwinotes.elevenlabs`). Nunca vai para arquivo, log, settings.json nem para a tela: a tela só sabe se há uma chave. O Kiwi a lê na hora de falar e a manda só ao provedor, no cabeçalho da chamada. A pessoa apaga quando quiser.
- **Nada guardado do nosso lado:** sem cache do áudio em disco e sem o texto no log, que só registra eventos e tempos. Do lado do provedor, vale a política de dados dele: a tela diz isso com um aviso curto.
- **Se falhar** (sem chave, chave errada, sem crédito, sem rede, voz indisponível), o Kiwi fala com a voz local daquela vez.
- **Um provedor novo** segue a mesma regra: desligado por padrão, só a fala, a chave da pessoa no Keychain, o filtro antes de sair.

## Consequências
- **O AGENTS.md usa a regra nova** na seção de Privacidade, no lugar da exceção do Claude Code. A lista do que o app baixa ganha o adaptador ACP.
- **Os testes usam um agente falso.** Nenhum agente do time liga o agente de verdade nem usa a assinatura do harry. O agente de verdade, só o harry testa, e quem pede é o lead.
- **O "100% local" dos Ajustes e os textos do Sobre continuam verdadeiros** enquanto o agente não existe no app. Eles mudam no spec de Ajustes › Agente, junto com a tela acima.
- **Antes de divulgar a função para outras pessoas,** a Kiwi Init confirma com a Anthropic por escrito (#8373). Até lá, ela é para o uso do harry.
- **Um agente novo** (Codex, Gemini, OpenCode) segue a mesma regra: o login é dele, e a tela mostra o nome e a empresa dele.
- **Um risco anotado:** a documentação do Claude Code avisa que o uso por programas pode passar a pedir uma chave paga por uso, em vez da assinatura. Se isso acontecer, a regra continua: a chave fica no programa do agente, e o Kiwi não a guarda.
- **Com a emenda do spec #31616,** "tudo é local" ganha uma segunda exceção, que a pessoa também liga: o provedor de voz. O AGENTS.md diz isso na seção de Privacidade. Os textos de "100% local" dos Ajustes e do Sobre continuam verdadeiros com o provedor desligado; ligado, a tela de Ajustes › Agente › Voz mostra o aviso.
- **Os testes do provedor usam um servidor falso e um Keychain falso.** Nenhum agente usa a chave do harry; o teste real é dele, pedido pelo lead.
