# Como o harry dirige a animação e o design do Kiwi-cat (T3065, spec #3058)

Pesquisa feita em 4 de novembro de 2026.

## O problema
Hoje cada ajuste é uma troca de texto. O harry descreve ("a orelha entra cedo demais"), o agente chuta um número no CSS,
renderiza e volta para perguntar. Isso gasta tokens e não chega ao "exatamente como eu disser". Falta um meio de:
- o harry **mostrar**: arrastar, marcar o instante, apontar a parte;
- o agente **ler** o que ele mostrou, sem interpretar.

## A recomendação
**1. Agora: o diretor do Kiwi-cat** ([`docs/brand/diretor`](../brand/diretor/README.md)). É uma página local, feita
neste PR em cima do SVG que já temos.
- **O harry ajusta sozinho:** arrasta as barras da linha do tempo e as alças da curva, e vê o resultado na hora. Ali
  ele chega ao "exato" sem nenhum agente no meio.
- **O agente lê números, não frases:** o `direcao.json` diz o seletor, a animação e os valores, e o `aplicar.ts`
  reescreve só aquele `animation:`. O que o harry viu na tela é o que entra no arquivo, porque é o mesmo código.
- **Apontar vale para o design também:** a nota guarda o instante, o ponto e a parte (`#ear-right < #head`), e o
  `quadros.ts` mostra ao agente o frame com o ponto marcado. "Esta orelha" deixa de ser ambíguo.
- **Custo zero:** sem conta, sem assinatura e nada sai do Mac. A intro do app não muda: o `gerar.ts` já lê o SVG.

**2. Se o harry quiser redesenhar o gato ou dar estados a ele, o Rive** (por exemplo: parado, ouvindo, pensando, no
overlay do ditado). É a ferramenta feita para personagem:
- tem ossos, malha e state machine;
- o runtime web roda local, no bundle;
- tem um MCP oficial para o Claude ler e editar o arquivo.

O custo é refazer a animação lá, e a decisão de conta e plano é do harry. Os detalhes estão na tabela.

## A comparação
| | O harry faz | O agente lê | No app (local) | Onde edita | Custo | Encaixe com o que temos |
|---|---|---|---|---|---|---|
| **Diretor do Kiwi-cat** (este PR) | Arrasta o tempo e a curva de cada parte e marca pontos no frame | O `direcao.json`, com os números exatos; o `quadros.ts` dá o frame | Nada muda | Local, no `127.0.0.1` | Grátis | **Total:** edita o próprio SVG. Só tempo e curva; não desenha forma |
| **[Rive](https://rive.app)** com o [MCP oficial](https://rive.app/docs/editor/ai/mcp) | Desenha, põe ossos, faz a timeline e a state machine | O `.riv` é binário; o agente lê pelo MCP, com o editor aberto | Sim: o runtime WASM vai no bundle (`@rive-app/canvas`) | App desktop ou web, com conta | Grátis com 3 arquivos colaborativos, e o export do grátis sai com splash; Cadet a US$ 9 por pessoa por mês ([preços](https://rive.app/pricing)) | Refazer o gato e a animação lá (o SVG entra como vetor). É o melhor para estados e reações |
| **[Lottie Creator](https://lottiefiles.com/lottie-creator)** com o [MCP](https://lottiefiles.com/blog/working-with-lottie-animations/your-ai-can-now-control-lottie-creator-heres-what-that-actually-means) | Usa a timeline no navegador e o Motion Copilot (texto vira keyframe) | O Lottie é um JSON em texto: dá diff no git | Sim: `dotlottie-web` ou `lottie-web` no bundle | No navegador, com conta | Não confirmei o preço | O SVG entra como camadas, mas as `@keyframes` de CSS não; só o SMIL vira keyframe ([docs](https://docs.lottiefiles.com/en/creator/09_assets-and-importing/importing)). A animação seria refeita |
| **[Figma Motion](https://www.figma.com/blog/introducing-figma-motion/)** (beta desde junho de 2026) | Usa a timeline no canvas do Figma | O MCP e o Dev Mode do Figma (CSS e JSON); exporta Lottie e SVG animado | Pelo export | No Figma, com conta | No plano do Figma | Bom para o **design** (o harry desenha e o agente lê o vetor). Para animar personagem, ainda fica atrás do Rive |
| [Theatre.js](https://github.com/theatre-js/theatre) | Usa uma timeline sobre o próprio SVG, que grava JSON | JSON | Sim | Local | Grátis (o studio é AGPL, só em dev) | Encaixaria bem, mas o último commit é de agosto de 2024. **Descartado:** parado |
| [Motion Studio](https://motion.dev/docs/studio) | Usa uma timeline no site, em dev, com agente embutido | Código do Motion | Sim | Local, num plugin do Vite | Pago (Motion+) | Exige reescrever a intro com a biblioteca Motion. **Descartado agora** |
| SVGator | Usa uma timeline web e exporta SVG animado | O export vem minificado, com o player em JS; ruim de ler e de dar diff | Sim | Web, com conta | Pago | **Descartado:** o agente não lê |

## O design do gato ("esta orelha, esta curva, esta cor")
- **Apontar:** é o 📍 do diretor. O agente recebe o id da parte e vê o frame com o ponto marcado, pelo
  `quadros.ts --notas`.
- **Mudar a forma:** o agente responde a nota com 2 ou 3 variantes lado a lado, numa prancha só, e o harry escolhe uma.
  Escolher entre opções gasta muito menos que descrever e refazer.
- **Desenhar com a própria mão:** o harry abre o SVG no Figma (ou no Rive), mexe no vetor e exporta. Um cuidado: **os ids
  têm que voltar iguais** (`#ear-left`, `#tail`…), porque a animação se prende a eles. Isso precisa ser conferido no
  primeiro export.

## O fluxo de ponta a ponta
1. O harry roda `bun docs/brand/diretor/servir.ts`, abre o endereço, ajusta, marca e salva. O arquivo
   `docs/brand/kiwi-cat-familia/direcao.json` vai para o repo.
2. Ele avisa no canal.
3. O agente roda:
   - `quadros.ts --notas`, para ver o que foi apontado;
   - `aplicar.ts --seco` e depois `aplicar.ts`;
   - `quadros.ts`, para ver o antes e o depois;
   - `gerar.ts`, que leva a mudança para a intro do app.

   Depois, abre o PR.

A mudança de exemplo, com o diff e os frames, está no [README do diretor](../brand/diretor/README.md#a-mudança-de-exemplo).

## O que fica para depois
- O diretor não mexe nos valores de dentro dos `@keyframes`, como o quanto a orelha gira. Dá para incluir se o harry usar
  e sentir falta.
- O começo da intro, do prisma até a bola, é animado por script (`docs/brand/intro/intro.js`), e não por CSS: fica fora
  do diretor por enquanto.
- Rive ou Lottie: é uma decisão do harry, com conta e plano, se ele quiser estados para o gato.
