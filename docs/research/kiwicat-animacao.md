# Como o harry dirige a animação e o design do Kiwi-cat (T3065, spec #3058)

Pesquisa feita em 4 de novembro de 2026. **Decisão: Rive** (o harry escolheu no #3138; o spec é o #3133).

## O problema
Hoje cada ajuste é uma troca de texto. O harry descreve ("a orelha entra cedo demais"), o agente chuta um número no CSS,
renderiza e volta para perguntar. Isso gasta tokens e não chega ao "exatamente como eu disser". Falta uma ferramenta
pronta, feita para esse tipo de animação, em que:
- o harry **mexe com a mão**: desenha, arrasta a timeline e a curva;
- o agente **lê e edita o mesmo arquivo**, sem interpretar.

## A decisão: Rive com o MCP oficial
O [Rive](https://rive.app) é um editor feito para animar personagem:
- **Para animar:** tem ossos e malha, timeline com curvas e state machine, que é o que permite estados para o gato
  (por exemplo: parado, ouvindo, pensando, no overlay do ditado).
- **Para o agente:** o [MCP oficial](https://rive.app/docs/editor/ai/mcp) deixa o Claude ler a cena aberta e editá-la.
  Ele cria formas, ossos, keyframes, curvas, timelines e state machines, e recusa o que quebraria o arquivo. O MCP fica
  no app desktop (macOS e Windows), em `http://127.0.0.1:9791/mcp`, só enquanto o Rive está aberto.
- **No app:** o runtime oficial (`@rive-app/canvas`, WASM) vai no bundle e roda local, sem CDN nem conta.
- **O custo:**
  - o gato e a intro são refeitos lá (o SVG entra como vetor);
  - o harry precisa de conta;
  - o plano grátis tem 3 arquivos colaborativos, e o export dele sai com splash;
  - o Cadet custa US$ 9 por pessoa por mês ([preços](https://rive.app/pricing)).

Como fica o trabalho está no spec #3133:
1. O harry instala o Rive desktop e importa o gato.
2. O agente liga o MCP e refaz a intro como timeline e state machine.
3. O harry refina no editor, e o agente aplica o que ele pedir.
4. Com o ok dele, a intro do app passa a tocar o `.riv`.

## A comparação
| | O harry faz | O agente lê | No app (local) | Onde edita | Custo | Encaixe com o que temos |
|---|---|---|---|---|---|---|
| **[Rive](https://rive.app)** com o [MCP oficial](https://rive.app/docs/editor/ai/mcp) (**escolhido**) | Desenha, põe ossos, faz a timeline e a state machine | O `.riv` é binário; o agente lê e edita pelo MCP, com o editor aberto | Sim: o runtime WASM vai no bundle (`@rive-app/canvas`) | App desktop, com conta | Grátis com 3 arquivos colaborativos, e o export do grátis sai com splash; Cadet a US$ 9 por pessoa por mês ([preços](https://rive.app/pricing)) | Refazer o gato e a animação lá (o SVG entra como vetor). É o melhor para estados e reações |
| **[Lottie Creator](https://lottiefiles.com/lottie-creator)** com o [MCP](https://lottiefiles.com/blog/working-with-lottie-animations/your-ai-can-now-control-lottie-creator-heres-what-that-actually-means) | Usa a timeline no navegador e o Motion Copilot (texto vira keyframe) | O Lottie é um JSON em texto: dá diff no git | Sim: `dotlottie-web` ou `lottie-web` no bundle | No navegador, com conta | Não confirmei o preço | O SVG entra como camadas, mas as `@keyframes` de CSS não; só o SMIL vira keyframe ([docs](https://docs.lottiefiles.com/en/creator/09_assets-and-importing/importing)). A animação seria refeita |
| **[Figma Motion](https://www.figma.com/blog/introducing-figma-motion/)** (beta desde junho de 2026) | Usa a timeline no canvas do Figma | O MCP e o Dev Mode do Figma (CSS e JSON); exporta Lottie e SVG animado | Pelo export | No Figma, com conta | No plano do Figma | Bom para o **design** (o harry desenha e o agente lê o vetor). Para animar personagem, ainda fica atrás do Rive |
| [Theatre.js](https://github.com/theatre-js/theatre) | Usa uma timeline sobre o próprio SVG, que grava JSON | JSON | Sim | Local | Grátis (o studio é AGPL, só em dev) | Encaixaria bem, mas o último commit é de agosto de 2024. **Descartado:** parado |
| [Motion Studio](https://motion.dev/docs/studio) | Usa uma timeline no site, em dev, com agente embutido | Código do Motion | Sim | Local, num plugin do Vite | Pago (Motion+) | Exige reescrever a intro com a biblioteca Motion. **Descartado** |
| SVGator | Usa uma timeline web e exporta SVG animado | O export vem minificado, com o player em JS; ruim de ler e de dar diff | Sim | Web, com conta | Pago | **Descartado:** o agente não lê |

Um protótipo caseiro (o "diretor do Kiwi-cat", do #110) saiu do repo na T3150: o pedido era uma ferramenta pronta, e
não uma feita por nós (#3133).

## O design do gato ("esta orelha, esta curva, esta cor")
- **No Rive:** o harry mexe no vetor ali mesmo. O agente lê pelo MCP a forma e o nome de cada parte (cabeça, orelhas,
  olhos, corpo, rabo), então "esta orelha" é a parte selecionada ou nomeada na cena. Não é um palpite.
- **Nomes iguais:** ao importar o `kiwi-cat.svg`, as partes devem manter os nomes dos ids do SVG (`ear-left`, `tail`…).
  É assim que o harry e o agente falam da mesma coisa.
