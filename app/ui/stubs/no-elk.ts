// O mermaid traz o ELK (um layout a mais, ~1,4 MB); as Notas, como o Channels (ui/src/chat/no-elk.ts), desenham só
// com o dagre. Um diagrama com `layout: elk` mostra o erro em vez do desenho (T2984).
export default class NoElk {
  layout(): Promise<never> {
    return Promise.reject(new Error("o layout ELK não vem no app: tire o `layout: elk` para desenhar"));
  }
}
