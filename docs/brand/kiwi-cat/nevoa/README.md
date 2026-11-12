# Névoa do Kiwi-cat — T8487

Spec Kiwi #7549 v8466 · issue #376 · PR #377 (rascunho).

A prova de captura passou em WebKit headless com WebGPU/Apple. O módulo
isolado está implementado; a aceitação de CPU e dos estados ativos está
pendente. Nenhuma tela de produção importa a demonstração.

## Revisão atual: contorno e opções A/B

A revisão #8570 encontrou um contorno na base do corpo quando a luz baixava.
A máscara agora congela só os olhos, e a composição aplica um pedestal
contínuo de luminância no material. Arco e névoa compartilham o ganho local;
o arco permanece limitado ao brilho original.

[Varredura de exposição 0,50–1,40](exposicao/contact.webp), em passos de 0,01:
[91 quadros, nenhum canal decresce ao subir a exposição](exposicao/monotonicity.json).
Prova em t=0, não substitui inspeção de vídeo ou julgamento visual.

| Cor padrão | A à esquerda / B à direita |
| --- | --- |
| Ouvindo, voz sintética | [comparação](variantes/ouvindo-A-B.mp4) |
| Thinking | [comparação](variantes/thinking-A-B.mp4) |

Ambas incluem a correção do contorno. A preserva a opção discreta. B aumenta
a variação espacial e advecta o ruído para fora/cima; a voz amplia o campo
e o pensar altera seu peso lateral. O repouso é o mesmo nas duas. A escolha
visual ainda é do harry, por meio do lead. Os clipes usam o campo em escala 1.

[Comparação de escalas, variante B](escalas/comparison.json): 1 / 0,5 / 0,25,
mesma semente e tempo. Erro médio máximo 0,039/255; p99 até 1/255. Não é
prova de equivalência visual em todos os instantes nem resultado de CPU.

## Clipes iniciais (anteriores à correção do contorno)

Estes vídeos são da primeira composição em resolução integral. A próxima
comparação calcula apenas o campo de ruído em uma textura menor; não
reduz olhos, contorno, arco ou composição final.

| Estado | Padrão | Claude | Codex |
| --- | --- | --- | --- |
| Repouso | [vídeo](videos/repouso-padrao.mp4) | [vídeo](videos/repouso-claude.mp4) | [vídeo](videos/repouso-codex.mp4) |
| Ouvindo | [voz sintética](videos/ouvindo-padrao.mp4) | [voz sintética](videos/ouvindo-claude.mp4) | [voz sintética](videos/ouvindo-codex.mp4) |
| Thinking | [vídeo](videos/thinking-padrao.mp4) | [vídeo](videos/thinking-claude.mp4) | [vídeo](videos/thinking-codex.mp4) |

[Repouso por 60 segundos](videos/repouso-60s.mp4) ·
[3/s à esquerda e 12/s à direita](videos/repouso-comparacao-3-12.mp4).
O lead escolheu 3/s para repouso (#8561). Exportação em 30 quadros/s com
quadros repetidos reais, sem interpolação. A captura usa relógio controlado,
semente 17 e voz artificial; nenhum microfone. FPS do arquivo não é medida
de desempenho. [Manifesto da captura](videos/report.json).

## Evidências

- [Prova inicial de GPU/captura](prova-captura/README.md).
- [Contrato, implementação e comandos](../../../../app/ui/kiwicat/README.md).
- [Roundtrip inicial da referência](medidas/referencia.json): erro máximo 2/255,
  fora dos olhos +5px, incluindo a névoa (mais estrito que o recorte pedido).
- [Pausas e fallbacks](medidas/comportamento.json): WebGPU, WebGL2, ausência
  de GPU, página oculta, Reduzir movimento, baixa cadência e liberação.

## CPU: ainda não aprovada

Os relatórios iniciais em `medidas/webgpu-3fps.json`, `webgpu-12fps.json`
e `webgl2-12fps.json` são diagnósticos anteriores à textura reduzida.
Não são três repetições da mesma versão. A execução WebGPU 3/s registrou
média 3,45%, acima do teto; não há aceite de desempenho com esse resultado.

A comparação final alterna três repetições de cada escala (1, 0,5 e 0,25),
todas a 3/s, com hashes iguais dos fontes. Cada execução aquece 10 segundos
e mede 60 segundos sem gravador. O percentual soma os processos próprios
do navegador, WebContent e GPU, em unidades de um núcleo. O limite de 3%
vale para a média; p95 é informado (#8527). Ambiente: M1 Pro, 16 GB,
macOS 27.2.1, WebKit headless, 640×800, DPR 1. Os números não medem o
WKWebView de produção.

A revisão #8580 confirmou a correção do contorno e pediu remover as linhas
retas de B antes de apresentar as opções. O shader usa agora ruído de
gradientes, com domínios rotacionados entre oitavas. O alvo escalar é
RGBA16F: ganhos acima de 1 não podem ser truncados por uma textura UNORM.
Os clipes mais recentes avançam a simulação a 60 Hz e exportam 30 quadros/s.
As capturas iniciais avançavam a 30 Hz; isso não altera as medidas separadas
de FPS, feitas com o relógio real e sem gravador.


A revisão #8631 confirmou a maciez, ausência de fios/linhas e borda limpa;
as opções foram levadas ao harry em #8629. A aparência está congelada.
A CPU final compara três execuções de cada escala para A e B (18 execuções).
Nenhuma medida interrompida de versões anteriores será usada como aceite.
