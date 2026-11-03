// A trava das janelas (T1378, achado #1375 do T1368). Uma janela do Kiwi Notes só mostra a UI dela: um link não navega
// a janela para fora (lá a página teria a ponte inteira, `history.search` e `clipboard.write`), um link externo abre
// no navegador padrão, e a CSP não deixa rodar nada que não venha do próprio pacote da UI.

/**
 * A CSP das views (`views://`). Ela vale nas respostas `views://` e `appdata://`, então não pega o Vite do dev
 * (`http://localhost`), e o HMR segue funcionando sem exceção nenhuma.
 *
 * - `script-src` sem `'unsafe-inline'` e sem `'unsafe-eval'`: a UI é um `<script type="module" src>` do build, e o
 *   preload entra pelo WebView, fora da CSP;
 * - `style-src` com `'unsafe-inline'`: o CodeMirror da janela Notas cai numa tag `<style>` quando não há
 *   `adoptedStyleSheets` (#1385). A UI não monta HTML (nada de `innerHTML`), então isso não abre script;
 * - `connect-src 'none'`: a UI só fala com o main pela ponte do RPC, nunca por rede;
 * - `object-src`, `frame-src`, `base-uri` e `form-action` em `'none'`: nada de plugin, iframe, `<base>` nem form que
 *   leve a outro lugar.
 */
export const VIEWS_CSP = [
  "default-src 'self' views:",
  "script-src 'self' views:",
  "style-src 'self' views: 'unsafe-inline'",
  "img-src 'self' views: data:",
  "font-src 'self' views: data:",
  "connect-src 'none'",
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
