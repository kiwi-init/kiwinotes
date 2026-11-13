# Rodadas de crítica — lote 1 (T10727)

**Ferramenta:** sem gerador de imagem (o Codex saiu, #10981), a arte sai em código (`../render/render.py`, Python com
numpy/scipy/Pillow, num venv local).
- **A forma:** cada massa (corpo, cabeça, orelhas) tem um campo de altura feito da sua silhueta, e há uma luz principal
  de cima e da esquerda.
- **Os tons, por massa:** a luz, o meio-tom, a sombra própria e a oclusão nos encaixes (o queixo, a base das orelhas,
  a volta dos olhos e o chão).
- **O aro:** uma faixa embutida que segue o crânio, com um sulco nas bordas.

**Entradas:**
- os parâmetros de cada candidata (`../candidatas/r*/X.json`);
- o canvas da v2 (2048 × 2560);
- os olhos do código, em (803, 1279) e (1243, 1279), com raio 68.

Nenhuma imagem de referência entrou: só o briefing em texto do lead (#10795).

**Folhas:**
- **Tamanho cheio:** a render em s = 0,25 (512 × 640), no escuro e no claro.
- **120 px:** o gato a 96 × 120 CSS px, no canto do hub de verdade, sem o agente (`../render/hub-bg.ts`, WebKit
  headless). Em 2x e em 1x.

**Resolução:** a render é vetorial-procedural, então sai em qualquer escala. A final sai em s = 1,6 (3277 × 4096),
nativa, sem upscale, depois da escolha.

**Notas (1–10):** acabamento, volume, leitura a 120 px, fidelidade ao gato e ausência de neon/brilho.

## Rodada 1 (`../candidatas/r1/folha.webp`)

| | Acab. | Volume | 120 px | Fidel. | Neon |
|---|---|---|---|---|---|
| A, cabeça quadrada-macia, aro inclinado | 7 | 7 | 8 | 7 | 9 |
| B, cabeça redonda, aro em coroa | 7 | 7 | 8 | 6 | 8 |
| C, perto da v2, orelhas abertas, aro diagonal | 7 | 7 | 8 | 7 | 9 |

**Os 3 piores problemas (os mesmos nas três):**
1. **A cabeça e o corpo leem como duas peças empilhadas** (um boneco de neve). A v2 é uma massa só, em sino.
2. **O aro é fino demais** e lê como um risco, não como uma incrustação. No B, em coroa simétrica, ele parece uma
   tiara, que o briefing veta.
3. **O corpo tem pouco volume:** a luz quase não vira nas laterais, e o lado da sombra não aparece.

## Rodada 2 (`../candidatas/r2/folha.webp`)

**Correções:**
- **Uma massa só:** a união da cabeça com o corpo, com a cabeça como um volume sobre ela e um vinco macio no queixo.
- **O aro:** largo (72–74), com um sulco nas bordas. No B ele ficou levemente inclinado e assimétrico, para não parecer
  tiara.
- **A luz** vem mais da esquerda (−0,70, −0,72, 0,55), para virar o volume.

**O que apareceu ao conferir, e foi corrigido na mesma rodada (2b):**
- **Uma costura na cabeça:** a borda do elipsoide de volume tinha inclinação infinita. O elipsoide agora é suavizado.
- **O aro encostava na borda:** agora ele some antes da silhueta e fica sempre dentro da cabeça.
- **O queixo era um degrau duro.**

| | Acab. | Volume | 120 px | Fidel. | Neon |
|---|---|---|---|---|---|
| A2 | 8 | 8 | 8 | 7 | 9 |
| B2 | 8 | 8 | 8 | 7 | 9 |
| C2 | 7 | 8 | 8 | 8 | 9 |

**Os 3 piores problemas:**
1. **Um calombo de focinho** entre os olhos, no A2 e no B2: a cara lê comprida, de cavalo, e não de gato.
2. **O aro do C2** é um crescente fino e diagonal: lê como um corte ou uma marca de garra.
3. **No escuro, o lado da sombra vira preto puro** (no C2, metade da cara), e o volume some ali.

## Rodada 3 (`../candidatas/r3/folha.webp`, `cabecas.webp`, `120px.webp`)

**Correções:**
- **Sem o focinho:** o volume da cabeça subiu para a testa, e as bochechas são duas massas abaixo e fora dos olhos.
- **O aro:** mais largo (88), com as pontas menos agudas e o sulco mais fundo. O do C ficou menos inclinado (−18°) e
  segue o crânio.
- **O piso do ambiente** passou para 0,16, e a sombra do escuro fica grafite, não preto puro.

| | Acab. | Volume | 120 px | Fidel. | Neon |
|---|---|---|---|---|---|
| A3 | 8 | 8 | 9 | 8 | 9 |
| B3 | 8 | 8 | 9 | 8 | 9 |
| C3 | 8 | 8 | 9 | 8 | 9 |

**A 120 px:** a silhueta e os olhos leem nos dois fundos. O escuro fica preto, não cinza nem lavado, e o aro aparece
como uma faixa.

**O que ainda segura o 9:**
- **A3:** sobra um resto de crista no nariz, no claro.
- **B3:** o aro é quase horizontal, e na testa pode ler como uma sobrancelha.
- **C3:** o lado direito, no escuro, é bem fechado.
- **Nos três:** as orelhas são triângulos simples. Falta a dobra na base do plano de dentro.

Esses pontos vão para a rodada com o lead.
