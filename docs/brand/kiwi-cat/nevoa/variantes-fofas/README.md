# Estudos B1/B2 — composição corrigida

B1 algodão à esquerda, B2 nuvem suave à direita. Vídeos de 8 s, cor padrão,
semente 17, voz artificial apenas no ouvindo. Função de densidade/advecção
preservada byte a byte durante a correção do aro e da linha do corpo.

- [Ouvindo](ouvindo-B1-B2.mp4), [contato: 2 / 4 / 6 / 7,5 s](ouvindo-contato.webp).
- [Thinking](thinking-B1-B2.mp4), [contato](thinking-contato.webp).
- [Campos ativos × exposição](exposicao-ativa/report.json),
  [checagem dos pixels](exposicao-ativa/pixel-check.json).
- [Fontes](source-sha256.json), [densidade preservada](density-preservada.json).

Reproduzir da raiz, com Pillow/NumPy para a última linha:

```sh
bun app/scripts/kiwicat-active-exposure-check.ts /tmp/kn-active-exposure
python app/scripts/kiwicat-verify-active-exposure.py /tmp/kn-active-exposure
```

A reconstrução do núcleo cromático usa o mínimo RGB como luz neutra e
compara a emissão independente desse fundo. Tolerância de 2/255 para RGB8.
Isto verifica a composição e não substitui o julgamento visual do harry.
Nenhuma medida de CPU acompanha estes estudos: ela espera a escolha.
