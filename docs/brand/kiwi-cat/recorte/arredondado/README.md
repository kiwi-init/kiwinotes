# Duas curvas para a queda da névoa — T10367 / issue #424

Prévia para decisão do lead: elipse (p=2) e superelipse (p=4), com a mesma
pose, semente17 e tamanho. `agindo` em1,2s, `acordou` em0,53s e `erro` em0,85s.
A faixa inicia em raio normalizado0,82 e termina em1. O corpo/aro mantêm
sua proteção. Sem `edgeCurve`, continua valendo a faixa reta aprovada.
Nenhuma variante foi escolhida como padrão.

A folha usa um quadro RGBA real do WebKit por pose, composto em branco e
`#367a8e`. A composição foi conferida contra capturas de páginas novas do
WebKit; o relatório é `composicao-vs-webkit.json`. Os PNGs originais ficam
em `/tmp/kiwi-T10367-curves`; WebP92 é apenas para comparação visual.

A primeira tentativa trocava o fundo na mesma página e perdeu o canvas em
algumas capturas brancas. Esses arquivos foram preservados separadamente em
`/tmp/kiwi-T10367-curves-attempt1`; não são a folha entregue. A segunda
captura confere corpo opaco e sua cor, e compara todos os fundos com o
RGBA antes de produzir a folha.

```sh
cd app
bun scripts/kiwicat-rounded-choices.ts /tmp/kiwi-T10367-curves
cd ..
/caminho/python app/scripts/kiwicat-rounded-sheet.py /tmp/kiwi-T10367-curves docs/brand/kiwi-cat/recorte/arredondado
```

Precisa de `bench`, WebKit headless, Pillow13 e NumPy2.5.4. Sem app na tela,
helper, microfone ou agente real. Typecheck e33testes do módulo passaram.
Ainda faltam escolha da curva, assets do fallback correspondentes,
paridade por camada, CPU e vídeos finais.

Por pedido do lead #10399, o trabalho fica guardado após esta folha até a
decisão do harry sobre névoa/partículas (#10396). O tratamento novo do claro
e os símbolos redesenhados pertencem a specs separados.
