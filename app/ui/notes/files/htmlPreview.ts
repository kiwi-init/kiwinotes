// A prévia de um .html nas Notas (T19314, spec #19277): a página desenhada ao lado do código, isolada. Ela vai num
// `<iframe sandbox="" srcdoc>`, e cada trava fecha uma saída:
//
// - `sandbox` vazio: nenhum script roda, nenhum form é enviado, e a página tem uma origem opaca, sem acesso à janela
//   das Notas nem à ponte do app;
// - a CSP das views (`window-security.ts`) vale no `about:srcdoc` também: `frame-src 'none'` recusa um link clicado
//   na prévia (ela não navega para fora), e `img-src`/`style-src`/`font-src` recusam o que vem da rede;
// - a CSP da própria prévia (`PREVIEW_CSP`, num `<meta>`) fecha o que a das views deixa: os arquivos do pacote da UI
//   (`'self'`, `views:`). Assim um `<img src="foto.png">` nem tenta carregar.
//
// O que a página traz dentro dela (o `<style>`, o `style=""`, uma imagem em `data:`) aparece; o que ela busca fora,
// não. Um WebKit headless com a CSP das views confirmou cada uma (o link, o form, o script, o CSS e a imagem de fora).

/** Só o CSS e as imagens e fontes que vêm dentro do arquivo. Nada de script, rede, form, frame ou `<base>`. */
export const PREVIEW_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/** Se o arquivo ganha a prévia: o .html e o .htm. */
export function isHtmlFile(path: string): boolean {
  return /\.html?$/i.test(path);
}

/**
 * O documento da prévia: o HTML do arquivo, com o `<meta>` da CSP no começo. Ele vem logo depois do `<!doctype>`,
 * quando há um, para a página não cair no modo quirks; o parser o põe no `<head>`, antes de qualquer `<link>` ou
 * `<style>` do arquivo, e a CSP já vale para eles.
 */
export function previewDocument(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
  const doctype = /^﻿?\s*<!doctype[^>]*>/i.exec(html);
  if (!doctype) return meta + html;
  return doctype[0] + meta + html.slice(doctype[0].length);
}
