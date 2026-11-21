# ADR 0006: as janelas são UIs do AppEngine, em modo host

- Status: aceito (T1192, decisão do @harry em #1191).
- Código:
  - [`app/src/shared/ui-contract.ts`](../../app/src/shared/ui-contract.ts): o contrato;
  - [`app/src/bun/ui-capabilities.ts`](../../app/src/bun/ui-capabilities.ts): os handlers;
  - [`app/src/bun/ui-engine.ts`](../../app/src/bun/ui-engine.ts): o engine, o canal e a UI de fábrica, com `bun test`;
  - [`app/src/bun/windows.ts`](../../app/src/bun/windows.ts): as janelas;
  - [`app/src/bun/ui-keys.ts`](../../app/src/bun/ui-keys.ts): as chaves públicas;
  - `app/scripts/ui-build.ts`, `ui-publish.ts` e `ui-serve.ts`.

## Contexto
O AppEngine do `kiwi-init/electrobun-livewire` (2026.10.2, `electrobun/bun/appengine`) separa o app em duas partes:
- o **engine**: o binário nativo, com o Bun, o helper e as capacidades, fixo e assinado;
- a **UI**: um pacote (`uipack`) assinado com Ed25519, que só fala com o main por capacidades com nome e atualiza sem trocar o engine.

O engine sobe a UI boa mais nova, troca quando chega uma nova e volta atrás se ela falhar. O @harry escolheu o AppEngine como o padrão de UI da Kiwi Init (#1191).

## Decisão
**Um AppEngine por janela, no modo host.** Configurações e Histórico são uma UI cada; a janela Notas, quando nascer, entra igual.
- **Por janela:** o engine tem um ciclo de boot por view (`ready()`, prova, rollback), e o Kiwi Notes é um app de barra de menu, que abre janelas sob demanda. O engine de uma janela sobe quando ela abre e para quando ela fecha. O estado (`engine.json`, `channel.json`), os packs e a pasta servida ficam em `<dados>/appengine/<janela>/`.
- **Modo host:** a janela é nossa (`BrowserWindow`), com o `viewsRoot` em `<dados>/appengine/<janela>/served`. **Nunca dentro do .app**, para não quebrar a assinatura, nem a ad hoc nem uma Developer ID (T1074). O `show` do engine faz `loadHTML(index)`, servido como `views://internal/index.html`, e os assets vêm de `served/internal/`.
- **O que é servido:** o engine reescreve `served/internal/` a partir do pack **verificado** (`verifyManifest` + `readVerifiedPack`) antes de cada boot. Fora a UI de fábrica, que vem do bundle assinado, nada é servido sem passar por essa verificação (#1199).
- **A UI de fábrica (`BuiltInUi`)** é o `dist/<janela>/` que o `scripts/ui-build.ts` faz: um `vite build` por janela, com o `index.html` na raiz e os assets ao lado, mais o `ui.json` (`uiVersion`, `requiresContract`, `dataSchema` e `seq`, que é a hora do build). O Electrobun copia isso para `views/ui/<janela>/`. Ela é o fallback quando nenhuma UI instalada funciona.
- **A ponte:** o `preload` da janela leva o contrato e o `window.engine` do devkit (`appEnginePageScript`, o mesmo que o engine injeta no modo padrão). A UI não empacota nada de Electrobun. O RPC da janela é o `AppEngineRPC`: `invoke`, `ready`, `bootError`, `runtimeError` e o evento `event`.

## O contrato 1.0.0
Só estes nomes. Qualquer outro, inclusive os herdados (`constructor`, `toString`), dá `E_NO_CAPABILITY`. Argumento ruim dá `E_BAD_ARGS`.

| capacidade | argumentos | o que faz |
|---|---|---|
| `dictionary.get` | — | o dicionário |
| `dictionary.set` | `{terms}` | salva (limpo pelo `sanitizeTerms`) e avisa o ditado |
| `dictionary.check` | `{terms}` | os avisos de alias (#434) |
| `snippets.get` / `snippets.set` | — / `{snippets}` | idem para os snippets |
| `history.search` | `{query?, limit? (1–500), before?}` | uma página do histórico |
| `history.delete` | `{id}` | apaga um ditado |
| `clipboard.write` | `{text}` (até 100 mil caracteres) | copia: **só num gesto da pessoa** |

E o evento `history.added`, que o engine manda ao Histórico aberto a cada ditado novo.

**1.1.0 (T1316):** as notas, só acréscimos. São `notes.list`, `notes.get`, `notes.save` (com `baseVersion`: se a nota mudou fora, devolve a de agora em vez de escrever), `notes.create`, `notes.rename` (atualiza os `[[links]]`), `notes.delete` (para a Lixeira), `notes.search`, `notes.backlinks` e `notes.resolve`, mais o evento `notes.changed`. Tudo fica restrito ao vault (ADR 0007): fora dele dá `E_OUTSIDE_VAULT`.

**1.2.0 (T1320):** o ditado vira nota, só acréscimo. `history.toNote { id, path? }` manda um ditado do Histórico para o fim da nota `path` ou, sem `path`, para uma nota nova em `Caixa de entrada/`. Mandar de novo não duplica (`already`).

**1.3.0 (T1499):** `settings.get` e `settings.set`, com o atalho da janela Notas. Só acréscimo.

**1.4.0 (T2121):** o hub, a janela principal (#2100): `hub.section` (a seção pedida antes de o hub abrir) e o evento `hub.navigate` (com ele aberto). Só acréscimo.

**1.5.0 (T2308):** a janela `intro`, a animação da abertura do zero (#2078), e o `intro.done`, que ela chama no fim, no clique para pular ou com "Reduzir movimento". O main fecha a janela e abre o hub (`src/bun/intro.ts`); sem o aviso, o hub abre em 20 s mesmo assim. Só acréscimo.
- **A janela:** sem barra nem fundo (`titleBarStyle: "hidden"`, `transparent`), no meio da tela principal. O palco é o ícone, de cantos arredondados.
- **O script** é um arquivo do pack (`ui/intro/intro.js`), porque a `VIEWS_CSP` não deixa script inline. Os dois saem do `docs/design/brand/intro/gerar.ts`, que também faz o protótipo. (Desde a T14851, a intro é a do KiwiCat: o script é o `ui/intro/main.ts`, e o prisma está no `docs/arquivo.md`.)

**1.6.0 (T2386):** a seção Sobre do hub (spec #2370). `app.about` dá a versão (a do tag), o canal (`rc`, `stable`, `dev`), o link das notas da versão e as atualizações agora; `updates.check` checa na hora e `updates.apply` é o "Atualizar e reiniciar", os dois pelo Updater do ADR 0008; o evento `updates.status` leva cada mudança ao hub aberto. Sem o Updater (o headless, os testes) e com ele desligado, `updates.*` responde `off` com o motivo e não vai à rede. Só acréscimo.

- **Não há capacidade genérica**: nada de rodar comando nem de ler um arquivo qualquer.
- **O `clipboard.write`:** o main não vê o clique. Então a UI só chama com `navigator.userActivation.isActive`, e o main limita o tamanho e o ritmo (uma cópia a cada 300 ms, senão `E_RATE`).
- **As versões:** tirar ou mudar uma capacidade é versão major; acrescentar é minor, e a UI testa com `engine.has(cap)`. Uma UI cujo `requiresContract` o engine não satisfaz é recusada antes do download.

## Chaves
- **A pública** fica em `ui-keys.ts` (`trustedKeys`).
- **A privada** nunca entra no git nem na sala. Em dev ela fica em `~/.config/kiwinotes/ui-signing/<keyId>.private.pem` (0600), no Mac de quem publica; hoje, o do @harry, onde os agentes rodam.
- **Para trocar a chave:** gere outra, ponha a pública ao lado da antiga, publique com a nova e só então tire a antiga.

## Canal
- **O canal remoto** é o release fixo `ui-channel` do GitHub, e mais nada (decisão do @harry, spec #25011, que muda o #1193). Cada janela tem um `<janela>.manifest.json` em `https://github.com/kiwi-init/kiwinotes/releases/download/ui-channel/`, e o pack fica no mesmo release; quem publica é o job `ui-publish` (T25030).
- **O que vai à rede:** um GET do manifesto ao abrir uma janela e, com ela aberta, a cada 6 h (`UI_CHANNEL_POLL_MS`), e o GET do pack quando há um novo. Só baixa: sem query, sem cabeçalho além dos padrões, nada da pessoa (spec #25011, harry #25014).
- **O fetch guardado** (`ui-channel-fetch.ts`, T25029) é o único caminho do canal remoto à rede: só URLs do release `ui-channel`, e o redirect só para o armazenamento de arquivos do GitHub. Sem ele, o canal remoto fica desligado (`channelSource`).
- **Desliga junto com as atualizações.** O canal segue o Updater (ADR 0008): com ele desligado (`updatesOff`: `KIWI_DEBUG=1`, um build fora dos canais de release, sem o endereço das atualizações), o fetch do canal recusa tudo e nenhum pedido sai. Os testes e o headless ficam sempre assim.
- **Em dev,** `KIWI_UI_CHANNEL=http://127.0.0.1:5179` liga um canal **local**, que vem antes do remoto. O app só aceita `127.0.0.1` ou `localhost`, porque o bundle do AppEngine tem que vir por http(s); um valor errado deixa o canal desligado. Os passos: `bun run ui:build`, depois `bun run ui:publish settings [--ui-version …]`, depois `bun run ui:serve`.
- **O HMR do Vite** (a janela carregando do `localhost:5178`) só existe no canal `dev` do Electrobun, com o mesmo contrato, mas sem boot nem rollback. No stable, nunca (#1199, `devServerAllowed`).

## Rollback
É o do AppEngine:
- uma UI nova tem 5 s para chamar `engine.ready()`, o que o kit faz depois do primeiro commit do React;
- depois de pronta, passa 30 s em prova;
- um erro antes do `ready()` bane a UI na hora. Um prazo perdido, ou um renderer que caiu, conta como falha do ambiente: na segunda vez, ela é banida;
- a janela volta para a UI boa anterior ou para a de fábrica;
- uma UI com `seq` que não é mais novo que o da de fábrica nunca sobe.

## TCC
Uma UI nova não muda o engine (o binário e a assinatura). **Então trocar de UI não zera as permissões.** Só um build novo do engine faz isso enquanto a assinatura for ad hoc (T1074).

## Publicação no canal remoto (spec #25011, T25030)
- **Onde:** o release `ui-channel` do repo, num nível só (asset de release não tem pasta): `<janela>.manifest.json`, assinado, e os `<uiVersion>-<sha12>.uipack`, com o `bundleUrl` absoluto no mesmo release.
- **Quem publica:** o workflow `ui-publish.yml`, por um tag `ui-ANO.MÊS.N`, com o `app/scripts/ui-channel-publish.ts`. Quem solta é o releaser, com a mesma regra de ok do release.
- **A chave:** uma só do canal, `c68953676add986c`, gerada direto no segredo do repo `UI_SIGNING_KEY` (harry #25117), sem passar por nenhum Mac nem pela tela. Só o job `sign` a lê, e ele não roda `bun install` nem código do job `build`: o código vem do próprio checkout, o devkit do core fixado, e o `dist/` do `build` entra só como o que se assina (T25152). O script recusa uma chave que o app publicado não confia (o `ui-keys.ts` do último `v*`), então a primeira publicação espera um release com ela.
- **O `uiVersion`:** é a versão do app mais a hora do commit da UI (`2026.11.9-ui.20261121120000`). O `seq` é a hora da publicação, então fica acima do da UI de fábrica do app publicado.
- **O que barra, antes de publicar:**
  - um commit que não contém o último release `v*`, porque a tela voltaria para trás;
  - um contrato mais novo que o do app publicado: essa UI só chega com release. O pack leva `requiresContract: ^<contrato do commit>`, e um app mais velho recusa antes do download;
  - um commit que não é mais novo que o da UI no canal.
- **A ordem:** os packs sobem antes dos manifestos. Depois saem os packs que nem o manifesto novo nem o anterior apontam.
- **O ensaio:** "Run workflow" com o ensaio ligado assina com uma chave descartável e publica no `ui-channel-rehearsal`, que nenhum app lê.

## A UI baixada e a rede (T25029, spec #25011)
- **O canal só fala com o release `ui-channel`.** O `uiChannelFetch` (`app/src/bun/ui-channel-fetch.ts`) é a trava por cima do AppEngine, que seguiria qualquer `bundleUrl` http(s) do manifesto assinado.
  - Só `https://github.com/kiwi-init/kiwinotes/releases/download/ui-channel/…`, sem query.
  - O redirect só vai para o armazenamento de arquivos do GitHub.
  - Um GET sem corpo, sem cookie, sem referrer e sem cabeçalho além do `accept`: nada da pessoa vai junto.
- **A UI baixada não vai à rede:** a `VIEWS_CSP` barra fetch, XHR, beacon, EventSource, imagem, CSS, fonte, iframe, script, prefetch e form para fora. O `scripts/ui-pack-network.test.ts` prova isso no WebKit, com o controle sem a CSP.
- **Nenhuma capacidade vai à rede fora da lista.** O `src/bun/ui-capabilities-network.test.ts` lê o handler de cada capacidade do contrato e prende numa lista fixa as que chegam a uma porta para a rede, com o motivo, o que levam e por qual porta. As portas são o `fetch`, o Updater, a imagem de fora, os modelos baixados (busca pelo sentido e ditado preciso), os métodos do agente que abrem o programa ou baixam o adaptador, e o fim da reunião, que leva a nota ao agente quando ele está ligado e em "propor sozinho" (o `meetingReady`, por um evento do main). Hoje a lista tem `updates.*`, `images.remote`, `notes.semanticStatus`, `settings.set`, `meetings.stop` e seis do `agent.*`. Uma capacidade nova que vá à rede quebra o teste até entrar na lista.
- **Riscos conhecidos.** Os dois ficam porque só sobe pack assinado pela nossa chave:
  - **Qualquer porta do `127.0.0.1`.** O `connect-src ws://127.0.0.1:*`, que é a ponte do RPC (#1419), também deixa fetch, XHR, beacon e EventSource irem a qualquer porta local: pela CSP 3, um `ws:` casa com `http:`. Não é a rede, mas um serviço local da pessoa responderia. Fechar pede a porta da ponte exposta no main, um PR na engine, depois do #25011. O teste prende o resto: imagem, CSS, fonte, iframe, script e form não chegam nem ao 127.0.0.1.
  - **O `window.open`.** O `newWindow: "external"` abre no navegador padrão a URL que a UI pedir. A lista fixa de URLs vem no T25095.
