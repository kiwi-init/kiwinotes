// A trava das janelas (T1378, achado #1375 do T1368). Uma janela do Kiwi Notes só mostra a UI dela: um link não navega
// a janela para fora (lá a página teria a ponte inteira, `history.search` e `clipboard.write`), um link externo abre
// no navegador padrão, e a CSP não deixa rodar nada que não venha do próprio pacote da UI.

/**
 * A CSP das views (`views://`). Ela vale nas respostas `views://` e `appdata://`, então não pega o Vite do dev
 * (`http://localhost`), e o HMR segue funcionando sem exceção nenhuma.
 *
 * - `script-src` sem `'unsafe-inline'` e sem `'unsafe-eval'`: a UI é um `<script type="module" src>` do build, e o
 *   preload entra pelo WebView, fora da CSP. Com `'wasm-unsafe-eval'` (T2983): deixa compilar WebAssembly, e só isso
 *   (nada de `eval` nem `new Function`). É o parser de Markdown do Channels (md4c), que vem embutido no build da UI;
 * - `style-src` com `'unsafe-inline'`: o CodeMirror da janela Notas cai numa tag `<style>` quando não há
 *   `adoptedStyleSheets` (#1385). A UI não monta HTML (nada de `innerHTML`), então isso não abre script;
 * - `img-src` com `https:` (T2984): a imagem de fora numa nota (`![](https://…)`) só carrega depois que a pessoa clica
 *   no cartão dela (decisão do jow no #3039). Nada carrega sozinho: a UI só põe um `<img src="https://…">` depois
 *   desse clique. `http:` continua bloqueado;
 * - `connect-src ws://127.0.0.1:*`: só o socket da ponte do RPC, que o preload do Electrobun abre em
 *   `ws://127.0.0.1:<porta>` (a porta muda a cada vez). Com `'none'`, o WebKit lança `SecurityError` no
 *   `new WebSocket`, a inicialização do preload para antes de pôr o transporte do RPC, e nenhuma janela sobe (#1419).
 *   Nada de rede de verdade: nem `https:`, nem outro host;
 * - sem `'unsafe-eval'`: o `evaluateJavascriptWithResponse` do preload (`new Function`) devolve o erro em vez de rodar.
 *   O app usa o `executeJavascript`, que vem do WebView e não passa pela CSP;
 * - `object-src`, `frame-src`, `base-uri` e `form-action` em `'none'`: nada de plugin, iframe, `<base>` nem form que
 *   leve a outro lugar.
 */
export const VIEWS_CSP = [
  "default-src 'self' views:",
  "script-src 'self' views: 'wasm-unsafe-eval'",
  "style-src 'self' views: 'unsafe-inline'",
  "img-src 'self' views: data: https:",
  "font-src 'self' views: data:",
  "connect-src ws://127.0.0.1:*",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export interface WindowSecurity {
  /** JSON das regras de navegação: bloqueia tudo (`^*`) e libera só a UI. A última regra que casa vale. */
  navigationRules: string;
  /** O `newWindow` do Electrobun: `window.open` e `target=_blank`. */
  newWindow: "external";
  contentSecurityPolicy: string;
}

/**
 * - `dev`: a URL do Vite (só no canal `dev`, `devServerUrl()`), ou null. Com ela, a janela pode navegar dentro do
 *   Vite também; no stable, só `views://internal/*`, onde a UI do AppEngine é servida (`loadHTML`).
 */
export function windowSecurity(dev: string | null): WindowSecurity {
  const rules = ["^*", "views://internal/*"];
  if (dev) rules.push(`${new URL(dev).origin}/*`);
  return {
    navigationRules: JSON.stringify(rules),
    // http(s) e mailto abrem no navegador padrão; qualquer outro esquema não faz nada.
    newWindow: "external",
    contentSecurityPolicy: VIEWS_CSP,
  };
}
