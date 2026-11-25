// The overlay cat's catalog in English (T29351, spec #28171): the same keys as `catoverlay.pt.ts`.

import type { ptCatOverlay } from "./catoverlay.pt.ts";

export const enCatOverlay: { readonly [K in keyof typeof ptCatOverlay]: string } = {
  "catOverlay.more": "See more",
  "catOverlay.less": "See less",
  "catOverlay.ask": "Need anything else?",
  "catOverlay.closeBubble": "Close",
  "catOverlay.closeCat": "Close Kiwi Cat",
  "catOverlay.voiceError": "I couldn't reach the agent: {message}",
  "catOverlay.unknownError": "unknown error",
};
