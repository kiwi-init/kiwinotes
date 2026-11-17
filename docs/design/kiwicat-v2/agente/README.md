# Byte Kiwi Cat — Kit de Animações

**Preset exportado:** KiwiCat Ver Final Perfect
**Transição de overlay selecionada:** `materializacao-nevoa` (`bottom-right`)

Arquivos incluídos neste pacote:

1. **`ByteKiwiCat.tsx`** — Componente React + TypeScript 100% auto-contido:
   - `DEFAULT_KIWI_CONFIG`: já configurado com suas escolhas atuais (paleta, distribuição na névoa, barra equalizadora, balão HQ e animação de entrada/saída).
   - `KIWI_COLOR_PALETTES`: todas as 4 paletas de cores pré-configuradas (com `isSelected: true` na sua escolhida).
   - `KIWI_AURA_STYLES`: todas as 4 distribuições de cor na névoa.
   - `KIWI_OVERLAY_TRANSITIONS` & `KIWI_OVERLAY_POSITIONS`: todas as 4 animações de entrada/saída e 9 posições na tela do Mac.
   - `KIWI_PERSONALITY_PRESETS`: todos os presets salvos + padrão oficial, indicando o preset ativo.
2. **`byte-kiwi-cat.tokens.json`** — Snapshot completo com suas escolhas marcadas e todos os catálogos disponíveis para referência rápida.
3. **`BYTE_KIWI_CAT_ARCHITECTURE.md`** — Documentação técnica detalhada e guia de handoff para outros agentes de IA (Gemini, Claude Code, etc.) continuarem criando animações.

## Uso Rápido

```tsx
import { ByteKiwiOverlay, KIWI_PERSONALITY_PRESETS, KIWI_COLOR_PALETTES } from './ByteKiwiCat';

export function MacShortcutOverlay({ open, audioLevel }: { open: boolean; audioLevel: number }) {
  return (
    <ByteKiwiOverlay
      isOpen={open}
      state="respondendo"
      emote="auto"
      position="bottom-right"
      transitionStyle="materializacao-nevoa"
      audioLevel={audioLevel}
      size={220}
    />
  );
}
```
