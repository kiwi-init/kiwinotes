# O gato fantasma (T10727, direção do harry no #11071 e no #11076)

Substitui as candidatas esculpidas (`../candidatas/`), recusadas no #11067 porque fugiam da v2.

**Um campo só, num shader.**
- **O núcleo preto** é a máscara da própria v2 (`bake_sdf_v2.py`, depois do #11103). Ela é o núcleo escuro de
  `kiwi-cat-candidata-v2.png` pela luminância: o núcleo denso com menos de 26, crescendo até 52 só perto dele, com o
  arco fechado onde ele separa a orelha esquerda da cabeça. A máscara vira o campo de distância (512 × 640, em
  unidades do canvas de 2048 × 2560) e uma cópia desfocada dele, que é a que o halo lê.
- **A borda não é uma linha:** o preto se desfaz num halo que sai de dentro do corpo, no acabamento da referência 1
  (Bevel), com ruído lento.
- **A borda é macia em toda a volta**, num desfoque de cerca de 2–3% da largura, maior na cauda.
- **A cor** é um arco dentro da cabeça, que segue o crânio da orelha esquerda até a bochecha esquerda. É o mesmo halo
  mudando de tom: ciano por fora, azul e violeta, e rosa por dentro e na ponta da bochecha. Ele se apaga para a direita.
- **A névoa lavanda** é o anel largo e suave da v2 em volta do corpo todo, mais forte embaixo. Por dentro da borda há
  um brilho curto, como na referência 1.
- **Embaixo,** o corpo vira fiapos lisos que afundam devagar, sem granulado.
- **Ele flutua** 7 px a 120 px, num ciclo de 3,6 s, com a cauda atrasada. O halo respira junto.
- **No claro,** o mesmo fantasma invertido: o núcleo claro e o halo escuro suave.
- **Os olhos** continuam os do código, em (803, 1279) e (1243, 1279).

**Protótipo:** `ghost.html`, em WebGL2. `ghost-shoot.ts` grava os quadros no WebKit headless, e `ghost-still.ts` grava
um quadro transparente para colar no hub. O módulo do app (`app/ui/kiwicat/shader.ts`) recebe isto depois da aprovação.

**Provas:**
- `fantasma-6s.mp4`: a v2 parada, o fantasma no escuro e no claro;
- `fantasma-120px.webp`: no hub, em 2x e em 1x;
- `quadro.webp`: um quadro do vídeo.
