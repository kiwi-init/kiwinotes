# Recorte do Kiwi-cat — T9708 / spec #9573

**Em revisão visual.** A folha `variantes-leve-forte.webp` é uma prévia parada
para a escolha do harry, não vídeo final nem medição de desempenho. A faixa
interna de 8% foi escolhida pelo lead (#9751), e a limpeza e o apoio dos
símbolos passaram na revisão #9760. A força da base ainda depende do harry. Nenhuma tela do app muda aqui.

A folha reúne os oito estados, na mesma pose fixa e semente17, nas variantes
leve (expoente0,5) e forte (0,35), em branco, preto e `#367a8e`. A última linha
mostra `thinking` com e sem o apoio dos símbolos. São capturas do WebKit
headless do módulo real, geradas por `kiwicat-cutout-variants.ts`, reduzidas
de800×960 para200×240; o gato continua no seu quadro640×800, com margem80.

A composição recortada preserva o RGB do renderer opaco como RGB
premultiplicado. A cobertura do material vem das camadas originais, separada
da luz. O apoio usa a intensidade suavizada acima do pedestal, limitado à
proximidade do material. Isso muda a opacidade do apoio, sem criar emissão.
A faixa nas bordas esquerda/direita/inferior só reduz a luz; ela não estende
o quadro nem atinge o corpo/aro/olhos/símbolos. Os olhos não têm apoio extra;
os símbolos têm uma cópia preta embaixo da névoa, com as mesmas poses.

Os assets novos são reproduzidos por `app/scripts/kiwicat-cutout-assets.py`
(Pillow13.0.0, NumPy2.5.4). Os assets opacos aprovados ficam intocados.
A reserva sem GPU tem RGBA próprio e cobertura do corpo. O recorte é opt-in
(`cutout:true`); o modo opaco conserva o caminho anterior.

Verificação numérica: extrair `app/ui/kiwicat`,
`app/scripts/kiwicat-demo.ts`, `app/src/bun/window-security.ts` e
`app/package.json` do commit `d2df9d3` para uma pasta de teste, com o
`node_modules` da versão fixa. Passar essa raiz em `KIWI_CAT_BASELINE` para
`bun app/scripts/kiwicat-cutout-check.ts <saída>`, seguido de
`python app/scripts/kiwicat-cutout-pixels.py <saída>`. São os oito estados
nos caminhos WebGPU, WebGL2 e sem GPU, em modo parado. O teste compara o
modo opaco byte a byte com o renderer anterior, o recorte fora da faixa
(≤2/255), o alfa de um canto (0) e do centro do corpo (255).

Ainda faltam o aceite visual, os vídeos finais sincronizados nos três
fundos, as capturas do hub nos dois temas, CPU pareada da opção aprovada e
FPS em movimento. Os números das experiências anteriores não substituem
essas provas. Nenhuma captura usa mic, agente real, app nativo ou sessão
de outra pessoa.

A comparação ampliada `comparacao-base-400px.webp` tem três estados
(repouso, agindo e dormindo), nas duas forças, em branco e cor. Cada quadro
do gato tem400×500px. A folha tem118536bytes, em WebP com qualidade90; a
compressão serve só para julgamento visual, nunca para o pixel-check.

A rodada numérica depois da limpeza passou nos24casos: modo opaco com
diferença0 contra d2df9d3; recorte com diferença máxima1/255 fora da faixa;
canto com alfa0 e centro do corpo com alfa255 em todos. O relatório está
em `pixels-parado.json`; é uma prova de quadros fixos, não de CPU/FPS.
A suíte completa teve1786pass,5skip,0fail; o typecheck e os33testes do
módulo/511asserts passaram. A escolha visual e a medição final continuam
pendentes.
