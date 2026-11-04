// O react-native que a lib de Markdown do Channels (react-native-enriched-markdown) pede na web: só o que o
// styleUtils dela usa, como o ui/src/chat/react-native.ts do Channels (T2983).
export const Platform = { OS: "web" };

export const processColor = (color) => color;
