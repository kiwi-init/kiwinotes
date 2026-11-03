// O que o AppEngine do devkit usa e a entrada `electrobun/bun/appengine` não exporta: o tipo do RPC entre o engine e
// a página, e o script do `window.engine` já compilado. No modo padrão o próprio engine injeta esse script; no modo
// host (o nosso, T1192) o preload é do app. O devkit é o fixado pelo Hutch (hutch-pin.json), então o caminho é estável
// dentro de uma versão do Electrobun; se ele mudar, o typecheck quebra aqui.

export type { AppEngineRPC, EngineInvokeResult } from "../../.hutch/devkit/api/shared/appengine-protocol.ts";
export { ENGINE_CONTRACT_GLOBAL } from "../../.hutch/devkit/api/shared/appengine-protocol.ts";
export { appEnginePageScript } from "../../.hutch/devkit/api/preload/.generated/compiled.ts";
