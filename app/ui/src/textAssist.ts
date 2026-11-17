// Os campos de busca e de filtro não querem a ajuda de texto do macOS (T2925, #2921): o WebKit sugere "Kg" para "kg"
// num balão com ×, sublinha a busca como erro de ortografia e completa palavras em cinza. Tudo isso só atrapalha quem
// digita um pedaço de título ou um operador (`tag:`, `-excluir`).
//
// `writingsuggestions` é o atributo do HTML para a predição em linha do macOS; o React 19 repassa o atributo como está.

export const NO_TEXT_ASSIST = {
  spellCheck: false,
  autoCorrect: "off",
  autoCapitalize: "off",
  autoComplete: "off",
  writingsuggestions: "false",
} as const;
