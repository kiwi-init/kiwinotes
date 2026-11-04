# Intro do Kiwi Notes

Specs #2078 e #3133: prisma Kiwi Init → círculo de vidro → Kiwi-cat v2.
O protótipo `intro.html` e a janela do app em `app/ui/intro/` vêm dos mesmos fontes.
Um clique pula; `intro.done` avisa o engine uma vez. Movimento reduzido mostra a pose final.

## Fontes e geração

- `intro.template.html`: palco, prisma e emenda; `intro.js`: linha do tempo e poses WAAPI.
- `../kiwi-cat/preparar-intro.py`: prepara bitmaps da prancha T3747 aprovada (#3799).
- `gerar.ts`: embute os WebP e a máscara, escreve o protótipo e a janela do app.
  O app usa script externo por causa da CSP; não depende de rede.

```sh
# Pillow/NumPy: versões em ../kiwi-cat/gerada/requirements.txt, num venv.
KIWI_IMAGE_PYTHON=/caminho/do/venv/bin/python bun docs/brand/kiwi-cat/camadas.ts
bun docs/brand/intro/gerar.ts
```

A preparação usa as funções de `../kiwi-cat/prancha.py`. Não altera a v2 aprovada nem os quadros de referência.
A foto é reduzida para 819×1024 e colocada em (102,−82) no palco 1024; círculo (512,430), raio 225.
Os bitmaps são recortados aos pixels úteis, conservando suas coordenadas e pivôs no palco.
São 11 texturas lossless, cerca de 1,1 MB antes de base64. O app recebe imagens, HTML/CSS e JS.

## O gato (T3720)

A emenda ocorre aos 3,7 s; a animação do gato dura 8 s, com poses amostradas a 60 Hz (f0–f480).
A pose final v2 e a geometria vêm da T3747. Após #4031/#4035, as poses intermediárias foram revistas: cabeça arredondada, orelhas mais lentas e formação contínua. O conjunto deriva suavemente, sem deformar o corpo.
O círculo é a própria cabeça (#4063): a mesma camada permanece opaca e muda de forma. As antigas camadas de cabeça intermediária e fundo ficam ocultas. As orelhas giram pelos mesmos pivôs. A aura é uma só (#4071): o anel nasce em f6–48, gira até parar em f96 e escorre até virar o halo do corpo em f96–440. São 24 poses assadas por transporte ótimo (`../kiwi-cat/aura/`), desenhadas num canvas de 512, duas por frame (`copy` + `lighter`, a mistura linear exata). Ela substitui o `luz-anel`, o `luz-cabeca` e o brilho do corpo.
Os olhos são dois círculos vetoriais, com crescimento e piscadas por olho.
O brilho do corpo é a própria aura. A máscara móvel saiu da animação, porque ela provocava repintura e limitava a fluidez.
A cena final acende em f436–476 como uma composição opaca sobre a inicial, quando a aura já chegou no halo final: nunca há duas névoas diferentes na tela. Os retângulos compensadores das seis peças originais não aparecem separadamente.
A preparação verifica a recomposição final dos WebP codificados (erro máximo ≤2/255).
Nada é borrado ao vivo. O Rive saiu do runtime e das dependências nesta task.

- `?t=3.7`: f0 congelado; `?t=11.7`: f480, sem substituir o estado da animação.
- `?gato=2`: duas vezes a velocidade do gato.
- `?medir=1`: intervalos de `requestAnimationFrame` em `window.__frames`.

## Conferir sem abrir o app

Pegue `kiwi lock bench` antes. São apenas WebKit headless e dados sintéticos.

```sh
# Capturas reais normalizadas apenas ao palco 1024, referência, diferenças e relatório.
KIWI_IMAGE_PYTHON=/caminho/do/venv/bin/python bun docs/brand/intro/comparar.ts /tmp/kiwi-comparacao
# Vídeo só do gato; --sem-video mede sem o custo da gravação.
bun docs/brand/intro/gravar-gato.ts /tmp/kiwi-video
bun docs/brand/intro/gravar-gato.ts /tmp/kiwi-medida --sem-video
# Prancha no tamanho de janela, incluindo a emenda.
bun docs/brand/intro/frames.ts /tmp/kiwi-frames
```

`gravar-gato.ts` descarta o começo branco da gravação e codifica o vídeo do gato.
Com o `ffmpeg` do sistema, sai `gato.mp4`. Num Mac sem ele (o do jow, por exemplo), o script usa o que o Playwright já baixa, em `~/Library/Caches/ms-playwright/ffmpeg-*/ffmpeg-mac`, e sai `gato.webm` já cortado, em VP9.
Esse ffmpeg só lê webm/mjpeg, só escreve png e VP9, e a entrada vai por `-i file:<caminho>`: `-` e `pipe:` não funcionam.
Para conferir o caminho sem o `ffmpeg` do sistema, rode com um `PATH` sem o Homebrew:

```sh
env PATH=/usr/bin:/bin:/usr/sbin:/sbin bun docs/brand/intro/gravar-gato.ts /tmp/kiwi-video-sem-ffmpeg
```

`comparar.ts` captura os dez frames da prancha mais f126/f190 contra o renderer antigo. Seus limites das poses intermediárias são históricos e devem falhar para a nova direção do #4031; não são um critério de aprovação do movimento. `verificacao-gato.json` guarda somente a comparação anterior, identificada pelo hash do HTML daquela versão.
`comparar.py` inclui olhos e orelhas na diferença; exclui apenas a borda arredondada do palco.
Os olhos vetoriais e a rasterização/alpha do navegador podem diferir do Pillow.
A amostragem da linha do tempo a 60 Hz não garante uma taxa de exibição de 60 fps: a medida headless é registrada separadamente.

Para verificar a janela com CSP e engine:

```sh
cd app
bun run cli start --data /tmp/kiwi-intro-test --no-helper
bun run cli ui intro --data /tmp/kiwi-intro-test --script scripts/ui-scripts/intro-fim.json
bun run cli ui intro --data /tmp/kiwi-intro-test --motion --script scripts/ui-scripts/intro-pular.json
bun run cli stop --data /tmp/kiwi-intro-test
```

Os relatórios devem ter `ready:true`, `intro.done:1` e nenhuma ocorrência em `problems`, `blocked` ou `clipboard`.
O desenho e os tempos do prisma são revistos separadamente na T3898.
