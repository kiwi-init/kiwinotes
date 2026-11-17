# KiwiCat & Kiwi Notes — Arquitetura da Intro & Guia Técnico para IA

Este documento descreve em detalhes o conceito, a stack tecnológica, todas as fases frame a frame, as métricas matemáticas e a **separação arquitetural exata entre o mascote KiwiCat e a moldura que se transforma na janela do aplicativo Kiwi Notes**. Foi estruturado especificamente para servir como contexto completo para o agente de IA responsável por implementar e continuar o **Kiwi Notes**.

---

## 1. Conceito & Identidade Visual

- **Aplicativo:** **Kiwi Notes**
- **Mascote:** **KiwiCat** (o nome oficial do personagem na abertura do Kiwi Notes; arquivos históricos anteriores referenciavam *"Byte KiwiCat"* ou *"QENit"* — para o **Kiwi Notes**, adote sempre **KiwiCat**).
- **Preset de Referência:** `KiwiCat Ver Final Perfect`
- **Narrativa Central (sem textos na intro):**
  1. Em um squircle escuro minimalista estilo macOS (`#090A0E`), o **KiwiCat** nasce do nada como uma pequena esfera uniforme e orgânica de névoa escura (`#050507`), condensando em assinatura líquida até formar seu corpo deitado/dormindo com cabeça inclinada para baixo.
  2. Ele desperta como um gato real: primeiro surgem as **orelhas ainda abaixadas dormindo** que dão espasmos independentes (direita depois esquerda) ao levantar; em seguida, com a cabeça levantando em um leve titubeio de despertar, **os olhos aparecem semicerrados e dão duas piscadinhas sonolentas**; por último surge a **boquinha `:3`**.
  3. Já desperto, o arco iridescente (**Ciano `#22D3EE` → Índigo `#6366F1` → Magenta `#EC4899`**) ganha velocidade e envolve toda a silhueta.
  4. O **KiwiCat** dá uma reação feliz com olhos em arco `^ ^`, boquinha alegre e três faíscas comic de 4 pontas.
  5. **Pouso & Passagem de Bastão:** apenas o **KiwiCat** se dissolve suavemente em `3,96 s – 4,30 s`, deixando a **moldura squircle** sozinha no palco.
  6. **Transformação na Janela do Kiwi Notes:** a moldura squircle (`320×320`) se estica fluidamente até as proporções de uma janela do app (`640×370` no preview, ou janela real do **Kiwi Notes** em produção), revela a barra superior e renderiza o workspace do aplicativo.

---

## 2. Separação Arquitetural: KiwiCat vs. Moldura que Vira o App Kiwi Notes

> **Resposta direta para a engenharia / IA do Kiwi Notes:**
> **Sim — conceitual e estruturalmente são DUAS peças diferentes acopladas apenas por timing na linha do tempo.**

Manter essas duas peças separadas no DOM/React garante duas vitórias críticas:
1. **Zero distorção óptica no KiwiCat:** Quando a moldura se estica horizontal e verticalmente (`320×320 → 640×370` ou tela cheia), o container interno do KiwiCat **nunca altera seu aspect ratio** (`width === height === size`). Se o canvas WebGL2 esticasse junto com a janela, o raymarching SDF achataria o gato.
2. **Desacoplamento limpo entre Splash e App Real:** A moldura externa é, na verdade, a **casca (Shell) da própria janela do Kiwi Notes**. Durante os primeiros `4,30 s`, ela segura um container squircle pequeno; em `4,28 s – 4,92 s`, ela assume a geometria real do app.

### Diagrama de Camadas DOM (como implementado em `src/KiwiIntroStage.tsx`)

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ PEÇA 2: MOLDURA / APP SHELL (#stage / div raiz de KiwiIntroStage)       │
│  • Controlada por: stageOpacity, stageScale, windowExpand               │
│  • Geometria: 320×320 (border-radius: 24%) → 640×370 (border-radius: 16)│
│  • Fundo: KIWI_INTRO_CONFIG.surfaceBg (#090A0E)                         │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │ PEÇA 1: MASCOTE KIWICAT (#cat-wrap — caixa 1:1 fixa ao centro)  │   │
│   │  • Controlada por: pose.mascotOpacity (fade 3.96s → 4.30s)      │   │
│   │  • NÃO estica com windowExpand (sempre left:50% top:50% size×size)│ │
│   │                                                                 │   │
│   │   ├── .fog-layer (z-index: 1)                                   │   │
│   │   │     • Canvas WebGL2 (raymarching SDF + evalAurora)          │   │
│   │   │     • Máscara Radial CSS (--fog-core, --fog-mid, --fog-mist)│   │
│   │   └── .face-layer (z-index: 10)                                 │   │
│   │         • Canvas 2D Flat-3D (orelhas separadas, olhos, boca)    │   │
│   │         • SVG #sparkles (3 estrelas 4-pontas comic)             │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │ CONTEÚDO DO KIWI NOTES (#app-win / React children reais)        │   │
│   │  • Barra superior macOS: pose.windowChromeOpacity (4.62s–4.94s) │   │
│   │  • Workspace Kiwi Notes: pose.appContentOpacity   (4.80s–5.26s) │   │
│   └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Como Integrar Isso no Aplicativo Real **Kiwi Notes**

A IA do **Kiwi Notes** tem **3 formas oficiais** de usar esse código, dependendo da arquitetura do app desktop/web:

#### Opção A — *Splash Shell Integrado em React (Recomendado para Web / Single-Window Electron / Tauri)*
Em vez de abrir e fechar duas janelas nativas diferentes, use `KiwiIntroStage` (ou uma versão derivada dele chamada `KiwiNotesLaunchShell`) envolvendo o root do **Kiwi Notes**:
- Substitua o bloco simulado `{/* Janela do App simulada ... */}` em `src/KiwiIntroStage.tsx` pelos seus componentes reais do **Kiwi Notes** (sidebar de cadernos, lista de notas, editor Markdown).
- Passe `targetW` e `targetH` iguais ao tamanho real da janela (`window.innerWidth` / `window.innerHeight`, ou `100%` interpolado).
- Quando `pose.done === true` (aos `5,35 s`), desmonte apenas a `#cat-wrap` (que já está com `mascotOpacity: 0`, inclusive o loop WebGL2 já para automaticamente quando `pose.mascotOpacity <= 0.004`) e deixe apenas o app **Kiwi Notes** ativo no DOM sem nenhum custo de GPU.

#### Opção B — *Janela Nativa Transparente com Redimensionamento Real (Electron / Tauri / Swift WKWebView)*
Se o **Kiwi Notes** usar uma `BrowserWindow` transparente sem borda (`transparent: true`, `frame: false`) sobre o desktop do macOS:
1. A janela nativa pode abrir já em `680×420` (ou maior, transparente ao redor), enquanto o `#stage` no centro mede `320×320` durante os primeiros `4,28 s` — visualmente para o usuário parece um ícone flutuante `320×320` no meio da tela!
2. Em `4,28 s – 4,92 s`, o `#stage` se estica dentro dessa janela transparente até preencher a geometria final do **Kiwi Notes** (sem precisar lutar com travamentos de `window.setBounds()` do sistema operacional a 60fps).
3. Quando `window.engine.intro.done()` disparar (aos `5,35 s` ou no clique para pular), troque/revele a janela principal interativa na mesma posição exata, ou remova `transparent`/habilite o workspace completo na própria janela.

#### Opção C — *Modo Mascote Flutuante Sem Moldura (`showFrame = false`)*
- Passe `showFrame={false}` em `evaluateIntroPose` e `KiwiIntroStage` (ou use `build/intro-sem-moldura.html`).
- A moldura e a Fase 6 são desativadas automaticamente: a intro termina em `INTRO_CAT_DURATION = 4,40 s` com o **KiwiCat** fazendo fade-out diretamente sobre o fundo transparente.

---

## 3. Stack Tecnológica & Pipeline de Renderização

Zero bibliotecas 3D pesadas (sem Three.js, sem Lottie, sem vídeos MP4). Toda a intro pesa poucas dezenas de kilobytes e roda a 60–120fps:

1. **Timing & Coreografia Determinística (`src/kiwiIntroTimeline.ts` → `evaluateIntroPose`)**
   - Função pura `(rawTime, reducedMotion, skipStartedAt, showFrame) => IntroPose`.
   - Como **todo o estado visual deriva exclusivamente de `t`** (sem acumuladores físicos dependentes de frame anterior), é possível saltar instantaneamente para qualquer segundo (`?t=2.2`), arrastar a timeline, gerar quadros PNG offscreen (`renderIntroSnapshotDataUrl`) e garantir sincronia perfeita entre a camada WebGL2, o Canvas 2D e o DOM/CSS.

2. **Camada `.fog-layer` — WebGL2 Raymarching SDF + Aurora (`src/kiwiRenderer.ts` → `FRAGMENT_SHADER_SRC`, `KiwiIntroWebGLEngine`)**
   - Shader GLSL ES 3.00 desenhando um triângulo full-screen (`VERTEX_SHADER_SRC`).
   - `mapSmokeBody(vec3 pw)`:
     - Calcula uma esfera uniforme `dUniform` (raio `0.43 * bScale`) **e** um corpo felino orgânico `dCat` formado por 3 lóbulos unidos com `smin` polinomial (`dOrb`, `dLobe1`, `dLobe2`, com compensação `uLagOffset` para inércia).
     - **Segredo do surgimento limpo (sem formato de disco/OVNI):** `float bodyMorph = smoothstep(0.32, 0.85, bScale); float dMass = mix(dUniform, dCat, bodyMorph);` — enquanto `bScale` é pequeno (`< 0.32`), ele é 100% circular/esférico; só quando ganha volume corporal é que os lóbulos inferiores se diferenciam.
     - Distorção líquida orgânica combinando `fbm3` (Fractal Brownian Motion 3D) e `liquidWave` senoidal.
   - `evalAurora(p, n, viewDir, dSmoke)`:
     - Projeta o gradiente prismático `uPrismStart (#22D3EE) → uPrismMid (#6366F1) → uPrismEnd (#EC4899)` ao longo da borda Fresnel e do envelope da névoa, orbitando via `uOrbitPhase` no modo `uAuraStyle = 0` (`borda-suave`).
   - Fallback Canvas 2D: caso WebGL2 esteja indisponível, `renderKiwiIntroFrame` desenha um gradiente radial estilizado mantendo a coreografia.
   - **Máscara Radial CSS Dinâmica:** aplicada sobre `.fog-layer` usando `--fog-core`, `--fog-mid`, `--fog-mist` e `--fog-edge` para garantir bordas infinitamente suaves sem corte duro no canvas quadrado.

3. **Camada `.face-layer` — Canvas 2D com Projeção Perspectiva 3D + SVG Comic (`src/kiwiRenderer.ts`)**
   - Compartilha os exatos parâmetros de câmera com o shader WebGL2: `CAM_Z = 3.1`, `FOCAL_LEN = 2.45`.
   - `rotatePoint3D` + `project3DPointToCanvas` + `project3DFacePoint` aplicam `yaw`, `pitch`, `roll`, `headOffsetX` e `headOffsetY` em coordenadas 3D reais antes de projetar para 2D.
   - **Orelhas Flat-3D Separadas (`drawSeparateFlat3DEars`):** renderizadas individualmente em um `earBufferCanvas` offscreen com `shadowBlur` suave e recorte gradual (`destination-in`) na raiz da cabeça, permitindo que:
     - as orelhas fiquem **abaixadas/dobradas dormindo** quando `earPerk < 0` (`droop = max(0, -perk)` atingindo `-1.35` na Fase 2);
     - a aurora da cabeça deslize livremente entre as duas orelhas sem borda rígida.
   - **Olhos & Boca 3D:**
     - Olhos fechados dormindo/piscando quando `eyeOpenY < 0.22` (arco voltado para baixo);
     - Olhos abertos em elipse `#FFFFFF` escalando com `eyeOpenY`;
     - Olhos felizes `^ ^` quando `happyArc > 0.45`;
     - Boquinha `:3` em `#FFFFFF` que vira sorriso aberto rosa (`accentColor: #F472B6`) quando `mouthCheer > 0.55`.
   - **Faíscas Comic (`#sparkles` SVG):** 3 estrelas de 4 pontas no `viewBox="0 0 240 240"` com `sparkleOpacity`, `sparkleScale` e `sparkleRotationDeg`.

---

## 4. Todas as 6 Fases da Coreografia (Frame a Frame & Referências no Código)

| # | ID | Nome na Timeline | Janela (s) | Duração | Peça em Cena |
| :-: | :--- | :--- | :---: | :---: | :--- |
| 1 | `condense` | **Névoa & Condensação** | `0.00 – 1.40` | `1.40 s` | Moldura squircle + Corpo do KiwiCat surgindo |
| 2 | `waking` | **Despertar & Orelhas** | `1.40 – 2.60` | `1.20 s` | Orelhas → Olhos piscando → Boca `:3` + Titubeio |
| 3 | `aurora` | **Foco & Aurora** | `2.60 – 3.18` | `0.58 s` | KiwiCat desperto + aceleração do arco prismático |
| 4 | `happy` | **Reação Feliz** | `3.18 – 3.92` | `0.74 s` | Olhos `^ ^` + salto + boca rosa + faíscas comic |
| 5 | `exit` | **Pouso do Kiwi Cat** | `3.92 – 4.34` | `0.42 s` | Apenas o KiwiCat recolhe e some (`mascotOpacity → 0`) |
| 6 | `expand` | **Janela & App** | `4.34 – 5.35` | `1.01 s` | Moldura sozinha estica e renderiza o **Kiwi Notes** |

*(Quando `showFrame = false`, a Fase 6 é omitida e a Fase 5 termina em `INTRO_CAT_DURATION = 4.40 s` com fade-out de `stageOpacity` entre `4.02 s – 4.40 s`.)*

### Detalhamento Técnico de Cada Fase (com Referências Exatas)

#### Fase 1: `condense` — Névoa & Condensação (`0.00 s – 1.40 s`)
- **O que acontece visualmente:** A moldura squircle escura surge em fade-in ultrarrápido (`0.00–0.16 s`) e leve zoom-in (`0.96 → 1.0`). No centro, sem partículas soltas, nasce uma pequena bolinha circular perfeitamente uniforme de névoa escura (`bodyScale: 0.14`) que cresce com assinatura líquida até formar o corpo compacto do KiwiCat dormindo olhando para baixo. Nos últimos instantes (`1.24 s`), as pontas das orelhas começam a despontar bem discretamente ainda abaixadas.
- **Curvas & Variáveis (`evaluateIntroPose` em `kiwiIntroTimeline.ts`):**
  - `entryFade = smoothstep(0.0, 0.16, t)` · `stageScale = lerp(0.96, 1.0, easeOutCubic(windowCurve(t, 0.0, 0.35)))`
  - `orbGrow = easeInOutCubic(windowCurve(t, 0.0, 1.34))`
  - `bodyScale` sobe de `0.14` até `0.89`
  - `softness` reduz de `0.46 → 0.18` (névoa inicialmente bem difusa vai ganhando contorno sólido)
  - `maskBloom` expande os stops da máscara radial CSS (`fogCore 16% → 44%`, `fogEdge 74% → 97%`)
  - `earAppear` inicia em `1.24 s`, `eyeAppear = 0`, `mouthAppear = 0`
- **Referência no Shader (`kiwiRenderer.ts` → `mapSmokeBody`):** `bodyMorph = smoothstep(0.32, 0.85, bScale)` garante a silhueta esférica pura no começo antes da transição para `dCat`.

#### Fase 2: `waking` — Despertar & Orelhas (`1.40 s – 2.60 s`)
- **O que acontece visualmente:** Um despertar em cascata orgânica, exatamente como um gato acordando:
  1. **Orelhas primeiro (`1.24–2.38 s`):** surgem abaixadas/dobradas (`earPerk: -1.35`), dão um espasmo independente na orelha direita (`twitchR`, `1.44–1.72 s`), depois na orelha esquerda (`twitchL`, `1.66–1.96 s`), enquanto erguem até `+0.88` com um leve toque alerta no fim (`alertSnap`, `2.24–2.58 s`).
  2. **Cabeça levantando com titubeio (`1.45–2.42 s`):** o KiwiCat sai da postura de cabeça baixa dormindo (`pitch: -0.26`, `headOffsetY: -0.072`, `roll: -0.10`) e ergue o olhar até o neutro, passando por um pequeno balanço/titubeio lateral (`wobbleEnv` em `1.82–2.36 s` com `sin((t - 1.82) * 26)`).
  3. **Olhos depois das orelhas (`1.70–2.40 s`):** aparecem ainda fechados (`eyeOpenY: 0.08`), abrem parcialmente e executam **duas piscadinhas sonolentas** (`blink1` em `1.88–2.04 s` e `blink2` em `2.12–2.28 s`) antes de fixar abertos.
  4. **Boquinha `:3` por último (`2.08–2.34 s`):** consolida a expressão calma e desperta.
- **Referências no Código:**
  - Timeline: `earAppear`, `eyeAppear`, `mouthAppear`, `baseEarLift`, `twitchR`, `twitchL`, `wobbleEnv`, `sleepyOpen1/2`, `blink1/2` em `kiwiIntroTimeline.ts`.
  - Renderer: `drawSeparateFlat3DEars` (variável `droop = Math.max(0, -earPerk)` para dobrar as orelhas) e `drawEye` (`eyeOpenY < 0.22`) em `kiwiRenderer.ts`.

#### Fase 3: `aurora` — Foco & Aurora (`2.60 s – 3.18 s`)
- **O que acontece visualmente:** Com o corpo completo, olhos abertos (`eyeScale ~ 1.06`) e calda/lóbulos com inércia suave (`tailStretch ~ 0.26`), o feixe colorido prismático acelera a órbita ao redor do contorno enquanto a cabeça faz um micro ajuste de foco frontal (`yaw` corrige em `2.60–3.12 s`).
- **Curvas & Variáveis:**
  - `orbitAngle = 0.4 + t * 0.95 + easeInOutCubic(windowCurve(t, 2.4, 3.38)) * 1.45`
  - `auraIntensity` estabiliza no pico de `95%`
  - Uniform WebGL `uOrbitPhase` alimenta `sweepDir` em `evalAurora`.

#### Fase 4: `happy` — Reação Feliz (`3.18 s – 3.92 s`)
- **O que acontece visualmente:** Momento de boas-vindas cheio de carisma: o corpo dá um pequeno pulo elástico (`happyBounce`), inclina levemente a cabeça (`happyTilt`), os olhos viram arcos sorridentes `^ ^`, a boquinha abre em sorriso rosa (`#F472B6`), a aura recebe pulso (`uAudio = pose.happyArc * 0.35`) e três estrelas comic de 4 pontas giram e saltam ao redor do mascote.
- **Curvas & Variáveis:**
  - `happyBounce = pulseBell(t, 3.2, 3.7) * 0.07`
  - `happyArc = smoothstep(3.16, 3.36, t) * (1 - smoothstep(3.88, 4.12, t))` (dispara modo `^ ^` quando `> 0.45`)
  - `mouthCheer` atinge `1.0` (dispara sorriso rosa quando `> 0.55`)
  - `sparkleOpacity`, `sparkleScale` (`easeOutBack(3.2..3.46)` + pulsação `sin((t-3.2)*14)`) e `sparkleRotationDeg = (t - 3.2) * 14`.

#### Fase 5: `exit` — Pouso do Kiwi Cat (`3.92 s – 4.34 s`)
- **O que acontece visualmente:** O sorriso fecha suavemente, a aura recua (`settle * 22`), o corpo recolhe um pouco (`settle * 0.08`) e **apenas o KiwiCat desaparece** entre `3.96 s – 4.30 s`, deixando a moldura squircle limpa esperando a transição para o app.
- **Curvas & Variáveis:**
  - `settle = smoothstep(3.9, 4.3, t)`
  - `mascotOpacity = (1 - easeInOutCubic(windowCurve(t, 3.96, 4.3))) * skipFade` (quando `showFrame = true`)
  - Em `KiwiIntroStage.tsx`: quando `pose.mascotOpacity <= 0.004`, o `useEffect` encerra as chamadas ao motor WebGL2/Canvas 2D automaticamente.

#### Fase 6: `expand` — Janela & App (`4.34 s – 5.35 s`) *(exclusiva de `showFrame = true`)*
- **O que acontece visualmente:** A moldura squircle sozinha começa a se esticar antes mesmo do último micro-frame do gato sumir (`4.28 s – 4.92 s`), transformando suas proporções de `320×320` (`border-radius: 76.8px`) para uma janela widescreen macOS `640×370` (`border-radius: 16px`). Em `4.62 s – 4.94 s` surge a barra superior com os 3 botões de semáforo, e em `4.80 s – 5.26 s` o conteúdo interno sobe `10px → 0px` em fade-in concluindo a abertura em `5.35 s`.
- **Curvas & Variáveis:**
  - `windowExpand = easeInOutCubic(windowCurve(t, 4.28, 4.92))`
  - `windowChromeOpacity = smoothstep(4.62, 4.94, t) * skipFade`
  - `appContentOpacity = smoothstep(4.8, 5.26, t) * skipFade`
  - Geometria em `KiwiIntroStage.tsx`:
    - `stageWidth = size + (640 - size) * expand`
    - `stageHeight = size + (370 - size) * expand`
    - `stageRadiusPx = (size * 0.24) + (16 - size * 0.24) * expand`

#### Modo Reduzir Movimento (`reducedMotion = true`, `1.50 s`)
- Ativado por `prefers-reduced-motion: reduce` no sistema ou por `localStorage['kn-appearance'] = '{"motion":"reduced"}'`.
- Renderiza o **KiwiCat** já em pose calma e estável (`bodyScale: 0.93`, `earPerk: 0.65`, `eyeOpenY: 1.02`, sem piscadas nem saltos).
- Com moldura: o mascote faz fade-out em `0.85–1.12 s`, a moldura expande em `1.00–1.38 s` e o app **Kiwi Notes** abre em `1.50 s`.

---

## 5. Tokens, Cores & Parâmetros de Câmera (`KIWI_INTRO_CONFIG`)

| Parâmetro | Valor | Uso |
| :--- | :--- | :--- |
| `surfaceBg` | `#090A0E` | Fundo da moldura squircle e da janela expandida |
| `bodyColor` | `#050507` | Tinta escura do corpo e das orelhas do KiwiCat |
| `prismStops[0]` | `#22D3EE` | Ciano da borda externa da aurora |
| `prismStops[1]` | `#6366F1` | Índigo intermediário da aurora |
| `prismStops[2]` | `#EC4899` | Magenta interno da aurora |
| `accentColor` | `#F472B6` | Rosa do sorriso aberto na Reação Feliz |
| `eyeColor` | `#FFFFFF` | Olhos 3D, boca `:3` e faíscas comic |
| `earStyle / earScale` | `"compactas" / 0.75` | Silhueta fiel ao preset `KiwiCat Ver Final Perfect` |
| `bodyWidth` | `1.06` | Fator horizontal do corpo e distância das orelhas |
| `eyeStyle / eyeScale / eyeSpacing` | `"circulares" / 1.05 / 1.0` | Geometria dos olhos |
| `auraStyle / prismSpread` | `"borda-suave" / 78` | Arco orbital contínuo |
| `CAM_Z / FOCAL_LEN` | `3.1 / 2.45` | Câmera compartilhada entre WebGL2 e Canvas 2D |

---

## 6. Contratos de Runtime no HTML Standalone (`build/intro-*.html`)

1. **Parâmetro `?t=<segundos>`:** Congela a animação exatamente no instante informado sem avançar o loop (`frozenT`), ideal para screenshots automatizados (Playwright/WebKit) e conferência de prancha.
2. **Clique ou Tecla de Atalho para Pular:** Qualquer clique no `#stage` (ou `Enter`/`Espaço`/`Escape` no React) aciona `skipStartedAt`, aplicando `skipFade` suave de `0,26 s` e encerrando a intro imediatamente.
3. **Bridge Nativa `window.engine`:**
   - Ao inicializar: chama `window.engine?.ready?.()`
   - Ao terminar (normalmente em `5,35 s`, reduzido em `1,50 s` ou após skip): adiciona classe `body.done` e dispara `window.engine?.intro?.done?.()` + `window.engine?.send?.('intro.done')`.
