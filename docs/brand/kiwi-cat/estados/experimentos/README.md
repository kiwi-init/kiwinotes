# Diagnóstico de #7924 / #7936 — ainda não aprovado

`mascara-contorno.py` tenta a abordagem pedida pelo lead: orelhas como
máscaras foscas rígidas, cabeça e aro fixos, luz pela diferença entre
contornos da silhueta neutra e movida. Não altera a piscada aprovada.

Execute da worktree com Python, Pillow e NumPy:

```sh
python docs/brand/kiwi-cat/estados/experimentos/mascara-contorno.py
```

Os intermediários vão para um diretório temporário. O script grava apenas
a prancha de diagnóstico e seu relatório nesta pasta; não regenera as
prévias principais nem modifica as fontes em `gerada/`.

A prova inclui cada orelha sozinha em ±25° e erro em +20°/−20°.
A pose neutra tem diferença zero no cálculo de movimento; a recomposição
mede máximo 2/255 fora dos olhos. Isso não valida as poses movidas.

**Ponto de falha:** no erro a +20°/−20°, fica uma linha escura na posição
da borda neutra, além de uma faixa clara na junção. A subtração do halo
neutro ainda não está calibrada à luz da v2: o termo externo
`blur(máscara) × (1 − máscara)` cria uma queda localizada na borda antiga.
A tentativa anterior de usar só `blur(máscara)` escurecia o interior
revelado da orelha. É necessário resolver a oclusão e o halo como uma única
composição de referência antes de aprovar os ângulos maiores.

A prancha é a evidência solicitada pelo lead caso o caminho travasse.
Não é uma nova rodada de aprovação e não reduz o alvo de ±25°.
As prévias principais no PR continuam sendo a rodada 7 rejeitada.
