# Prancha proposta — T3747

`prancha-intro.png` reúne dez poses da intro nova, no estilo visual da prancha
anterior. Os PNGs soltos em `quadros/` são 1024×1024, com cantos arredondados e
transparência fora do palco. `quadros.json` traz número do frame, segundo do
gato, segundo total da intro e legenda.

São mockups para aprovação do harry (#3744, #3754), **não capturas da animação
implementada na T3720**. A animação deverá seguir as poses aprovadas. O gato
usa a v2 aprovada em #3732 e os recortes da T3705; não há um gato novo gerado.
O harry aprovou a sequência em #3799 e pediu atenção ao corpo em todos os
quadros. O corpo fica de frente, centralizado, com as proporções e posições
originais: não recebe escala, rotação, inclinação ou deslocamento. A formação
apenas revela seus pixels com opacidade e máscara suave, de cima para baixo.
Os recortes são os efetivamente mesclados na main (`f06e567`). O queixo nas
poses intermediárias usa a mesma regra da T3720 (`camadas.ts`, #3771): última
linha da cabeça com alfa >0,1 e rampa de 60×k pixels acima dela, onde k é a
largura de origem dividida por 512. Não altera os PNGs de origem.

## Tempos

O frame zero do gato é a emenda com o prisma aos 3,7 s da intro. A partir dali,
o gato leva 8 s / 480 frames a 60 fps; a pose final cai em 11,7 s totais.

| Frame | Gato | Intro | Pose |
| --- | --- | --- | --- |
| f0 | 0,00 s | 3,70 s | Círculo de vidro escuro, sem contorno |
| f48 | 0,80 s | 4,50 s | A névoa redonda nasce |
| f112 | 1,87 s | 5,57 s | A orelha esquerda levanta antes da direita |
| f150 | 2,50 s | 6,20 s | Orelhas assentando, círculo vira cabeça |
| f176 | 2,93 s | 6,63 s | Olhos sonolentos, sem brilho |
| f220 | 3,67 s | 7,37 s | Reabertura depois de fechar |
| f268 | 4,47 s | 8,17 s | Olhos totalmente abertos |
| f336 | 5,60 s | 9,30 s | Corpo ganhando densidade |
| f390 | 6,50 s | 10,20 s | Aro acendendo e corpo formado |
| f480 | 8,00 s | 11,70 s | Pose final da v2 |

As regras vêm do roteiro da T3151, agora executado em CSS/JS pela T3720:
cabeça preta, olhos brancos nítidos, luz macia, orelhas girando pela base,
corpo feito de névoa e aro ciano→púrpura por dentro do topo. A v2 não tem cauda;
a prancha não inventa uma.

## Construção e conferência

`prancha.py` prepara as poses localmente com as camadas PNG da T3705, máscaras,
rotações, escala, opacidade e olhos vetoriais. A densidade escura da própria v2
fornece a cabeça antes de o aro acender; a máscara fecha os vazios internos
deixados pela remoção do aro. Isso evita luz atravessando o rosto. O círculo
é uma forma sombreada sem traço. A névoa inicial é um toro contínuo, com cores
amostradas da v2; não se recorta outro gato nem se usa um modelo na geração
dos quadros. A luz difusa das poses intermediárias é preparada no script.

O centro da emenda é (512,430), raio 225, como no roteiro. As camadas da foto
entram a ×0,4 em (102,−82), mantendo a altura dos olhos nesse centro. Os tempos
das piscadas e da formação seguem os beats; esta seleção de dez poses não
mostra todos os frames de overshoot, a piscada curta nem o idle.

Para reproduzir a prancha, após ter os assets da T3705 em `gerada/`:

```sh
python3 -m venv /tmp/kiwi-prancha
/tmp/kiwi-prancha/bin/pip install -r docs/brand/kiwi-cat/gerada/requirements.txt
/tmp/kiwi-prancha/bin/python docs/brand/kiwi-cat/prancha.py
```

O script verifica os dez arquivos e compara a última pose com a fonte aprovada,
no encaixe do palco, excluindo os olhos que passam a círculos brancos. As
diferenças por reamostragem/composição ficam em `verificacao-prancha.json`.
Também confere a revelação do corpo em todos os 481 frames (f0–f480): alfa
monotônico, corpo ausente antes do B6 e íntegro de f390 em diante. Nas dez poses,
os RGB do corpo são idênticos aos da fonte e não há alfa fora da cobertura
original. Isso impede deformação, mudança de perfil ou extensão da silhueta.
Inspecione também a prancha inteira: a métrica da pose final não confere as
poses intermediárias. Nenhum app, microfone ou janela de usuário é aberto.
