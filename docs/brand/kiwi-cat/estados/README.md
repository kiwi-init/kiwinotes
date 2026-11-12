# Estados do Kiwi-cat — T7606, rodada 2

Spec #7591; instrução #7589; revisão #7630; adendo do harry #7649 entregue
pelo lead no #7655, corrigido no #7657 e aprovado no #7671, no canal `kiwinotes` do Kiwi Channels.
Issue [#309](https://github.com/kiwi-init/kiwinotes/issues/309), PR [#311](https://github.com/kiwi-init/kiwinotes/pull/311).

**Referências documentais compostas com as camadas originais. Não são capturas da animação. Aprovação visual pendente.**

![Resumo](prancha-estados.webp)

## Imagens grandes

Cada pose usa um palco de 1536 × 1920, mais 132 pixels de legenda. A fonte
2048 × 2560 é reduzida uniformemente a 75%, sem alteração das proporções.
O gato, das orelhas ao fim do corpo, ocupa mais de 1024 pixels de altura.
Abra as imagens de estado no tamanho original para julgar o detalhe;
o resumo é só navegação. Cada WebP tem no máximo 500.000 bytes.

| Imagem | Poses e olhos | Símbolo e intenção |
| --- | --- | --- |
| [repouso](estado-repouso.webp) | Neutro, olhar discreto, piscada lenta | Sem símbolo; comportamento discreto |
| [dormindo](estado-dormindo.webp) | Dois momentos de sono, arcos para baixo | zZ subindo; névoa mínima |
| [acordou](estado-acordou.webp) | Antes, pico com olhos 24% maiores, assentando | Exclamação que salta; pulso de luz |
| [ouvindo](estado-ouvindo.webp) | Voz baixa e alta, olhos redondos | Uma e três ondas junto da orelha; a névoa acompanha a voz |
| [thinking](estado-thinking.webp) | Semicerrados, olhar para cima e para cada lado | Balão de três pontos, um e dois pontos acesos; luz concentrada no alto |
| [agindo](estado-agindo.webp) | Foco e execução, pálpebras superiores horizontais | Gotas de suor e linhas de movimento; luz lateral alterna |
| [pronto](estado-pronto.webp) | Dois momentos de arco feliz | Brilhos que abrem; névoa assenta |
| [erro](estado-erro.webp) | Olhos menores e desiguais; três poses | Opção A: ? e gota; opção B: rabisco de confusão; depois A recolhendo |
| [cores](cores.webp) | Repouso e voz alta × três paletas | Lilás original, laranja Claude Code e branco perolado Codex |

São **19 poses padrão e quatro variações adicionais de cor**. Os parâmetros
por pose estão em `quadros.json` e nos `.txt` junto dos quadros soltos.
São poses documentais, não um roteiro temporal nem prova de animação fluida.

## Construção

A revisão #7630 pediu composição por script em vez de geração do personagem.
`montar.py` usa literalmente `luz.png`, `corpo.png`, `cabeca.png`, as duas
orelhas e `aro.png`, na ordem do `manifest.json`. As orelhas giram pela base,
nos pivôs originais. Corpo, cabeça e aro não recebem deformação, rotação ou
translação; só a escala global de apresentação.

As pálpebras horizontais, círculos, arcos e símbolos são desenhados por código
com supersampling 2× e redução Lanczos. O traço dos símbolos é branco, com
terminais arredondados, fora da silhueta, sem cobrir olhos ou aro. Não há
notebook, livro, lupa nem logotipo. O desenho segue a tabela aprovada do adendo;
a v2 é a única fonte visual do personagem.

Quando a pálpebra fecha ou o olhar desloca, o script estima somente os pixels
antes ocultos pelos olhos (discos + 5 px), por ajuste quadrático à superfície
vizinha. Isso remove as manchas circulares do preenchimento antigo, sem blur
e sem modificar as texturas de origem.

A névoa mantém a massa orgânica da v2. Não há anel, partícula, forma sintética,
blur ou nova geração por IA. Densidade, peso lateral/vertical e matiz são
aplicados **à névoa visível depois da composição**, protegendo a silhueta
fosca escura e o aro. Assim, reduzir a luz não expõe os cortes retos da
separação antiga de `luz.png`. A pose neutra padrão não recebe esse ajuste.
A distribuição de densidade e a intenção de direção aparecem nas legendas.
As paletas afetam a névoa, sem recolorir os olhos ou os símbolos.

As orelhas usam amplitudes conservadoras: esquerda de −5° a +7°, direita de
−5° a +5°. São os limites usados nesta prancha, sujeitos à revisão visual,
não uma garantia para qualquer interpolação. Rotações maiores expõem emendas
dos pixels ocultos estimados nos recortes originais (`gerada/README.md`).
Preparar melhor esses pixels fica antes da entrega 4 se o harry quiser um
movimento maior. As texturas originais não foram retocadas.

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

O script confere a composição neutra na resolução da fonte, **antes da redução
e da compressão WebP**, contra a v2: máximo ≤4/255 e média <0,5/255 fora dos
discos dos olhos com margem de 5 px. Os números e os hashes das seis camadas
estão em `verificacao.json`. A tolerância cobre só essa pose, não as orelhas
giradas, as variações de luz ou o WebP com perdas. As poses alteradas e a
compressão precisam também de inspeção visual.

Os oito estados, a imagem de cores e o resumo são WebP de até 500 KB cada.
O script prepara só documentos: nada do app, shader, overlay, microfone ou
interface do macOS é executado. O ok do harry continua necessário antes da
entrega seguinte.
