# Os 14 repositórios do harry: o que serve ao Kiwi

Spec #12550, 2026-11-14. Cada repositório foi clonado e lido (o código e o README, não só a página). Os números das
tabelas vêm do GitHub no dia; as medidas do Graphify vêm do contador local do Kiwi (`app/src/agent/token-count.ts`).
As propostas de UI estão em [repos-harry/](repos-harry/): a folha de comparação e as telas de cada skill.

## A tabela

| Repositório | O que é de fato | Licença | Vivo? | Veredito |
|---|---|---|---|---|
| [unslop](#unslop) | skill de design: limpa UI com cara de IA | CC BY 4.0 | sim, 11/2026 | **usar**: o polimento, já |
| [impeccable](#impeccable) | skill de design com 24 comandos e um detector de slop | Apache-2.0 | sim, 14/11 | **testar**: a proposta dentro da nota e o `critique` |
| [hallmark](#hallmark) | skill de design para páginas novas, com temas sorteados | MIT | sim, 11/11 | **testar**: só a tipografia |
| [huashu-design](#huashu-design) | skill de design em chinês: protótipos, slides, vídeo | MIT | sim, 10/11 | **testar**: só na tela da nota |
| [ui-ux-pro-max](#ui-ux-pro-max) | busca em CSVs de estilos, cores e fontes | MIT | sim, 10/11 | **descartar** |
| [awesome-design-md](#awesome-design-md) | coleção de DESIGN.md tirados de sites de marcas | MIT | sim, 28/10 | **descartar os arquivos**, usar o formato |
| [anatomy](#anatomy) | skill de ilustração isométrica em SVG | MIT | sim, 18/10 | **descartar** para a UI; talvez uma figura do Sobre |
| [logo-design-skill](#logo-design-skill) | skill de logo com 1.400 logos de referência | MIT (os logos não) | sim, 13/11 | **descartar**; os testes de 16 px valem para o ícone |
| [Graphify](#graphify) | grafo do código por AST, consultado pelo agente | Apache-2.0 | sim, 12/11 | **descartar**: não economiza aqui (medido) |
| [mcp-for-blender](#mcp-for-blender) | servidor MCP que controla o Blender | MIT | sim, 13/11 | **descartar** |
| [motion](#motion) | biblioteca de animação para React | MIT | sim, 13/11 | **descartar** por ora |
| [lottie-web](#lottie-web) | player de animações do After Effects | MIT | parado desde 09/2025 | **descartar**: o Rive já faz isso |
| [three.quarks](#threequarks) | partículas para o three.js | MIT | fraco, 05/2026 | **descartar**: sem WebGPU |
| [postprocessing](#postprocessing) | pós-processamento para o three.js | Zlib | sim, 01/11 | **descartar**: só WebGL, prende o three < 0.188 |

Das 6 skills de UI, 4 valem um teste e 2 não. Nenhuma das bibliotecas entra no app. O Graphify não economiza tokens
nem no repo nem no cofre de notas: os números estão [abaixo](#graphify).

## As skills de UI

As 6 skills que são mesmo de UI ganharam uma proposta nas mesmas 3 telas (a nota aberta, Configurações › Aparência e o
balão do gato com uma proposta), no claro e no escuro. O gato fica como está em todas. A folha põe a UI de hoje e as 6
lado a lado:

- [folha no claro](repos-harry/folha-light.webp) · [folha no escuro](repos-harry/folha-dark.webp)
- as telas soltas: `repos-harry/telas/<skill>-<tela>-<tema>.webp` (`hoje` é o app de verdade)
- os protótipos: `repos-harry/prototipo/` (HTML e CSS, um arquivo por skill)

O que todas apontam na UI de hoje: o título que aparece duas vezes na nota (o do cabeçalho e o `# Migração` do texto),
a migalha e os metadados em mono, o callout com faixa lateral grossa e o glifo ✎ no lugar de um ícone, o
`Escuros · 29` com ponto no meio, e o balão com contorno grosso, quatro ações e aspas retas. São os tiques que unslop,
impeccable e hallmark proíbem pelo nome.

### unslop

[heydamir/unslop](https://github.com/heydamir/unslop) · 15,7 mil estrelas · criado em 29/10/2026 · CC BY 4.0 (o crédito
ao autor tem de ficar em cópias e adaptações).

- **O que é:** uma skill de 235 linhas com um roteiro de nove passes, na ordem (espaço, cor, ícones, texto, tipo, layout,
  detalhes, visuais, movimento), e uma régua honesta: antes de mexer, decidir se a tela tem muito slop, pouco ou nenhum.
  Com pouco, ela manda polir e manter a marca.
- **Aplicada ao Kiwi:** pouco slop, então polimento. Sai o título repetido, o mono dos metadados (fica só o número, em
  tabular), o ponto do meio, a faixa do callout e o ✎ (vira um ícone de linha); entram as aspas curvas e um balão fino
  com uma ação principal (Aplicar), uma secundária (Ver a proposta) e o Descartar em texto. Ela também pede para tirar a
  mola com overshoot do hover (`--hover-ease` com 1.32 no `tokens.css`).
- **Custo:** quase nada. CSS e textos, um spec pequeno. Nenhuma dependência.
- **Veredito: usar.** É o único que melhora o Kiwi sem trocar o que ele é. Não dá personalidade nova: não é esse o papel dele.

### impeccable

[pbakaus/impeccable](https://github.com/pbakaus/impeccable) · 109 mil estrelas · Apache-2.0 · commit de hoje.

- **O que é:** uma skill grande (24 comandos: `critique`, `audit`, `polish`, `bolder`, `quieter`…), um detector de 62
  regras sem LLM (binário em Rust) e um modo `live` que troca variantes no navegador. Separa a tela pelo que a pessoa faz
  nela: o Kiwi é Operate (a pessoa trabalha), e aí a regra é "conhecida antes de bonita", com um ponto que as outras não
  têm: "uma tela cinza com um acento é o padrão da categoria, não contenção". Ela pede uma paleta assumida na casca e
  um gesto de assinatura.
- **Aplicada ao Kiwi:** a casca na cor do kiwi, o chão levemente tingido, o verde só na ação e na seleção. A assinatura:
  a proposta do agente aparece **dentro da nota**, nas linhas onde vai entrar, tingida e com a marca na margem na cor do
  agente; o balão só confirma ("Aplicar as 2 mudanças"). É a melhor ideia de fluxo das seis.
- **Riscos:** o `live` roda o `codex` ou o `claude` com as permissões desligadas (`--dangerously-bypass-approvals-and-sandbox`,
  `bypassPermissions`) quando nenhum chat está ouvindo; se for usado, só com `IMPECCABLE_LIVE_COPY_AGENT=chat`. O
  instalador também põe um hook que roda o detector a cada edição de UI: mais tokens a cada turno do agente.
- **Custo:** médio a alto. A proposta dentro da nota são decorações no CodeMirror, e o verde tem de conviver com os 44 temas.
- **Veredito: testar.** A proposta dentro da nota merece um spec próprio. O `critique` e o `audit` lidos do repo (sem
  instalar) servem como revisão de telas.

### hallmark

[Nutlope/hallmark](https://github.com/Nutlope/hallmark) · 54 mil estrelas · MIT · "Powered by Together AI".

- **O que é:** uma skill para páginas novas (sites, landing pages) com 50 temas, um sorteio para duas páginas não saírem
  iguais e um piso de 16 regras que não se negociam. Para tela de app, um modo próprio: o tema empresta paleta, fontes,
  raio e superfície, nunca o layout. Ela mesma diz: "nunca use numa tela existente, a menos que a pessoa peça Hallmark".
- **Aplicada ao Kiwi:** o sorteio (`theme.mjs deal`, gênero "atmosférico" por causa da voz e do agente) deu Ribbon,
  Lumen e Refract; o Ribbon é o único marcado "serve para app". Papel quente, Instrument Sans leve nos títulos, Figtree no
  texto, linhas em fio no lugar de caixas, controles com luz de cima; o Tamanho do texto vira um fader de verdade. No
  escuro, azul-noite com âmbar.
- **Riscos:** o Ribbon foi feito para um app de som e sono: a calma é emprestada de outro produto. Os controles com
  volume fogem do macOS plano. O passo de "comp" usa a API da Together AI (imagem gerada na nuvem); para o Kiwi, só se
  for na mesa de design, nunca no app.
- **Custo:** médio. Duas fontes novas (~50 KB, OFL).
- **Veredito: testar a tipografia** (títulos leves e grandes, texto em Figtree), não o tema inteiro.

### huashu-design

[alchaincyf/huashu-design](https://github.com/alchaincyf/huashu-design) · 29 mil estrelas · MIT desde 05/2026 (antes era
só uso pessoal) · a skill é em chinês.

- **O que é:** um "estúdio" que faz protótipo, slides editáveis, vídeo e infográfico em HTML. Regra de ferro: **toda**
  tarefa nova mostra 3 direções antes de executar, sem exceção, e para até a pessoa escolher. Tem uma biblioteca de 84
  estilos com amostras, e um "livro de aparências" que guarda o que já foi entregue para não repetir.
- **Aplicada ao Kiwi:** a direção escolhida é a "Editorial Reader" (Matter, Readwise): serifa Literata no texto a 18 px,
  papel quente, ocre, marca-texto, rótulos pequenos e espaçados, e o balão vira a barra escura de ação dos leitores. As
  outras duas que ela mostraria: "Native Polish" (Things 3) e "Command Palette" (Raycast).
- **Riscos:** os rótulos espaçados são exatamente o que unslop, hallmark e impeccable proíbem. O portão de 3 direções
  multiplica as rodadas com o harry. Ela grava preferências em `~/.huashu-design/` e checa versão no GitHub a cada 30 dias.
- **Custo:** médio. Uma fonte de ~85 KB, e menos texto na tela para quem escreve e dita.
- **Veredito: testar só na leitura da nota** (um modo leitura com serifa), não no app todo.

### ui-ux-pro-max

[nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) · 149 mil estrelas · MIT.

- **O que é:** um `search.py` (Python puro, sem rede) que busca palavras em CSVs: 80 estilos, 192 paletas, 74 pares de
  fontes, 120 regras de UX. O "design system" é a soma do que bate com as palavras.
- **O teste:** "note-taking productivity desktop app voice dictation" devolveu vermelho de gravação (#DC2626) como cor
  principal, Plus Jakarta Sans e o padrão de landing page "Product Demo + Features" para uma tela de app. "notes app
  knowledge base macOS" devolveu outra coisa: cinza #475569, Atkinson e "FAQ/Documentation Landing". "note taking" no
  domínio de produtos: **nenhum resultado** ("closest known terms: banking, parking").
- **Aplicada ao Kiwi:** o primeiro resultado, como veio: vermelho em tudo, estilo suíço de bordas de 2 px. Lê como erro.
- **Veredito: descartar.** As estrelas não batem com o que ela faz. As 120 regras de UX (contraste, alvos de 44 px) são
  as mesmas que já seguimos.

### awesome-design-md

[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) · 127 mil estrelas · MIT.

- **O que é:** 84 arquivos DESIGN.md (o formato do Google Stitch) tirados dos **sites de marketing** de marcas (Notion,
  Linear, Raycast, Apple…). Alguns já viraram só um link para o site deles (`getdesign.md`).
- **Aplicada ao Kiwi:** o `notion/DESIGN.md`, o mais perto da categoria: neutros quentes, roxo #5645d4 no botão, abas em
  pílula, cartões pastel. O arquivo não tem modo escuro (é o site claro): o escuro do protótipo saiu do navy da marca.
- **Riscos:** o Kiwi passa a parecer o Notion; os tokens são de outra marca.
- **Veredito: descartar os arquivos e usar o formato.** Um `DESIGN.md` do próprio Kiwi (os tokens de `tokens.css`, os
  componentes, o que não se faz) seria lido por todo agente que mexe na UI. O `impeccable document` gera um a partir do código.

### anatomy

[wheresryan22/anatomy](https://github.com/wheresryan22/anatomy) · 27 mil estrelas · MIT.

- **O que é:** desenha figuras isométricas em SVG de máquinas que explicam uma ideia (um plotter, uma fechadura), com
  WebGL opcional. Não redesenha tela.
- **Onde caberia:** uma figura no Sobre ou no site, como "o ditado: o microfone, o Whisper local, a limpeza, a colagem"
  em forma de máquina. Uma figura média leva de 1 a 4 horas de agente.
- **Veredito: descartar para a UI.** Fica a ideia da figura do Sobre, se um dia houver um site.

## Os outros

### logo-design-skill

[kaankiziltug/logo-design-skill](https://github.com/kaankiziltug/logo-design-skill) · 6,8 mil estrelas · MIT para o
código. Os 1.400 logos de referência **não** são MIT: o `TRADEMARKS.md` diz que cada um é marca do dono.

- O que serve ao Kiwi, sem refazer o logo (fora do escopo): os testes em Python sem dependência, a folha de 16 px, uma
  cor, invertido, espelho e "prateleira" com concorrentes. Dá para conferir o ícone do app e o da barra de menus.
- **Veredito: descartar a skill.** Os testes de 16 px valem uma rodada no ícone da barra, se o harry quiser.

### Graphify

[Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify) · 147 mil estrelas · Apache-2.0 · pacote `graphifyy`.

- **O que é:** monta um grafo do código com tree-sitter (localmente, sem LLM), com comunidades e "nós deus", e dá ao
  agente `graphify query`, `path` e `explain` no lugar de grep e leitura. Num hook do Claude Code, ele intercepta
  Read/Grep e empurra para o grafo. Docs, PDFs e imagens só entram com um LLM (Gemini, Claude, OpenAI, Ollama…). A
  promessa de "80% menos tokens" é do produto pago (Graphify Cloud), não do README.
- **Cuidado:** sem `GRAPHIFY_BACKEND=none` ele **detecta o `claude` CLI** e rotula as comunidades com a assinatura de
  quem roda (Opus por padrão). Toda medida aqui foi com `none`. Ele também grava cada pergunta em
  `~/.cache/graphify-queries.log`.

**Como foi medido.** Graphify 0.9.108 num venv à parte, numa cópia do repo @ `19f1a9f` e no cofre de exemplo da bateria
de tokens (`app/test/tokens/vault.ts`), nunca nas notas do harry. O agente de verdade não foi ligado: a medida é o
contexto que o agente receberia, contado pelo contador local do Kiwi.

**No repo (o agente que programa o Kiwi).** Montar o grafo: 64 s, ~1 GB de RAM, 17.010 nós, 41.093 arestas, 20 MB de
`graph.json`. O `GRAPH_REPORT.md`, que o hook sugere ler, tem **23.510 tokens**.

| Pergunta | `grep -l` | `grep -n` | `graphify query` | `graphify explain` | Ler a resposta |
|---|---:|---:|---:|---:|---:|
| Onde se monta o começo fixo do pedido (`fixedPrefix`)? | 49 | 303 | 2.600 | 381 | 664 |
| Quem escreve o tema da Aparência no `<html>`? | 252 | 1.361 | 2.501 | n/a | 3.026 |
| Como o balão mostra uma proposta (`ProposalBubble`)? | 22 | 145 | 2.567 | 306 | 1.314 |
| O que a ferramenta `notes_read` devolve? | 349 | 3.349 | 2.620, **errou** | n/a | 32.744 |

- A busca no grafo custa mais que o grep em todas (cerca de 2.500 tokens de saída padrão, contra 22 a 349 do `grep -l`,
  que é o padrão do Grep do Claude Code). Na pergunta da proposta, dos 65 nós devolvidos, a maioria era ruído (um
  `montar.py` do gato e a instrução de animação, que só tinham palavras da pergunta).
- Ler o arquivo da resposta custa o mesmo nos dois caminhos: os dois dão arquivo e linha.
- O `notes_read` é o nome de uma ferramenta numa string, não um símbolo: o grafo não achou o `tools.ts`. O `path` entre
  o balão e o `AgentService` passou por imports (via `kiwicat-colors.ts`); o caminho real é `engine.invoke("…")`, com o
  nome da capacidade numa string, que o grafo não vê. O Kiwi é feito assim de ponta a ponta (a UI fala com o Bun por
  capacidades com nome).

**No cofre de exemplo (o agente do Kiwi).** Sem LLM, o Graphify só tira os títulos das notas: 25 nós, o mesmo que o
nosso `notes_outline` já devolve.

| Pedido | O Kiwi hoje | `graphify query` |
|---|---:|---:|
| Qual é o prazo da migração? | 207 (`notes_search` 106 + `notes_read` da seção 101) | 937, sem o texto da resposta |
| O que está pendente no PACS? | 101 (`notes_read` da seção) | 938, sem o texto |
| O que se falou do orçamento na reunião? | 2.327 (`meetings_get`) | 272, e ainda precisa do `meetings_get` |

Para ler o conteúdo das notas, o Graphify precisa de um LLM, e o ADR 0011 proíbe outro modelo de IA, nem local, no
lugar do agente.

**A resposta direta: não, ele não deixa usar o Opus gastando menos.** O custo de um pedido não está em achar o arquivo,
está no que fica fixo e no que se lê:

- **No Kiwi**, todo pedido ao agente carrega o começo fixo (4.240 tokens; 3.294 no econômico) e a **lista de
  ferramentas (9.311)**. A lista é o item mais pesado de todos, e é ali que um próximo spec economizaria de verdade:
  mandar só as ferramentas do assunto, ou descrições mais curtas.
- **No Claude Code do harry**, o que entra em todo turno é o `AGENTS.md` (2.402) e o índice de memória (2.896), que hoje
  tem linhas repetidas (o "Nada no Downloads" aparece três vezes, e as regras de uso duas). Enxugar o índice e ler
  arquivos grandes por trecho (o `tools.ts` tem 32.744 tokens) economiza mais do que qualquer grafo.
- **Veredito: descartar.**

### mcp-for-blender

[ahujasid/mcp-for-blender](https://github.com/ahujasid/mcp-for-blender) · 34 mil estrelas · MIT.

- Um servidor MCP e um add-on que deixam o agente criar e mexer em cenas 3D no Blender, inclusive rodando Python
  arbitrário (`execute_blender_code`, com um "modo seguro" opcional).
- **Manda telemetria por padrão** (ID de instalação, ferramenta usada, tempo, versão do SO), sem opt-in; desliga com
  `DISABLE_TELEMETRY`. O instalador é `curl … | sh`.
- O gato é um shader TSL com uma textura de referência: não sai do Blender.
- **Veredito: descartar.**

### motion

[motiondivision/motion](https://github.com/motiondivision/motion) · 35 mil estrelas · MIT · v14.14.0, ativo.

- Animação declarativa para React (layout, gestos, springs). Mais uma dependência no bundle das janelas.
- O Kiwi já tem duas springs em CSS (`linear()` no `tokens.css`) e o Reduzir movimento zera tudo no `base.css`.
  Onde ajudaria: animação de layout (uma linha que muda de lugar na árvore, a lista que reordena), que hoje não temos.
- **Veredito: descartar por ora**, e voltar a ele só se um spec pedir animação de layout.

### lottie-web

[airbnb/lottie-web](https://github.com/airbnb/lottie-web) · 32 mil estrelas · MIT.

- Toca animações exportadas do After Effects. Último push em 09/2025, último release em 05/2025, 862 issues abertas.
- O Kiwi já usa o Rive (`@rive-app/canvas-single` 2.45.0), que faz o mesmo com máquina de estados.
- **Veredito: descartar.**

### three.quarks

[Alchemist0823/three.quarks](https://github.com/Alchemist0823/three.quarks) · 1,2 mil estrelas · MIT · v0.17.1, de
05/2026.

- Sistema de partículas e VFX para o three.js (o Kiwi já tem o three 0.187).
- **Não tem WebGPU:** o suporte ao `WebGPURenderer` é uma proposta aberta (#114 e #115). A névoa do gato roda em WebGPU
  primeiro, e o desenho dela diz "não há partículas" (`ui/kiwicat/README.md`), por decisão.
- **Veredito: descartar.**

### postprocessing

[pmndrs/postprocessing](https://github.com/pmndrs/postprocessing) · 3 mil estrelas · Zlib · v6.39.6.

- Efeitos de pós (bloom, blur, ruído) para o three.js, mais rápidos que os do exemplo do three.
- Só `WebGLRenderer`, e o peer pede `three >= 0.168 < 0.188`: com o three 0.187 de hoje, ele **trava a próxima versão**.
  O three já faz pós em TSL para o WebGPU, que é o que a névoa usa.
- **Veredito: descartar.**

## O que eu proponho

Opções para o harry escolher; cada uma vira um spec.

1. **O polimento do unslop**: o título que não repete, os metadados sem mono, o callout sem faixa, o ícone no lugar
   do ✎, o `Escuros 29`, as aspas curvas, o balão fino com uma ação principal, a mola sem overshoot. Pequeno, e melhora
   todas as telas.
2. **A proposta dentro da nota** (impeccable): o agente mostra as linhas que vai mudar no lugar, marcadas na margem, e o
   balão só confirma. Médio a grande, porque mexe no editor.
3. **Um `DESIGN.md` do Kiwi** (o formato do awesome-design-md): os tokens, os componentes e as proibições num arquivo só,
   para todo agente que mexe na UI ler antes. Pequeno.
4. **Um teste de tipografia** (hallmark): títulos leves e grandes, texto em Figtree, num tema novo opcional, sem mudar o padrão.
5. **Cortar a lista de ferramentas do agente** (a medida do Graphify): os 9.311 tokens de todo pedido são o maior gasto
   fixo do Kiwi. Isso economiza de verdade, ao contrário do grafo.
