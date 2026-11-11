# ADR 0010: o viewer oficial do draw.io dentro das Notas

- Status: aceito (T7112, spec #7079; decisão do @harry em #7312, opção B).
- Código:
  - [`app/ui/notes/files/DrawioViewer.tsx`](../../app/ui/notes/files/DrawioViewer.tsx): carrega o viewer e mostra o diagrama;
  - [`app/ui/notes/files/drawio.ts`](../../app/ui/notes/files/drawio.ts): confere o arquivo antes (é diagrama? passa do teto?);
  - [`app/ui/notes/files/drawioGuard.ts`](../../app/ui/notes/files/drawioGuard.ts): tira as imagens de fora antes do pedido;
  - [`app/scripts/drawio-viewer.ts`](../../app/scripts/drawio-viewer.ts): a versão e o sha256 do viewer que vai no repo.

## Contexto
A janela Notas nunca põe HTML de um arquivo na página: o docx passa por um leitor com lista do que é permitido, e o teste de `ui/notes` recusa `innerHTML` no nosso código. O `.drawio` não tem um leitor assim. As opções eram desenhar o diagrama por conta própria (só as formas básicas) ou embutir o viewer oficial da JGraph (`viewer-static.min.js`, 4,9 MB, Apache-2.0), que desenha tudo o que o draw.io desenha. O harry escolheu o viewer oficial (#7312), abrindo esta exceção.

## Decisão
- **O viewer vai no pack**, sem rede e sem CDN. Ele fica em `app/ui/notes/files/drawio/`, com a licença, na versão fixada (32.6.10). O `bun test` confere o sha256 dele. Ele só carrega quando um `.drawio` abre (`lazy` e um `<script src>` do próprio pack). Os créditos aparecem no Sobre e no `THIRD_PARTY_NOTICES.txt`.
- **A exceção:** o viewer põe na página o HTML dos rótulos do diagrama. Esse HTML passa antes pelo DOMPurify que vem nele (`Graph.sanitizeHtml`), e o resto da trava das views continua valendo:
  - a CSP não tem `unsafe-eval` nem `unsafe-inline` em `script-src`, então um `<script>` ou um `onerror` num rótulo não roda;
  - `img-src` e `connect-src` não deixam sair para a internet, e a janela não navega para fora.
- **A exceção fica na área do diagrama:** a área tem `contain: paint`. Um rótulo com `position: fixed` ou `absolute` se posiciona dentro dela e é cortado por ela, sem cobrir a barra, a árvore ou a nota.
- **Nada de fora é nem pedido** (a trava vale também no Vite do dev, onde a CSP não está):
  - todo caminho que o viewer lê de `window` (`DRAW_MATH_URL`, `PROXY_URL`, `SHAPES_PATH`, `DRAWIO_SERVER_URL` e os outros) aponta para o pack, e o log fica desligado. O teste confere a lista contra o `viewer-static.min.js`, então uma versão nova com um caminho novo falha no `bun test`. Os textos e o CSS dele não são baixados (`mxLoadResources = false`);
  - um gancho no DOMPurify tira de cada rótulo o `src`, o `srcset`, o `href` de imagem e o `url()` do CSS que não sejam uma imagem embutida (`data:image/…`);
  - as imagens das formas (`image=`, `indicatorImage=`) e a de fundo da página têm o mesmo filtro, e o canvas SVG do viewer só desenha imagem embutida;
  - fontes de fora (`fontSource`, `extFonts`, Google Fonts) não carregam: o rótulo usa a fonte do sistema;
  - fórmulas (`math="1"`) não carregam o MathJax, que viria de fora: o texto da fórmula aparece como está;
  - um link (`<a href>`) fica: clicar nele abre no navegador padrão, como numa nota. Um `javascript:` sai.
- **Tetos antes do viewer:** o arquivo inteiro e cada página comprimida, já inflada, até 20 MB, e até 200 páginas. Um arquivo que não é diagrama ou que passa do teto vira um aviso, sem carregar o viewer.
- **Só leitura.** O `.drawio.svg` já é um desenho e abre como imagem, pelo viewer de imagens.

## Consequências
- Trocar de versão: `bun scripts/drawio-viewer.ts` baixa a tag nova e confere. Depois, atualizar o sha256 e a versão no script e rodar `bun scripts/third-party-notices.ts`.
- O pack das Notas e o do hub ficam 4,9 MB maiores. Quem não abre um `.drawio` não paga nada em memória.
- Formas que o viewer buscaria de fora (stencils extras, imagens por URL) aparecem vazias. A forma em si e o rótulo continuam lá. Fórmulas aparecem como o texto TeX, e fontes do Google viram a fonte do sistema. O diagrama inteiro abre no app padrão.
