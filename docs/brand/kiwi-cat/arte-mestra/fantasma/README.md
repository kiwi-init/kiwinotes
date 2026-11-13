# O gato fantasma (T10727, direção do harry no #11071 e no #11076)

Substitui as candidatas esculpidas (`../candidatas/`), recusadas no #11067 porque fugiam da v2.

**Um campo só, num shader.**
- **O núcleo preto** é a silhueta da v2, calcada à mão: `ghost_shape.py`, com o contorno sobre a v2 para conferir. Ela
  vira um campo de distância (`bake_sdf.py`, 512 × 640, em unidades do canvas de 2048 × 2560).
- **A borda não é uma linha:** o preto se desfaz num halo que sai de dentro do corpo, no acabamento da referência 1
  (Bevel), com ruído lento.
- **A cor no alto da cabeça** é o mesmo halo puxando para ciano, azul e lilás, e ela se apaga para os lados e para o
  corpo.
- **Embaixo,** o corpo vira fiapos que afundam devagar.
- **Ele flutua** 7 px a 120 px, num ciclo de 3,6 s, com a cauda atrasada. O halo respira junto.
- **No claro,** o mesmo fantasma invertido: o núcleo claro e o halo escuro suave.
- **Os olhos** continuam os do código, em (803, 1279) e (1243, 1279).

**Protótipo:** `ghost.html`, em WebGL2. `ghost-shoot.ts` grava os quadros no WebKit headless, e `ghost-still.ts` grava
um quadro transparente para colar no hub. O módulo do app (`app/ui/kiwicat/shader.ts`) recebe isto depois da aprovação.

**Provas:**
- `fantasma-6s.mp4`: a v2 parada, o fantasma no escuro e no claro;
- `fantasma-120px.webp`: no hub, em 2x e em 1x;
- `quadro.webp`: um quadro do vídeo.
