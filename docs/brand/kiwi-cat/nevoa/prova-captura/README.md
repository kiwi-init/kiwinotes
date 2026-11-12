# Prova de captura — T8487, etapa 1 do spec #7549

**Passou no WebKit headless instalado neste Mac.** É uma cena mínima de
limpeza do canvas por GPU, não o shader da névoa nem uma medida de desempenho.

- WebKit27.2, viewport640×800, DPR1, CSP das views do app.
- Backend efetivo: WebGPU; adaptador identificado como Apple;
  `isFallbackAdapter=false`. Não foi usado outro navegador.
- Dois estados de cor do canvas: [fase A](phase-a.png) e [fase B](phase-b.png).
- [Vídeo MP4](capture.mp4), convertido do [WebM original](capture.webm).
  Decodificados em0,5s/1,5s, os valores RGB médios foram101,67/173,00,
  e a diferença absoluta média71,33: há imagem e mudança, não vídeo preto.
- O gravador produziu25fps. Isso **não prova**60fps de renderização.
- Relatório completo: [report.json](report.json), sem erros da página/GPU.

Reprodução, a partir da raiz do repositório, com dependências do app:

```sh
bun app/scripts/kiwicat-capture-proof.ts docs/brand/kiwi-cat/nevoa/prova-captura
```

O script serve só sua própria página em127.0.0.1, bloqueia os demais
pedidos de rede, não usa engine/helper nem pede acesso ao microfone.
Salva o vídeo ao fechar o contexto, decodifica e verifica pixels por ffmpeg.
Não abre a tela do app. Esta evidência libera a etapa seguinte do spec;
ela não aprova visualmente a névoa nem prova desempenho do WKWebView do app.
