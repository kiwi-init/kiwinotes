// Os tipos dos módulos da lib de Markdown do Channels que a janela importa direto (T2983): a lib publica o JS em
// lib/module e os tipos em lib/typescript, sem ligar um ao outro. É o mesmo arquivo do Channels (ui/src/chat/enriched.d.ts).

declare module "react-native-enriched-markdown/lib/module/index.web.js" {
  export * from "react-native-enriched-markdown/lib/typescript/src/index.web";
}

declare module "react-native-enriched-markdown/lib/module/normalizeMarkdownStyle.web.js" {
  export * from "react-native-enriched-markdown/lib/typescript/src/normalizeMarkdownStyle.web";
}

declare module "react-native-enriched-markdown/lib/module/web/globalStyles.js" {
  export * from "react-native-enriched-markdown/lib/typescript/src/web/globalStyles";
}

declare module "react-native-enriched-markdown/lib/module/web/parseMarkdown.js" {
  export * from "react-native-enriched-markdown/lib/typescript/src/web/parseMarkdown";
}

declare module "react-native-enriched-markdown/lib/module/web/renderers/index.js" {
  export * from "react-native-enriched-markdown/lib/typescript/src/web/renderers/index";
}

declare module "react-native-enriched-markdown/lib/module/web/styles.js" {
  export * from "react-native-enriched-markdown/lib/typescript/src/web/styles";
}

declare module "react-native-enriched-markdown/lib/module/web/utils.js" {
  export * from "react-native-enriched-markdown/lib/typescript/src/web/utils";
}
