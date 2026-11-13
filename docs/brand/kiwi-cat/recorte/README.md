# Kiwi-cat recortado — T9708 / spec #9573

A base **leve**, escolhida pelo harry (#9810), mantém o corpo escuro opaco e
as áreas externas transparentes. O recorte é opt-in (`cutout: true`). Esta
mudança entrega o módulo e suas provas; a integração ao hub está na T9567.
O aceite visual dos vídeos finais ainda cabe ao harry.

## Provas visuais

- `oito-estados-leve.webp`: oito poses fixas, semente 17, em branco, preto e
  `#367a8e`; capturas do módulo no WebKit headless.
- `videos/*.mp4`: um quadro RGBA real do WebKit por instante, composto nos
  três fundos. Cada coluna usa exatamente o mesmo quadro. Exportação com
  relógio controlado a 30 amostras/s, sem interpolação; não é prova de FPS.
  Quadros sem mudança são repetidos. `capture.json` descreve os instantes;
  `manifest.json` contém contagem, duração, SHA256 e controles de alfa.
- `videos/compose-vs-webkit.json`: o primeiro quadro composto fora do
  navegador é comparado com capturas reais do WebKit nos três fundos,
  sem rótulos nem redimensionamento (máximo permitido: 2/255).
- `hub/` e `videos/hub.mp4`: composição sobre capturas reais do hub headless
  claro e Channels Dark (`#111113`). O vídeo usa outro renderer real de
  96×120 px. São provas de composição, não capturas da integração ao app.
- `repouso-sem-veu-alpha.png`: RGBA em tamanho original.

Tudo usa dados temporários, sem mic, agente real, app nativo na tela ou
controle de outros apps. A voz de `ouvindo` é uma sequência numérica sintética.

## Como o recorte funciona

O RGB original é tratado como luz premultiplicada. A cobertura do corpo/aro
vem das camadas aprovadas e protege também a região sob os olhos. Uma base
escura suave apoia a luz perto do material, sem criar emissão. Os símbolos
recebem uma cópia preta por baixo da névoa, na mesma pose dos vetores brancos.

As exceções aprovadas no spec são a faixa interna de 8% nas bordas esquerda,
direita e inferior (só reduz luz) e a curva suave de 16 a 32/255 que remove
emissão fraca distante. Corpo e aro ficam protegidos. A composição dos pixels
antialias dos símbolos pode mudar quando o véu de baixo é removido; os
vetores isolados devem continuar idênticos. Não se estende nada fora do quadro.

As referências opacas originais ficam intocadas. O fallback sem GPU recebe
novos arquivos RGBA. `kiwicat-cutout-assets.py` os reproduz com Pillow 13.0.0 e
NumPy 2.5.4. SVGs de olhos e símbolos usam `display:block` para que a tipografia
do host não os desloque para fora de suas caixas.

## Verificação

`pixels-camadas-curva16-32.json` registra 24 casos (oito estados × WebGPU,
WebGL2 e sem GPU): modo opaco idêntico à base `d2df9d3`, luz forte/material
fora da faixa com diferença máxima 1/255, vetores isolados idênticos, canto
com alfa 0 e centro do corpo com alfa 255. A diferença da composição completa
é registrada separadamente e inclui a remoção aprovada do véu.

Para reproduzir, extraia `app/ui/kiwicat`, `app/scripts/kiwicat-demo.ts`,
`app/src/bun/window-security.ts` e `app/package.json` de `d2df9d3`, forneça
as dependências fixas e passe essa raiz em `KIWI_CAT_BASELINE`:

```sh
cd app
bun scripts/kiwicat-cutout-check.ts /tmp/cat-pixels
python scripts/kiwicat-cutout-pixels.py /tmp/cat-pixels
bun scripts/kiwicat-vector-layout-check.ts /tmp/cat-layout
bun scripts/kiwicat-cutout-pairs.ts /tmp/cat-cpu --leve-only
bun scripts/kiwicat-cutout-fps.ts /tmp/cat-fps leve
KIWI_CUTOUT_PYTHON=/caminho/python bun scripts/kiwicat-cutout-videos.ts ../docs/brand/kiwi-cat/recorte/videos /tmp/kiwi-T9708-hub-composed
```

Capturas, CPU e FPS exigem a lease `bench`; não execute medições em paralelo.
O teste de layout monta o módulo com altura de linha de 200 px e confere a
geometria real dos SVGs no WebKit. Sem a correção ele reproduz o deslocamento;
com ela exige alinhamento menor que 0,5 px.

## Desempenho e rastreabilidade

Os relatórios em `desempenho/` medem somente a demo WebKit headless, 640×800,
DPR1. CPU soma os cinco processos próprios, em porcentagem de um núcleo,
com 10 s de aquecimento e 60 s de amostra, sem captura. A meta é acréscimo
máximo de 0,5 ponto sobre o opaco, em pares de ordem alternada.

A série final após o ajuste dos SVGs teve média opaco 2,225%, recortado
2,292%, delta médio +0,067 ponto e pior par +0,234 ponto. O p95 agregado
foi 5,005% no opaco e 5,174% no recortado. Os três pares ficaram dentro
do alvo de +0,5 ponto. Os hashes de runtime dos seis relatórios conferem
com a fonte final. A série anterior está preservada em `serie-inicial/`.

A primeira janela de FPS de `agindo` ficou em 54,74; o arquivo com a falha
foi preservado. Duas repetições e o controle opaco passaram (mínimo posterior
59,08). Não se usa a exportação dos vídeos para concluir sobre fluidez.
Os relatórios registram hashes das fontes efetivamente medidas; o HEAD WIP
registrado não identifica sozinho alterações ainda não commitadas.

Os pares originais terminaram entre 12:29 e 12:42 (-03) em 13/11/2026.
A inicialização concorrente relatada em #10230 ocorreu às 13:36:23–35 e
não se sobrepôs a eles. Os arquivos originais foram preservados.
`historico/` contém experiências anteriores à escolha e à curva final;
não são as provas finais nem opções ainda pendentes de escolha.

Validação local: typecheck limpo e 33 testes do módulo / 511 asserts. A suíte
completa teve 1785 pass, 5 skip e 1 falha no cancelamento do download em
`precise-dictation.test.ts`; a execução isolada desse arquivo passou 11/11.
O log completo foi preservado em `/tmp/kiwi-T9708-final-bun.log`.

No CI do commit `a660d6b`, o job Bun (incluindo verificações de UI) e o
typecheck passaram no run `43483983088`; Swift ainda estava na fila.

A confirmação final de FPS, após o ajuste SVG, passou nos seis estados
ativos: 57,16 a 60,00 FPS, sem fallback lento (`desempenho/fps-final.json`).
O teste de altura de linha também confere os dois olhos dentro do quadro
do gato, além do alinhamento de todos os SVGs às caixas.
