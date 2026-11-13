# A mesa de ajuste do gato fantasma (spec #11176, T11191)

Abra `ajuste.html` com dois cliques: ela roda direto do arquivo, sem servidor, e nada sai do Mac.

**O que a página mostra:**
- o gato fantasma em repouso, em loop, no escuro e no claro, com a v2 parada ao lado;
- uma prévia a 120 px no fundo do app.

**Os controles:** aura, arco de cor, respiração (respirar, pulsar ou ondular), flutuação e fiapos.
- **"Copiar os valores"** gera um bloco para colar no canal.
- **"Voltar ao padrão"** desfaz tudo.
- Os valores ficam salvos no navegador entre uma abertura e outra.

**Os nomes dos parâmetros** (`auraAmount`, `auraRadius`, `edgeSoftness`, `auraFloor`, `mistColor`, `arcIntensity`,
`arcWidth`, `arcFrom`, `arcTo`, `arcCyan`, `arcBlue`, `arcViolet`, `arcPink`, `breathOn`, `breathType`,
`breathPeriod`, `breathAmount`, `floatOn`, `floatHeight`, `floatPeriod`, `wispAmount`, `wispSpeed`) são os uniforms
do shader (`ajuste.frag`) que vai ao módulo do gato. Por isso o bloco colado entra direto como o padrão no app.

**Para mudar a página:**
- edite `ajuste.tpl.html` (a página) ou `ajuste.frag` (o shader);
- monte de novo com `python3 montar-ajuste.py`;
- confira com `bun ajuste-check.ts <caminho de ajuste.html> <saida.png>`, que precisa do `playwright-core` de
  `app/node_modules`.

A máscara (`mascara-v2.b64`) é o núcleo escuro da v2, tirado pela luminância (T10727). A página calcula o campo de
distância dela ao abrir.
