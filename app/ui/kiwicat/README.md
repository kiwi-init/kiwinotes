# Névoa do Kiwi-cat — T8487 / spec #7549

Módulo isolado, ainda sujeito à revisão do lead e ao julgamento visual do
harry. Nenhuma tela de produção importa a demonstração. A única mudança
visível prevista nesta entrega é o crédito MIT do three.js no Sobre.

`createKiwiFog(root, options)` recebe as quatro entradas em `options.inputs`:

- `estado`: os oito nomes do roteiro;
- `voz`: número0–1 com captura, ausente/null sem microfone;
- `cor`: `padrao`, `claude`, `codex` ou corCSSsRGB;
- `parado`: quadro fixo, sem agendamento.

`update(inputs)` parte dos valores correntes. `dispose()` remove listeners,
quadros, timers e recursos do renderer. O host não deve abrir mic, janela
ou agente em consequência dessas chamadas.

## Desenho

Duas passagens sobre uma superfície fixa usam grafos TSL próprios, compilado pelo three.js
0.187.0 para WebGPU ou WebGL2. Não há partículas, filtros de blur nem
formas borradas deslocadas. A textura lossless é a referência da v2,
composta offline pelo script aprovado; o ruído 3D de gradientes, em duas oitavas e domínios rotacionados, com
alteração de domínio muda a densidade da luz nessa referência, sem mover
a imagem. O tempo avança numa dimensão do campo, sem um período de loop
ou vídeo de névoa embutido. A aparência viva e os60s continuam dependendo
do julgamento do harry.

O campo escalar de ruído é calculado numa textura RGBA16F menor (`densityScale`: 1,
0,5 ou 0,25), ampliada com filtro linear; a composição final continua na
resolução de saída. Essa filtragem de amostragem não aplica blur à imagem.
A escala final depende da comparação visual e das medidas após a escolha
da textura. A B1 foi escolhida no #8754; as medidas finais usam prazo monotônico de 60 s.

A máscara separada guarda os olhos no canal R e a cobertura opaca no G.
A cobertura bloqueia apenas a variação procedural e as volutas, para a
névoa ficar atrás do gato; não congela a exposição das bordas.
Um pedestal de luminância
contínuo protege o material escuro; congelar as bordas das camadas criava
um contorno na exposição baixa (#8570). O aro preserva matiz/forma. No repouso mantém o ganho local anterior; nos
estados ativos sua emissão é separada da luz neutra e limitada a 1. A cor só atua na luz da névoa. Exposição local tem piso
0,50; a cor é interpolada emRGBlinear por400ms, com pisoY0,28. Voz usa
τsubida60ms/τdescida280ms por tempo decorrido. Transições de estado usam
240ms a partir da pose corrente. Cabeça, corpo, orelhas, olhos e símbolos
não são animados por este módulo.

Os assets são reproduzidos com `python app/scripts/kiwicat-assets.py`
(Pillow/NumPy). `assets/source.json` registra os hashes das seis fontes.
Nenhum arquivo original em `docs/brand/kiwi-cat/gerada/` é alterado.

B1 algodão é a única textura do runtime, escolhida pelo harry (#8754).
A e B2 ficam apenas nos clipes históricos. A atividade dos seis estados
ativos parte do valor corrente e assenta em 240 ms; repouso/sono mantêm
seu campo discreto. A fase de advecção é integrada sem saltos e o
alongamento radial é limitado, para não criar filamentos em uso prolongado.
A seleção e a proteção de duração mantêm os quadros aprovados dentro de
1/255 em RGB8. O alvo de densidade começa em escala 1, como nos clipes
aprovados; as medidas compararão também 0,5 e 0,25 antes de fechar a escala.

A composição separa luz neutra e emissão cromática do aro com ganho até 1,
sem estouro. Nos estados ativos, o pedestal escuro usa uma transição
exponencial contínua; o campo e a paleta continuam locais e controlados
pelas quatro entradas. Nenhum filtro é aplicado ao vivo.

## Cadência e pausa

O desenho ativo acompanha os quadros do WebKit headless (alvo60fps).
A névoa de repouso/sono admite uma cadência menor, abaixo do teto30 do
roteiro; `options.idleFPS` permite comparações controladas. Depois das
matrizes a3/s acima de3% de CPU, o plano B do lead (#8862/#8893) usa2/s
em repouso/sono, com comparação visual3/s ×2/s e três medidas na inteira.
Os estados ativos mantêm o mesmo movimento e alvo60fps.
Transições de cor/estado temporariamente usam30fps mesmo no repouso.
Não extrapolar essas cadências para o movimento futuro do gato.
O lead aceitou2/s após comparar o vídeo (#8900). Para a integração no app:
se o harry notar um leve tique no repouso, avaliar mistura temporal entre o
quadro anterior e o novo (#8527/#8900), medindo novamente no WKWebView.
Essa mistura não faz parte desta entrega nem das provas atuais.

Captura honra a mesma cadência: o relógio avança a 60 Hz e a exportação é 30 fps; quadros repetidos são
repetidos de verdade; não há interpolação para fingir movimento contínuo.
`capture(seconds)` avança o relógio controlado, sem criar um loop de tempo.
O modo de medida usa o relógio real e não tira prints nem grava vídeo.

Ao esconder a página, cancelam-se timers/RAF. Com Reduzir movimento há um
quadro e nenhuma atualização pelo nível numérico da voz. Mudança de estado,
cor ou presença do mic atualiza uma vez. A política de baixa capacidade
observa os estados ativos: uma janela de60 intervalos sustentados abaixo
de24fps congela o desenho. A cadência baixa intencional do repouso não é
confundida com uma máquina incapaz. Sem ambos os backends, mostrar o ícone.

**Integração sensível à versão:** three0.187 mantém um RAF interno depois
de `render()`, mesmo com `setAnimationLoop(null)`. Um adaptador pequeno
usa um contexto local sem agendamento, preservando a atualização síncrona
da biblioteca, e chama `_animation.stop()` após desenhar sob demanda.
O repouso desenha diretamente no prazo do temporizador; os ativos e as
transições usam o RAF real. Isso evita despertar temporizador e display
link para o mesmo quadro quieto. O pacote está fixado; a ausência do
adaptador falha explicitamente e exige rever o pin. Os testes
headless contam callbacks além de desenhos, para não deixar um heartbeat
oculto queimando CPU. Nenhum código do pacote é modificado.
Além dos pixels controlados, o teste grava a apresentação nativa do repouso,
sem screenshots, para confirmar que o temporizador entrega quadros visíveis.

## Ferramentas de teste

Da raiz, sem app/helper/microfone:

```sh
bun app/scripts/kiwicat-capture-proof.ts /tmp/kn-capture-proof
bun app/scripts/kiwicat-demo-check.ts /tmp/kn-demo-check
bun app/scripts/kiwicat-reference.ts /tmp/kn-reference
bun app/scripts/kiwicat-exposure-check.ts /tmp/kn-exposure
KIWI_FOG_VARIANT=B1 bun app/scripts/kiwicat-scale-check.ts /tmp/kn-scales
kiwi -c kiwinotes --as brave-egret lock bench --ttl 20m
KIWI_FOG_SCALE=0.25 KIWI_FOG_VARIANT=B1 bun app/scripts/kiwicat-bench.ts /tmp/kn-bench3 3
bun app/scripts/kiwicat-bench.ts /tmp/kn-bench12 12 --cpu-only
bun app/scripts/kiwicat-capture.ts /tmp/kn-fog-videos
```

`kiwicat-demo.ts` serve só o bundle local e os próprios assets em127.0.0.1,
com a CSP das views. Não precisa do AppEngine nem de dados da pessoa.
WebGPU é o padrão, WebGL2 pode ser forçado pelo teste, e ausência dos dois
mantém a imagem estática. Nenhum navegador alternativo é usado.

Números valem **só para a página de demonstração**,640×800/DPR1, não para
o WKWebView do app. CPU é a soma dos processos próprios do WebKit, em
percentual de um núcleo:60s após10s, média e p95. O teto3% vale para a média
(#8527); p95 é informado, com explicação se exceder5%. FPS vem dos intervalos
reais dos desenhos, nunca do MP4. A gravação controlada é feita em outra
execução. Não manter o lock depois de encerrar as medidas/capturas.
