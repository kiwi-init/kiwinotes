# Estados do Kiwi-cat — T7606, rodada 2

Spec #7591; instrução #7589; revisão #7630; adendo do harry #7649 entregue
pelo lead no #7655, corrigido no #7657 e aprovado no #7671, no canal `kiwinotes` do Kiwi Channels.
Issue [#309](https://github.com/kiwi-init/kiwinotes/issues/309), PR [#311](https://github.com/kiwi-init/kiwinotes/pull/311).

**Referências documentais compostas com as camadas originais. Não são capturas da animação. Aprovação visual pendente.**

![Resumo](prancha-estados.webp)

Revisão #7713: aro acompanha a luz, símbolos de quadrinho em formas cheias
e cor livre por agente. A decisão posterior #7718/#7724 escolheu o rabisco (B), removeu a opção A
e pediu orelhas com movimento amplo.

## Imagens grandes

Cada pose usa um palco de 1536 × 1920, mais 132 pixels de legenda. A fonte
2048 × 2560 é reduzida uniformemente a 75%, sem alteração das proporções.
O gato, das orelhas ao fim do corpo, ocupa mais de 1024 pixels de altura.
Abra as imagens de estado no tamanho original para julgar o detalhe;
o resumo é só navegação. Cada WebP tem no máximo 500.000 bytes.

A [tira de tamanho real](tamanho-real.webp) mostra os oito estados lado a
lado, com altura de referência do gato de 120 e 240 px (marcas verticais).
A escala usa os mesmos pontos da v2, y=650 a y=2240 na fonte, em todos
os estados; símbolos e margens não entram nessa medida. Veja a 100% de zoom.

| Imagem | Poses e olhos | Símbolo e intenção |
| --- | --- | --- |
| [repouso](estado-repouso.webp) | Neutro, olhar discreto, piscada lenta | Sem símbolo; comportamento discreto |
| [dormindo](estado-dormindo.webp) | Dois momentos de sono, arcos para baixo | zZ subindo; névoa mínima |
| [acordou](estado-acordou.webp) | Antes, pico com olhos 24% maiores, assentando | Exclamação só no pico (02), ausente antes e assentando; pulso de luz |
| [ouvindo](estado-ouvindo.webp) | Voz baixa e alta, olhos redondos | Uma e três ondas junto da orelha; a névoa acompanha a voz |
| [thinking](estado-thinking.webp) | Semicerrados, olhar para cima e para cada lado | Balão de três pontos, um e dois pontos acesos; luz concentrada no alto |
| [agindo](estado-agindo.webp) | Foco e execução, pálpebras superiores horizontais | Gotas de suor e linhas de movimento; luz lateral alterna |
| [pronto](estado-pronto.webp) | Dois momentos de arco feliz | Brilhos que abrem; névoa assenta |
| [erro](estado-erro.webp) | Olhos menores e desiguais; orelhas em avião | Rabisco começando (0 s), no meio (0,45 s) e embolado (0,90 s) |
| [cores](cores.webp) | Repouso e voz alta × três paletas | Lilás, laranja, perolado, verde, rosa, azul e quase preto com piso |

São **19 poses padrão e doze variações adicionais de cor**. Os parâmetros
por pose estão em `quadros.json` e nos `.txt` junto dos quadros soltos.
São poses documentais, não um roteiro temporal nem prova de animação fluida.

## Construção

A revisão #7630 pediu composição por script em vez de geração do personagem.
`montar.py` usa literalmente `luz.png`, `corpo.png`, `cabeca.png`, as duas
orelhas e `aro.png`, para recompor a cena aprovada antes de preparar as bases ocultas. As orelhas giram pela base,
nos pivôs originais. Corpo, cabeça e aro não recebem deformação, rotação ou
translação; só a escala global de apresentação.

As pálpebras horizontais, círculos, arcos e símbolos são desenhados por código
com supersampling 2× e redução Lanczos. Os olhos fechados mantêm 34 px na fonte. Os símbolos são formas cheias
com espessura variável e leve irregularidade determinística, desenhadas por
curvas e polígonos: cunha inclinada com ponto e ênfases no `!`, gancho
inclinado no `?`, zZ gordos, nuvem bojuda, estrelas cheias, gotas gordas,
ondas e velocidade afuniladas. Nenhum símbolo usa glifo de fonte. São
brancos, com pontas suavizadas, fora da silhueta, sem cobrir olhos ou aro. Não há
notebook, livro, lupa nem logotipo. O desenho segue a tabela aprovada do adendo;
a v2 é a única fonte visual do personagem.

Quando a pálpebra fecha ou o olhar desloca, o script estima somente os pixels
antes ocultos pelos olhos (discos + 5 px), por ajuste quadrático à superfície
vizinha. Isso remove as manchas circulares do preenchimento antigo, sem blur
e sem modificar as texturas de origem.

A névoa mantém a massa orgânica da v2. Não há anel, partícula, forma sintética,
blur ou nova geração por IA. Densidade, peso lateral/vertical e matiz são
aplicados **à névoa visível depois da composição**, preservando a silhueta
fosca e a matiz do aro. Assim, reduzir a luz não expõe os cortes retos da
separação antiga de `luz.png`. A pose neutra padrão não recebe esse ajuste.
A distribuição de densidade e a intenção de direção aparecem nas legendas.
A exposição mínima da névoa é 0,50 da v2, inclusive no sono: ela perde luz,
mas mantém o contorno da cabeça e das orelhas. O ganho do aro é o menor ganho
local da névoa, limitado a 1: ele cai junto da luz, sem se tornar neon mais
forte em relação à névoa. Seu ciano/púrpura é preservado. A pose neutra padrão
continua sem alteração.

`cor` aceita cores sRGB via `ImageColor` (por exemplo, qualquer `#RRGGBB`).
Se a luminância linear da entrada for menor que 0,28, a preparação eleva a
cor em direção ao branco até esse piso, preservando a direção de matiz.
A cor é normalizada para iluminar a mesma massa de névoa; os olhos e símbolos
não recebem a cor do agente. Em `cores.webp`, duas linhas (repouso e voz alta)
mostram sete opções: padrão, Claude, Codex, verde `#63d997`, rosa `#ff81c0`,
azul `#70a8ff` e quase preto `#030409`. A folha é reduzida uniformemente para
9856 px de largura, com o gato ainda acima de 1024 px de altura por célula.
A escolha em Ajustes foi registrada na seção 4 da instrução; este PR continua
somente documental, sem implementar a tela de Ajustes.

## Orelhas preparadas e prova de amplitude

A [prova de orelhas](prova-orelhas.webp) mostra a esquerda e a direita,
independentemente, em −30°, −15°, 0°, +15° e +30°. A outra orelha fica parada.
Os ângulos são controles da ponta ao redor dos pivôs do manifest, com
flexão suave de cartilagem: o peso da rotação cai para zero na base e na
borda interna. Não é uma placa rígida que se afasta da cabeça. A raiz
permanece presa; só a orelha recebe essa deformação.
A folha é reduzida globalmente para 7040 px de largura; a altura do gato por
célula continua acima de 1024 px.

As quatro texturas derivadas em `preparadas/` são PNGs de preparação sem
perda, 2048 × 2560: fundo sem orelhas, cabeça fixa e as duas orelhas RGBA.
Não são imagens de revisão em WebP. Os seis arquivos em `gerada/` permanecem
intactos. A extração anterior misturava parte da silhueta das orelhas na luz
e no aro; girar apenas aqueles recortes deixava um fantasma no fundo.

O script recompõe primeiro a cena original e refaz a separação de alfa
somente nas regiões das orelhas. O fundo revelado recebe interpolação
harmônica; o alfa e a cor das orelhas são resolvidos pela equação source-over,
para preservar a imagem neutra. Uma placa fixa conserva os pixels da cabeça e do aro frontal; a extensão
antes escondida da cabeça usa uma máscara contínua, sem as pontas recortadas
da separação antiga. Nas bases **completamente ocultas** por
essa placa, o alfa faltante é continuado em RGBA premultiplicado,
com interpolação em ponto flutuante e RGB preto fosco. Isso evita carregar uma segunda cópia
do aro para fora da cabeça ou expor um recorte opaco plano.

A preparação não redesenha os pixels visíveis do gato: a comparação neutra
é a conferência decisiva (máximo 2/255 e média próxima de 0,0434/255 fora dos
olhos), antes de reduzir/comprimir. A invariância é da composição visível,
não dos canais RGBA da separação antiga, que foram reorganizados. Fora da
região de preparação o fundo é preservado exatamente; cabeça e corpo não
recebem transformação. A prova de ±30° precisa também de julgamento visual,
não é validada só pela comparação neutra. `verificacao.json` registra o método,
a região alterada e as métricas; `preparadas/manifest.json` guarda o contrato.

O repouso demonstra um tique unilateral, o sono relaxa as duas orelhas, o
acordar as ergue, a escuta vira para o som e o erro abre até 30° em avião.
Na futura animação, os tiques são independentes, as piscadas são lentas e às
vezes duplas, com intervalos variáveis. O rabisco de erro será desenhado em
loop próximo de 1 s, com a ponta avançando e tremida leve. Esta entrega mostra
três instantes de referência; não contém o relógio ou o loop do app.

**Tema claro permanece em aberto:** o ícone e os símbolos brancos foram
preparados para fundo escuro. A solução para o tema claro precisa de decisão
visual própria; esta prancha não decide contorno, fundo ou inversão de cor.

`INSTRUCAO.md` preserva a instrução completa e seu novo adendo (seção 9).
`prompt-prancha.txt` é o registro histórico da rodada 1 rejeitada; nenhum
quadro daquela geração é usado aqui. Os `.txt` atuais descrevem a composição
real, sem fingir que houve prompts de IA nesta rodada.

## Reprodução e conferência

```sh
python3 -m venv /tmp/kiwi-cat-estados
/tmp/kiwi-cat-estados/bin/pip install -r docs/brand/kiwi-cat/gerada/requirements.txt
/tmp/kiwi-cat-estados/bin/python docs/brand/kiwi-cat/estados/montar.py
```

Também foram conferidos pixels sintéticos: uma névoa cinza de 120/255
reduzida para 66/255 e um aro ciano reduzido exatamente à metade; o matte
(11,11,14) permanece igual e o caso quase preto continua luminoso.

O script confere a composição neutra na resolução da fonte, **antes da redução
e da compressão WebP**, contra a v2: máximo ≤4/255 e média <0,5/255 fora dos
discos dos olhos com margem de 5 px. Os números e os hashes das seis camadas
estão em `verificacao.json`. A tolerância cobre só essa pose, não as orelhas
giradas, as variações de luz ou o WebP com perdas. As poses alteradas e a
compressão precisam também de inspeção visual.

Os oito estados, a prova de orelhas, a imagem de cores, o resumo e a tira de tamanho real são WebP de até 500 KB cada.
O script prepara só documentos: nada do app, shader, overlay, microfone ou
interface do macOS é executado. O ok do harry continua necessário antes da
entrega seguinte.
