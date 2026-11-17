# Byte Kiwi Cat — Arquitetura de Animação & Guia para Agentes de IA

Este documento descreve em detalhes a tecnologia, matemática visual, coreografia de estados, paletas de cores, distribuições de névoa, sistema de overlay por atalho (macOS) e presets salvos do **Byte Kiwi Cat**, permitindo que qualquer desenvolvedor ou agente de IA (Gemini, Claude Code, Cursor, etc.) use as opções incluídas no pacote e crie novas animações mantendo 100% de fidelidade visual.

---

## 1. Visão Geral da Arquitetura (Separação Estrita: `.fog-layer` z-1 + `.face-layer` z-10)

O componente **`ByteKiwiCat.tsx`** é **100% auto-contido** (apenas React como dependência) e isola em camadas DOM distintas os elementos fixos da névoa difusa para impedir qualquer distorção visual sobre olhos e orelhas:

1. **Camada `.fog-layer` (`z-index: 1`) — Névoa Volumétrica WebGL2 & Arco Orbital Aquarelado + Máscara Dinâmica**
   - Renderiza a nuvem amorfa de tinta escura (`#050507` com subtom índigo-ameixa `#1B0F2E`), lóbulos inferiores que balançam de forma independente por inércia (`lagX`, `lagY`) e borda profundamente difusa (`pow(smoothstep(...), 1.38)` + halo atmosférico).
   - A função `evalAurora` projeta um arco contínuo e sedoso com transição aquarelada (`magenta → azul cobalto → ciano`) sem ondulações elétricas de alta frequência, adaptando-se aos estilos `borda-suave` (Arco Orbital), `contorno-sutil` (diagonal), `halo-difuso` (dupla) e `nuvem-base` (cauda).
   - Uma **máscara radial CSS dinâmica** (`--fog-core`, `--fog-mid`, `--fog-mist`, `--fog-edge` + `opacity`) expande e contrai organicamente conforme o estado de voz (`dormindo`, `repouso`, `pensando`, `ouvindo`, `respondendo`).
2. **Camada `.face-layer` (`z-index: 10`) — Orelhas Separadas Flat-3D + Olhos 3D + Vetores SVG**
   - Totalmente isolada da névoa e da máscara radial: as duas orelhas são renderizadas como **peças separadas e independentes** (sem junção/testa rígida no meio, permitindo que a luz da aurora deslize livremente sobre o topo da cabeça e entre as orelhas) junto aos olhos (`#FFFFFF`) compartilhando a matriz de câmera (`CAM_Z=3.1`, `FOCAL_LEN=2.45`) em um `<canvas>` próprio, acompanhados pelos anéis acústicos e emotes em `<svg>`.

---

## 2. Escolhas Ativas do Usuário (Padrão em `DEFAULT_KIWI_CONFIG`)

- **Preset de personalidade ativo:** `KiwiCat Ver Final Perfect` (`custom-1794801995497`)
- **Estado inicial:** `respondendo`
- **Silhueta:** `earStyle="compactas"`, `earScale=0.75`, `bodyWidth=1.06`
- **Olhos:** `eyeStyle="circulares"`, `eyeScale=1.05`, `eyeSpacing=1`
- **Paleta escolhida:** `prisma-original` (Prisma Original) — corpo `#050507`, destaque `#F472B6`, visor `#0B1117`, névoa `[#22D3EE, #6366F1, #EC4899]`
- **Distribuição da cor na névoa escolhida:** `borda-suave` (Arco Orbital (MP4)), intensidade `95%`, difusão `78%`
- **Barra equalizadora no queixo:** `showChinEqualizer=false`
- **Balão de Fala HQ:** `text="Pronto para criar. Pode falar!"`, `color="#F472B6"`, `offset=(-56, -48)`
- **Animação de Overlay Mac escolhida (Fase 2):** `transition="materializacao-nevoa"` (Materialização Névoa), `position="bottom-right"` (Canto Inferior Direito), `entry=420ms`, `exit=280ms`, `bounce=68%`

---

## 3. Catálogo Completo Incluído no Pacote (`ByteKiwiCat.tsx` & `tokens.json`)

Todos os catálogos abaixo vêm exportados diretamente em `ByteKiwiCat.tsx` (`KIWI_COLOR_PALETTES`, `KIWI_AURA_STYLES`, `KIWI_OVERLAY_TRANSITIONS`, `KIWI_OVERLAY_POSITIONS`, `KIWI_PERSONALITY_PRESETS`) e marcados com `isSelected: true` na escolha favorita atual.

### Paletas de Cores (`KIWI_COLOR_PALETTES`)
| ID | Nome | Corpo | Destaque | Gradiente da Névoa | Descrição |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `prisma-original` | Prisma Original **(Selecionada)** | `#050507` | `#F472B6` | `#22D3EE → #6366F1 → #EC4899` | Ciano, índigo e magenta suaves na névoa atrás da silhueta escura |
| `kiwi-neon` | Kiwi Elétrico | `#050705` | `#A3E635` | `#A3E635 → #22D3EE → #10B981` | Chassi obsidiana com destaque verde-lima e aura ciano-esmeralda |
| `ambar-solar` | Âmbar Noturno | `#070505` | `#FB7185` | `#FBBF24 → #F97316 → #FB7185` | Calor coral e dourado para alertas de limite e foco calmo |
| `soul-claro` | Soul Mist · Claro (Ref.) | `#050507` | `#EC4899` | `#22D3EE → #3B82F6 → #EC4899` | Fundo branco fiel ao vídeo MP4 com tinta escura e fita ciano-azul-magenta |
| `nevoa-violeta` | Névoa Violeta | `#06050A` | `#C084FC` | `#38BDF8 → #A855F7 → #F472B6` | Atmosfera noturna roxo-azulada com contorno luminescente |

### Distribuição da Cor na Névoa (`KIWI_AURA_STYLES`)
| ID | Estilo | Comportamento Espacial das Plumas |
| :--- | :--- | :--- |
| `borda-suave` | Arco Orbital (MP4) **(Selecionada)** | Fita prismática que abraça o contorno e desliza continuamente em volta do mascote. |
| `contorno-sutil` | Crescente Diagonal (JPEG) | Fixa o arco ciano-índigo-rosa na curva inferior direita e pulsa com a voz. |
| `halo-difuso` | Aurora Dupla | Duas fitas iridescentes em lados opostos envolvendo toda a silhueta orgânica. |
| `nuvem-base` | Véu na Cauda | Concentra o brilho colorido abaixo do queixo e ao longo da cauda de fumaça. |

### Animações de Entrada e Saída do Overlay (`KIWI_OVERLAY_TRANSITIONS`)
| ID | Estilo | Comportamento |
| :--- | :--- | :--- |
| `auto-direcional` | Auto Direcional | Sai da borda/canto escolhido e materializa no centro com névoa |
| `materializacao-nevoa` | Materialização Névoa **(Escolhida)** | Surge condensando da névoa com desfoque suave em qualquer ponto |
| `salto-elastico` | Salto Elástico HQ | Pop expressivo estilo mangá com overshoot de escala ao pousar |
| `espreitar-borda` | Espreitar Rápido | Deslize ágil com inclinação de cabeça e saída imediata |

### Presets de Personalidade Salvos (`KIWI_PERSONALITY_PRESETS`)
| ID | Nome | Estado | Paleta / Névoa | Overlay (Transição / Posição) |
| :--- | :--- | :--- | :--- | :--- |
| `custom-1794801995497` | KiwiCat Ver Final Perfect **(Ativo / Favorito)** | `respondendo` | `prisma-original` / `borda-suave` | `materializacao-nevoa` (bottom-right) |
| `custom-1794801023987` | KiwiCat Quase final | `repouso` | `prisma-original` / `borda-suave` | `materializacao-nevoa` (bottom-right) |
| `preset-byte-kiwi-cat` | Byte Kiwi Cat · Soul Mist (Escuro) | `ouvindo` | `prisma-original` / `borda-suave` | `materializacao-nevoa` (bottom-right) |
| `preset-soul-reference-mp4` | Soul Mist · Referência MP4 (Claro) | `ouvindo` | `soul-claro` / `borda-suave` | `materializacao-nevoa` (bottom-right) |

---

## 4. Coreografia dos 5 Estados Conversacionais

Cada estado define alvos contínuos em `STATE_TARGETS`, interpolados suavemente com amortecimento controlado por `motionFluidity` (`100%`):

| Estado | Respiração | Olhar / Olhos | Orelhas & Cabeça | Reação Vocal |
| :--- | :--- | :--- | :--- | :--- |
| `repouso` | Lenta (`1.4`, amp `0.022`) | Centrado, piscadas duplas naturais | Neutra (`earPerk: 0`) | Boca `:3` suave |
| `ouvindo` | Atenta (`2.2`, amp `0.030`) | Dilatados (`1.11×`), foco atento | Orelhas erguidas (`earPerk: 1.0`), leve inclinação `+2.2°` | Equalizador reativo + LED verde esmeralda |
| `pensando` | Calma (`1.7`, amp `0.020`) | Desvio superior direito (`+5.5, -5.2`) | Balanço meditativo `-4.5°` | Varredura sequencial no dock + LED âmbar |
| `respondendo` | Enérgica (`3.1`, amp `0.036`) | Brilho ativo; fecha em arco feliz nos picos | Orelhas `0.75`, squash-and-stretch vertical | Boca abre/fecha + espectro de 5 bandas |
| `dormindo` | Profunda (`0.72`, amp `0.032`) | Arcos fechados (`eyeOpenY: 0.12`) | Orelhas relaxadas (`-0.65`), cabeça baixa `+5.5px` | Aura reduzida para `0.28` e LED em standby |

---

## 5. Sistema de Olhos & Emotes Comic/Mangá

Os emotes funcionam por cima dos estados usando `emote="auto" | "alerta" | "confuso" | "cansado" | "feliz" | "limite"`:

- **`alerta`**: dilatação dos olhos (`1.24×`) + ponto de exclamação `!` com traços de impacto.
- **`confuso`**: olhos assimétricos (`O ·`) + nuvem rabiscada flutuante.
- **`cansado`**: recorte de pálpebra via `<clipPath id="halfLidClip">` + gotas de suor e linhas laterais de suspiro.
- **`feliz`**: olhos em arco ascendente (`^ ^`) + faíscas de 4 pontas.
- **`limite`**: espiral comic acima da orelha direita (ideal para avisos de cota/limite).
- **Automáticos do estado**: `ouvindo` (arcos sonoros `))) `), `pensando` (pálpebras semicerradas + balão `[...]`), `dormindo` (`Z z`).

### Balão de Fala HQ (`KiwiSpeechBubble`)
- Pílula escura (`#07080B`) com borda `2px` e sombra sólida deslocada `0 4px 0`.
- Cauda curva em **peça única** cujo contorno de `2px` alinha exatamente ao centro da borda inferior da pílula, enquanto o preenchimento escuro apaga a linha de junção interna e a sombra sólida afunila na mesma ponta (sem dupla seta).
- Posicionamento relativo ao centro do gato via `(offsetX, offsetY)`; ao cruzar `offsetX > 120`, `tailSide` vira automaticamente para `'left'`.

---

## 6. Fase 2 — Coreografia de Entrada e Saída do Overlay (Atalho macOS)

O wrapper `ByteKiwiOverlay` gerencia ciclo de vida completo (`isOpen`), mantendo o componente montado durante a saída até `overlayExitMs` concluir antes de invocar `onExited`.

### Âncoras de Tela Suportadas (9 posições em `KIWI_OVERLAY_POSITIONS`)
- **Cantos (`top-left`, `top-right`, `bottom-left`, `bottom-right`):** entrada e saída em vetor diagonal `(±78px, ±78px)` com rotação sutil `±8°` e escala `0.72 → 1.0`.
- **Bordas Centrais (`top-center`, `bottom-center`, `center-left`, `center-right`):** desliza perpendicularmente para fora da borda (como HUD superior/notch ou emergência acima do Dock).
- **Centro (`center`):** materialização etérea (`scale 0.54 → 1.0`, `translateY +18px → 0`, `blur 10px → 0`).

---

## 7. Guia Prático para Outro Agente Continuar Criando Animações

Para adicionar **um novo estado** (ex: `celebrando` ou `erro`):
1. Adicione o nome do estado ao union `KiwiState` e registre seus alvos em `STATE_TARGETS`.
2. Ajuste no loop `animate`: se precisar de tremor horizontal (ex: `erro`), some `Math.sin(phase * 18) * 3` ao `tilt` ou ao `translateX` em `creatureGroupRef`.

Para adicionar **um novo emote comic** (ex: `ideia` com lâmpada ou `coracao`):
1. Adicione o ID em `KiwiComicEmote`.
2. Insira um novo bloco `{displayedEmote === 'ideia' && (<g>...</g>)}` dentro de `<g ref={comicOverlayRef}>`, usando sempre traços brancos (`#FFFFFF`, `strokeWidth="2.4..3.2"`, `strokeLinecap="round"`) na zona `x: 170..215, y: 40..90`.

Para integrar em um **overlay real de macOS (Electron / Tauri / Swift WKWebView)**:
- Monte `<ByteKiwiOverlay isOpen={overlayVisible} position="bottom-right" transitionStyle="materializacao-nevoa" state={agentState} audioLevel={micRms} />` sobre uma janela transparente (`background: transparent`, `alwaysOnTop: true`).
- Conecte o atalho global do sistema ao toggle de `isOpen`. Ao fechar, aguarde `onExited` antes de ocultar a janela nativa (`window.hide()`), garantindo que a animação de saída rode até o último quadro.
