# Auditoria das provas

A repetição final dos 24 casos, após `display:block`, passou: opaco 0,
névoa forte/material ≤1, vetores 0, canto alfa 0 e corpo alfa 255.

Uma primeira execução após o ajuste teve uma captura intermediária de
névoa da baseline em `ouvindo` com região preta onde a captura completa
e a opaca atual tinham RGB (56,120,158). Esse defeito apareceu somente na
captura isolada, sem diferença na composição inteira ou nos vetores.
Os PNGs dessa execução foram preservados em `/tmp/kiwi-T9708-pixels-final`;
a confirmação completa, sem mudança de código, em
`/tmp/kiwi-T9708-pixels-confirm`, passou. Não se atribui essa falha ao shader
nem se promete ter corrigido a causa da captura intermediária.

Os vídeos finais usam uma captura RGBA única por instante e não usam o
recorder nativo anterior. Todos os oito estados tiveram canto alfa 0,
corpo alfa 255 e alfa 0 nos quatro controles distantes de cada quadro
único. A comparação da composição com o WebKit está no manifesto.
A captura dos vídeos antecedeu apenas o ajuste CSS `display:block`;
a repetição de pixels após esse ajuste preserva o resultado.

A primeira série de CPU foi feita de 12:29 a 12:42 (-03), em 13/11/2026.
O arranque concorrente relatado em #10230 foi às 13:36:23–35 (-03), depois
da série. A auditoria usou os horários de modificação dos arquivos originais.
A repetição final registra `startedAt` e hashes de fonte em cada perfil.
