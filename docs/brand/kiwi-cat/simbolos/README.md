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
passaram; captura e runtime no WebKit sem erros. Vídeos e desempenho
pareado ainda pendentes. Nada abre o app, mic ou agente real.
