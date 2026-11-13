# Arte-mestra do Kiwi-cat — T10727 / spec #10508 / issue #432

Base de trabalho:527953d. Este diretório guarda a direção, as candidatas,
as críticas e, após escolha humana, as camadas e curvas finais. Não muda
o módulo, a aura nem a animação do app.

## Estado

Preparação, sem candidata gerada. O spec aprovado v10661 exige referências
marcadas pelo harry antes de desenhar. O briefing textual dessas referências
foi solicitado ao lead em #10742; não se presume uma seleção humana.
A regra #7652 permanece: imagens de referência do harry não são recebidas
pelo Codex; o lead traduz a gramática em texto.

## Invariantes aprovados

- Mesmo conceito/proporções da v2: gato frontal sentado, corpo em sino,
  duas orelhas pontudas, dois olhos redondos e aro colorido na cabeça.
- Acabamento fosco com volume suave, borda nítida e detalhes suficientes
  para parecer uma arte final; sem simplificação chapada nem neon.
- Aro ciano/violeta/rosa menos saturado, totalmente dentro da cabeça e
  com as duas pontas afinando até desaparecer.
- Nenhum olho, símbolo, aura ou névoa pintado nas camadas finais. Olhos e
  símbolos continuam em código; aura e animação são specs seguintes.
- Corpo/cabeça, cada orelha com base escondida e aro em camadas separadas,
  no mesmo canvas e encaixe. Arte final com pelo menos4096px de altura.
- Versão clara como inversa da escura, mantendo a silhueta exata.
- Silhueta e aro também em curvas SVG limpas, conferidas a120 e240px.

## Entrega e filtro

Gerar várias candidatas e enviá-las em lotes apenas ao lead. O lead filtra
três para o harry escolher. Antes de qualquer candidata chegar ao harry,
ela passa pelas três rodadas mínimas de crítica descritas em
[criticas/METODO.md](criticas/METODO.md). Notas só são atribuídas depois
que a arte e suas folhas tiverem sido vistas; não há notas pré-preenchidas.

Cada rodada deve guardar prompt, ferramenta, inputs autorizados, resolução
nativa real, resolução de exportação, arte, folha, cinco notas, três problemas,
correções e conferência. Não chamar um upscale de geração nativa em4K.

Ferramenta prevista: image_gen integrado, sem conta/API nova. A skill
imagegen foi lida. Não usar fallback CLI nem pedir credencial sem escolha
explícita da pessoa. O harry recusou ferramenta nova no #10668.
