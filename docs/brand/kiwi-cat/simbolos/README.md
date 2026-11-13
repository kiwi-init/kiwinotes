# Símbolos redesenhados — T10437 / spec #10416 / issue #426

As curvas de `sym` em `simbolos2.html` são a referência aprovada pelo harry.
O HTML e `simbolos-redesenhados.webp` foram copiados sem alteração do
scratchpad do lead. `symbols.ts` traduz Path2D/círculos/arcos para SVG na
mesma caixa100×100 e usa os mesmos tamanhos/posições da folha.

`comparacao-gato-referencia.webp` alterna referência e módulo no escuro e
no claro. Olhos e névoa do módulo conservam os estados atuais; o tratamento
do claro do mock não faz parte desta task. O lead confirmou a fidelidade
em #10495 e autorizou os vídeos.

`tira-120px-sem-legenda.webp` usa renderers reais de96×120px, com margem,
sem redimensionar capturas grandes. A ordem está separada em `ordem-tira.json`.
`capturas-modulo.json` registra42 capturas WebGPU; fontes PNG em
`/tmp/kiwi-T10437-symbols`.

O host passa `background: "light" | "dark"` na criação ou chama
`setBackground(...)` para mudar só a tinta dos símbolos. Padrão: escuro.
Olhos permanecem brancos. Não há contorno nem camada preta de apoio;
`outline` segue aceito por compatibilidade, sem efeito.

O rabisco mantém um único caminho fixo, traçado por dashoffset. Ondas,
pontos, gotas, linhas e brilhos usam os canais e tempos existentes da
máquina de gestos. O teste headless `kiwicat-symbol-runtime-check.ts`
confere troca de tinta sem novo frame/estado, as1/2/3ondas e sua retirada,
o caminho fixo durante o traçado e o descarte da instância.

Verificação até esta prévia: typecheck e33testes do módulo/511asserts
passaram; captura e runtime no WebKit sem erros. Os sete vídeos estão em `videos/`, com30amostras/s sem interpolação,
e timelines idênticas entre as duas tintas (assert no coletor). Os dados
integrais dos quadros permanecem no caminho raw apontado pelo índice,
com SHA256; o índice do repo é uma descrição compacta derivada.
Nada abre o app, mic ou agente real.


## Validação final

O lead confirmou a fidelidade em #10495, a leitura correta de7/7 estados
na tira de120px em #10531 e a suavidade de entrada/saída do `!` no vídeo
em #10574. Os outros vídeos seguem para a revisão antes do aceite final.

Sem os símbolos,24pares WebGPU/WebGL2/sem GPU foram idênticos byte a byte
em corpo, aro, olhos e névoa à base `afda4c9`. O CSS oculta os símbolos
antes do primeiro desenho; os PNGs estão em `/tmp/kiwi-T10437-body`.

Desempenho:3pares de ordem alternada,10s aquecimento +60s, cinco processos
próprios do WebKit,640×800DPR1, recorte ligado nos dois lados, sem captura,
sob lease `bench`. Média antes1,992%, depois2,087%, delta **+0,095 ponto**;
pares−0,301 /+0,284 /+0,300. P95 agregado4,151%→4,984%; maior p95 de uma
janela:4,996%→5,027%. O lead aceitou a variação como ruído em #10595,
usando limite de+0,5ponto. Não se afirma queda de CPU.

FPS antes59,33–60,02; depois58,99–60,08 nos seis estados ativos, semslow.
Relatórios, amostras e hashes em `desempenho/`; todos os hashes de runtime
conferem com a fonte medida. CPU mede só a demo headless, não o app/helper.

O CI do runtime `71b282b` passou Bun (incluindo verificações de UI),
typecheck e Swift no run43493425473. O commit final acrescenta somente
relatórios e documentação; seu CI também deve ser conferido antes do merge.
