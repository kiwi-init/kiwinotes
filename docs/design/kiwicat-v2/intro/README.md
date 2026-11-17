# Kiwi Notes — Kit Completo da Intro com KiwiCat

Pacote de handoff com código-fonte real, especificações matemáticas, tokens JSON e builds standalone pronto para ser entregue à IA ou equipe de engenharia que está desenvolvendo o aplicativo **Kiwi Notes**.

- **App:** Kiwi Notes
- **Mascote:** KiwiCat *(substitui referências antigas de Byte KiwiCat / QENit)*
- **Preset Visual Base:** `KiwiCat Ver Final Perfect`
- **Duração Total (com transição para janela do app):** `5,35 s`
- **Duração Apenas Mascote (sem moldura):** `4,40 s`
- **Modo Reduzir Movimento:** `1,50 s`

---

## Arquivos Incluídos Neste Pacote

| Caminho | Finalidade |
| :--- | :--- |
| `README.md` | Este guia rápido de visão geral, testes no navegador e integração. |
| `KIWICAT_KIWI_NOTES_ARCHITECTURE.md` | Documentação técnica completa para agentes de IA: separação **KiwiCat vs. Moldura/App**, stack WebGL2 + Canvas 2D, todas as 6 fases detalhadas com referências de código, métricas, easing e guia de integração no **Kiwi Notes**. |
| `tokens/kiwicat-intro.tokens.json` | Snapshot estruturado de todas as cores, janelas de tempo, câmera 3D, curvas e dimensões da transição squircle → janela. |
| `src/kiwiIntroTimeline.ts` | Máquina determinística de coreografia (`evaluateIntroPose`), fases (`INTRO_PHASES`), preset (`KIWI_INTRO_CONFIG`) e curvas de easing. |
| `src/kiwiRenderer.ts` | Motor gráfico híbrido: fragment shader GLSL ES 3.00 (raymarching SDF volumétrico + aurora iridescente), projeção Flat-3D das orelhas/olhos/boca em Canvas 2D e gerador de snapshots PNG. |
| `src/KiwiIntroStage.tsx` | Componente React que isola a caixa fixa `1:1` do **KiwiCat** dentro da **Moldura** expansível que se transforma na janela do **Kiwi Notes**. |
| `src/exportStandaloneHtml.ts` | Gerador programático de builds HTML de arquivo único com zero dependências externas. |
| `build/intro-prototipo-navegador.html` | Protótipo pronto para abrir direto no Chrome/Safari/Edge (inclui botão *"De novo"* e suporte a `?t=`). |
| `build/intro-app-com-moldura.html` | Build pronto com fundo transparente para janela desktop nativa (Electron / Tauri / WKWebView) + contrato `window.engine`. |
| `build/intro-sem-moldura.html` | Build flutuante apenas com o **KiwiCat** (sem moldura atrás). |

---

## Como Testar Rapidamente

1. Abra `build/intro-prototipo-navegador.html` em qualquer navegador moderno.
2. **Inspecionar qualquer frame:** adicione `?t=2.2` (ou `?t=0.45`, `?t=3.55`, `?t=4.55`, `?t=5.2`) na URL para congelar exatamente naquele segundo.
3. **Pular intro:** clique sobre o palco durante a reprodução (fade-out suave de `0,26 s`).
4. **Testar Movimento Reduzido:** ative *Reduzir movimento* no sistema operacional ou grave `localStorage.setItem('kn-appearance', JSON.stringify({ motion: 'reduced' }))` no console.

---

## Nota Importante para a IA do Kiwi Notes

Leia primeiro o arquivo **`KIWICAT_KIWI_NOTES_ARCHITECTURE.md`** (especialmente a **Seção 2: Separação Arquitetural entre KiwiCat e Moldura do App**).

Em resumo: **o KiwiCat e a moldura são 2 camadas independentes dentro do mesmo container de lançamento**:
1. O **KiwiCat** vive em um box centralizado fixo (`size × size`) com opacidade própria (`pose.mascotOpacity`), desaparecendo sozinho em `3,96 s – 4,30 s`.
2. A **Moldura** (`#090A0E`, squircle `24%`) **permanece na tela**, estica via `pose.windowExpand` entre `4,28 s – 4,92 s` de `320×320` até as dimensões da janela do **Kiwi Notes**, e revela o app real dentro dela (`4,80 s – 5,26 s`).

Basta substituir o bloco de caixinhas simuladas (`#app-win` em `KiwiIntroStage.tsx` / `exportStandaloneHtml.ts`) pela interface real do **Kiwi Notes** (ou montar a UI real via `children` controlada por `pose.appContentOpacity`).
