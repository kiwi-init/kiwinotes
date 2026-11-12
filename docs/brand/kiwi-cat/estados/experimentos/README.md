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

## Única tentativa corrigida de #7963, pedida em #8283

`halo-residuo.py` é uma tentativa separada, sem mudanças nas funções aprovadas
de olhos, piscada, preenchimento ou símbolos e sem alterações no aro original
ou nas cores. Sua execução grava somente `teste-halo-residuo.webp` e
`verificacao-halo-residuo.json` nesta pasta.

A receita usa luz por trás de superfícies foscas opacas; o aro original,
os olhos e os símbolos vêm depois. Ajusta quatro escalas de blur da silhueta
inteira por mínimos quadrados não negativos e compõe
`halo(S_pose) + R × (1 − E × smoothstep(0°, 3°, maior ângulo))`.
A busca de escalas é parte desse único ajuste, sem nova abordagem posterior.
O diagnóstico mostra cada orelha em ±25° e erro em +20°/−20°.

**Falhou.** O ajuste escolheu σ = 20/45/90/500 pixels de origem, mas só a
escala de 500 recebeu peso positivo (0,5171). Em `E > 0,1`, `|R|` tem média
13,998/255 e máximo 34,903/255 (média ponderada por E: 13,454/255).
A identidade da luz neutra é correta numericamente; isso não garante a
recomposição neutra do gato depois de substituir as superfícies por máscaras
opacas. O relatório inclui a comparação nativa, que também falha.

Há dois defeitos independentes a relatar:

- A extração de superfícies foscas altera a borda do corpo/cabeça já no neutro.
- O `aro.png` original contém também a franja clara da orelha neutra, além
  do arco cromático. No ponto (155, 220) da prévia, seu RGBA é
  (216, 210, 255, 92). Como essa camada aprovada é desenhada por último,
  ela recoloca a borda antiga e luz dentro da orelha movida. A receita não
  a elimina apenas recalculando a camada `luz`.

Nenhum clipe foi regenerado e nenhuma rodada foi aberta. A implementação
para aqui, conforme #8283: sem diminuir os ângulos, sem mexer nos elementos
aprovados e sem tentar uma terceira abordagem. O diagnóstico foi preparado
para o lead decidir o próximo passo.
