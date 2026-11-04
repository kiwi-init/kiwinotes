# Kiwi-cat aprovado — T3705

A candidata v2 foi aprovada pelo harry em #3732. A imagem inteira foi gerada
com o `imagegen` integrado a partir da `../referencia-final.png`; o prompt está
em `prompt-v2.txt`. A saída nativa de 1122×1402 foi normalizada com
`sips -z 2560 2048` para 2048×2560: não é detalhe nativo de 2K.
`kiwi-cat-candidata-v2.png` é essa fonte aprovada, sem substituição posterior.

O recorte local foi confirmado pelo lead em #3736 depois de a extração por IA
redesenhar as peças (variantes descartadas). Nada deste processo de geração
roda no app. O destino das camadas é a animação CSS/JS da T3720 (#3718, #3726).

## Uso

Todos os PNGs de animação são RGBA com **alfa reto**, 2048×2560, em **(0,0)**.
Use fundo preto, opacidade 1 e composição normal `source-over`. Não use
`screen`, `multiply` nem aplique blur ao vivo. As bordas macias já estão nos
pixels/alfa. O espaço e os pivôs estão em `manifest.json`.

Ordem de trás para frente:

1. `luz.png`
2. `corpo-nevoa.png`
3. `cabeca.png`
4. `orelha-esquerda.png`
5. `orelha-direita.png`
6. `aro.png`
7. `olhos.svg` — dois círculos brancos sem efeito, separados dos PNGs

Para o consumidor que já separa a cabeça (#3739), há também o contrato de três
entradas: **`luz.png` → `corpo.png` → `cabeca-inteira.png` → olhos**.
`corpo.png` é idêntico a `corpo-nevoa.png`; `cabeca-inteira.png` é a composição
da cabeça, orelhas e aro, sem olhos. `camadas.json` traz olhos, polígonos das
orelhas, sobra, pivôs e encaixe no palco 1024. São **alternativas**: não empilhe
`cabeca-inteira.png` junto das peças que ela agrupa.

O tamanho de origem é quatro vezes o espaço anterior de 512×640. Para preservar
o encaixe antigo (×1,6), use ×0,4 agora. Os polígonos são máscaras de separação,
não uma nova silhueta. Não redesenhe o gato a partir deles.

## Verificação e limites

`recomposta.png` e `comparacao-camadas.png` mostram as seis camadas com olhos
vetoriais sobre preto. `camadas.png` mostra as peças sobre cinza para inspecionar
o alfa. `verificacao.json` mede o erro de canal RGB (0–255) da pilha salva,
comparada à fonte aprovada, tanto no contrato de seis como no de três camadas.
O script exige máximo ≤4/255 e médio <0,5/255 fora dos olhos.

Os olhos da fonte gerada tinham leve textura e foram substituídos por círculos
brancos nítidos conforme a task. A medição fora dos olhos exclui apenas os dois
discos, com margem de 5 px. O erro geral também é registrado.

Não há informação dos pixels escondidos atrás das orelhas/cabeça na imagem
achatada. A luz oculta é uma estimativa suave; o preto sob os olhos e as sobras
nas bases das orelhas são preenchimentos locais. Esses preenchimentos ficam
ocultos na pose aprovada. A conferência cobre a **pose parada**; as rotações,
clips e frames intermediários devem ser conferidos na T3720. As peças também
contêm partes da transição de luz nas bordas: não são vetores rígidos.

Para reproduzir os recortes e as conferências:

```sh
python3 -m venv /tmp/kiwi-cat-camadas
/tmp/kiwi-cat-camadas/bin/pip install -r requirements.txt
/tmp/kiwi-cat-camadas/bin/python separar.py
```

Rode daqui. Não há API nem rede no `separar.py`; as dependências são somente
ferramentas de preparação de assets, fora do runtime. Pillow 13.0.0 e NumPy
2.5.4 foram usados na verificação original. O script não altera a fonte.
