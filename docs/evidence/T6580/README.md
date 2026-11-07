# T6580 · L13 · O ditado longo perde palavra nas emendas de 15 s?

Issue #164, spec #6561 (onda 7, trilha A). O FluidAudio corta o áudio em janelas de 15 s, e a doc dele avisa que a emenda pode perder palavra. **Medido: não perde.** Por isso, o corte nas pausas não entrou.

## Como medi
- **Textos:** os 3 de `app/test/dictation/longos/` (168 a 180 palavras cada, PT-BR), falados pelo `say` com a Luciana. Sem mic.
- **As duas transcrições:** cada texto vai inteiro (52 a 71 s) e também frase a frase pelo `kiwi-helper --transcribe`, o mesmo STT do ditado (Parakeet Ultra).
- **O que conta como emenda:** uma palavra que o longo perdeu e o frase a frase não perdeu. O segundo é estimado pela posição da palavra no texto, e o relatório dá a distância da emenda de 15 s mais perto.
- **Mais duas rodadas à mão:** um texto de 134 s (dois textos juntos) e o `--vad` ligado.

```sh
cd app
kiwi lock bench --wait 30m
bun scripts/long-dictation.ts              # 175 palavras/min
bun scripts/long-dictation.ts --rate 220   # mais rápido: mais palavras caem em cima da emenda
kiwi unlock bench
```

## Resultado

| Texto | Duração | Palavras | Erros no longo | Erros frase a frase | Perdidas só no longo |
|---|---|---|---|---|---|
| tarefas, 175/min | 70 s | 180 | 7 | 2 | **0** |
| viagem, 175/min | 65 s | 169 | 1 | 0 | **0** |
| servidor, 175/min | 71 s | 168 | 9 | 8 | **0** |
| tarefas, 220/min | 56 s | 180 | 2 | 5 | **0** |
| viagem, 220/min | 52 s | 169 | 2 | 1 | 1 ("à", a 5,5 s da emenda) |
| servidor, 220/min | 57 s | 168 | 7 | 7 | **0** |
| tarefas + viagem, 175/min | 134 s | 349 | 6 | 2 | **0** |
| os 3, com `--vad` | 65–134 s | — | 1–9 | — | **0** |

- **Nenhuma palavra sumiu perto de uma emenda.** A única perdida só no longo ("à", a 220/min) fica a 5,5 s da emenda.
- **O que o longo erra a mais** são palavras curtas a mais (`ou`, `são`, `o`, `e`) e trocas de flexão (`minuto` → `minutos`), espalhadas pelo texto e não junto das emendas.
- **"oitenta por cento" vira "80"** nos dois modos: é a limpeza escrevendo o número, não perda.

## O que fica
- Um caso falado de 70 s em `test/dictation/falados.jsonl` confere as palavras em volta de cada emenda (15, 30, 45 e 60 s). Se um modelo ou uma versão nova do FluidAudio passar a perder palavra, a bateria (`bun run test:dictation`) acusa.
- O `scripts/long-dictation.ts` refaz a medida inteira, com testes da conta em `long-dictation.test.ts`.
- **Limite:** é voz sintética, num ritmo constante. A voz real, com pausas e hesitações, não foi medida. O mic real é só do harry (AGENTS.md).
