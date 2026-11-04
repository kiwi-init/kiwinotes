# Kiwi-cat na família do Channels (T2025, teste)

O Kiwi-cat adaptado para parecer da mesma família do ícone do Channels (#2015). O Channels está acima na hierarquia, então
quem muda é o gato. **Ainda é um teste:** o ícone do app e o da barra não mudam até o harry escolher uma variação.

## O que faz o ícone do Channels ser "o Channels"
- **Base:** um quadrado preto (`#000`) com raio de 224/1024 (~22%), sem gradiente, sem sombra e sem borda.
- **Área segura:** o desenho fica dentro de 820 px centrados (10% de margem), e nada vaza para a borda.
- **Objeto:** três lâminas de vidro inclinadas e empilhadas, com espessura de verdade (uma face de cima e as faces de lado).
- **Borda nítida:** branco a ~85% por dentro e um contorno escuro (`#14161f` a 60%) por fora. Nada é borrado nem brilha.
- **Vidro:** um preenchimento escuro e translúcido (`#0b0d14`), com uma **faixa holográfica** na diagonal: rosa `#ff5fbf`,
  laranja `#ffa53d`, amarelo `#fff27a`, verde `#5cffb0`, ciano `#45c9ff`, violeta `#7b61ff` e branco.
- **Reflexo:** um risco branco fino perto da borda de cima de cada lâmina.
- **Detalhe:** médio. Lê como "lâminas" em 128 px, e em 32 px vira uma mancha diagonal colorida.

## As variações (da mais fiel ao gato à mais fiel ao Channels)
| | O que muda no gato |
|---|---|
| `kiwi-cat-1-aura` | Na base e na área segura do Channels, com a borda de vidro. A aura borrada e a luz de borda continuam, nas cores holográficas. O corpo continua preto. |
| `kiwi-cat-2-vidro` | O corpo vira vidro escuro com a faixa holográfica, e entra o reflexo na cabeça. A aura fica a 40%, e a luz de borda colorida, fraca. |
| `kiwi-cat-3-lamina` | Sem nenhum brilho borrado, como o Channels. O gato vira uma lâmina, com espessura embaixo (a face de lado em listras holográficas) e a faixa mais forte. |

Cada variação tem o SVG estático e o `-intro.svg`, com a **mesma animação de abertura do demo**. O tempo, a sequência e o
movimento são os mesmos (o bloco de CSS é idêntico ao do zip), e só a aparência muda (#2029). Os ids que a animação usa
continuam todos; os novos são `clip-base`, `safe-area` e `glass-highlight`.

- `prancha.png`: as três em 1024 (a 50%), 128, 32 e 16 px, no claro e no escuro. A prancha com o ícone do Channels ao
  lado foi só para o canal, porque o repo do Channels é privado e este é público.
- `demo.html`: as três aberturas lado a lado. Abra no navegador.
- `gerar.ts`: gera os seis SVGs a partir dos do zip
  (`unzip docs/kiwicat-demo/kiwi-cat-demo.zip -d /tmp/kiwicat && bun docs/brand/kiwi-cat-familia/gerar.ts /tmp/kiwicat`).
