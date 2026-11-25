// O catálogo do gato no overlay, em português (T29351, spec #28171): o balão e os × da página que roda no WebView do
// helper (`ui/catoverlay`), e a frase do erro que o main põe no balão. Entra no `pt.ts` por inteiro (`...ptCatOverlay`).
// A página importa só este arquivo e o `catoverlay.en.ts`, não o catálogo inteiro: a língua chega pelo helper
// (`lang=` na URL e `set({lang})`).

export const ptCatOverlay = {
  "catOverlay.more": "Ver mais",
  "catOverlay.less": "Ver menos",
  "catOverlay.ask": "Precisa de mais alguma coisa?",
  "catOverlay.closeBubble": "Fechar",
  "catOverlay.closeCat": "Fechar o Kiwi Cat",
  "catOverlay.voiceError": "Não consegui falar com o agente: {message}",
  "catOverlay.unknownError": "erro desconhecido",
} as const;
