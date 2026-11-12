# Névoa do Kiwi-cat — T8487

Spec Kiwi #7549 v8466 · issue #376 · PR #377 (rascunho).

O harry escolheu o movimento B (#8693) e pediu uma textura mais fofa (#8696).
O harry escolheu a B1 algodão (#8754). O lead confirmou que as argolas nas
pontas do aro e o contorno do corpo foram corrigidos (#8751). **B1 é a única
textura do runtime; a aparência está congelada.**

## Comparação histórica: B1 algodão / B2 nuvem suave

| Estado, cor padrão | B1 à esquerda / B2 à direita |
| --- | --- |
| Ouvindo, voz sintética | [vídeo](variantes-fofas/ouvindo-B1-B2.mp4) |
| Thinking | [vídeo](variantes-fofas/thinking-B1-B2.mp4) |

B1 tem tufos amplos e macios; B2 reduz o contraste e deixa quase só volume.
As duas propostas preservavam a advecção e a resposta à voz da B. A e B2
saíram da API e do renderer; permanecem apenas no histórico. O repouso
permanece igual.

As correções do aro/corpo não alteraram a função de densidade e movimento:
[hashes antes/depois](variantes-fofas/density-preservada.json). A luz neutra
pode preencher o centro das pontas; a emissão cromática do aro tem ganho
limitado a 1. A curva escura dos estados ativos não tem a quebra que revelava
a linha do corpo. Nenhum filtro de blur é aplicado durante o desenho.

## Verificações funcionais

- [Varredura ativa](variantes-fofas/exposicao-ativa/report.json): 364 quadros,
  dois estados × duas variantes × 91 exposições, de 0,50 a 1,40, com o campo
  em 6 s e controles da voz máxima (`volume=1,16`, `upper=0,10`).
- [Verificação dos pixels](variantes-fofas/exposicao-ativa/pixel-check.json):
  nenhum canal decresce com a exposição; emissão do aro compatível com ganho
  até 1 dentro de 2/255 de quantização. A inspeção visual continua necessária.
- [Repouso](variantes-fofas/repouso-invariancia.json): em 12 s, semente 17,
  as duas variantes são idênticas, pixel a pixel, à versão anterior.
- [Referência v2](medidas/referencia.json): máximo 2/255 fora dos olhos +5px,
  incluindo a névoa, em 2048×2560 e t=0.
- [Prova inicial de captura e aceleração](prova-captura/README.md): WebKit
  headless com WebGPU Apple, vídeo não preto. Nenhum outro navegador.

Captura com relógio/voz/semente controlados, simulação 60 Hz, exportação
30 fps, sem interpolação e sem áudio. Não se mede FPS pelo arquivo de vídeo.
Não foram abertos app, helper, mic ou clipboard reais.

[Contrato e comandos](../../../../app/ui/kiwicat/README.md).

## Próximos passos

A [primeira matriz B1](final-b1/medidas-iniciais/README.md) reprovou as três
escalas. A [otimização do agendamento](final-b1/agendamento/README.md) preserva
os pixels e a apresentação nativa. Uma nova matriz mede três repetições por
escala, base parada e CPU por processo, com prazo monotônico de 60 s após
10 s de aquecimento. Depois dela saem os nove clipes finais e 60 s de repouso.
Os números valem para a demonstração em 640×800/DPR1, não para o WKWebView
de produção.

As medidas antigas coletavam 60 intervalos de 1 s mais o custo de consultar
os processos, chegando a cerca de 64 s; as taxas foram normalizadas pelo
tempo real. Não são aceite de desempenho da textura atual.

## Histórico

[A/B ouvindo](variantes/ouvindo-A-B.mp4) ·
[A/B thinking](variantes/thinking-A-B.mp4): comparação anterior à escolha B
e ao pedido de textura fofa. [Clipes iniciais](videos/): anteriores às
correções do contorno, preservados como histórico, não como entrega final.
As medidas `medidas/webgpu-*.json` e `webgl2-12fps.json` também são históricas.
