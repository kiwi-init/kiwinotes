# meeting-bench: a medida das reuniões (T4926, R0 do spec #4823)

Spike para escolher o ASR em streaming e a diarização ao vivo das reuniões. Não vai para o app. O resultado e a escolha estão no [ADR 0009](../../docs/adr/0009-reunioes.md).

**Sem mic, sem som e sem tela.** A fala é gerada direto em arquivo, e o helper lê o WAV.

```sh
bun spikes/meeting-bench/gen.ts          # audio/: curta (8,4 min, 3 outros), curta-eco, longa (26,8 min, 5 outros) + gabaritos
(cd native && swift build -c release)
kiwi lock bench --wait 30m               # é pesado e a máquina é compartilhada
spikes/meeting-bench/run-all.sh          # results/*.jsonl e o resumo em results/score.jsonl
kiwi unlock bench
```

## As peças
- **`dialogo.txt`:** a reunião, uma fala por linha (`PAPEL: texto`), sobre uma migração de PACS, com os termos do trabalho de propósito. "A" é você; de "B" a "F" são os outros.
- **`gen.ts`:** fala cada linha e monta um WAV de **dois canais** a 16 kHz.
  - O canal 0 é **você** (o mic) e o canal 1 é o **sistema** (os outros).
  - As pausas vêm de uma semente fixa, e 8% das falas entram 0,3 s antes de a anterior acabar.
  - A `curta-eco` vaza o sistema no mic (40 ms, 20%), como num alto-falante sem fone.
  - O gabarito (`*.truth.json`) diz quem disse o quê, de quando a quando.
- **`tts.swift`:** a fala vai para o arquivo pelo `AVSpeechSynthesizer.write`, sem tocar som.
  - As vozes "novelty" do `say` (Eddy, Flo…) saem robóticas demais em PT: o ASR erra 66% delas.
  - A Siri natural não está aberta a apps.
  - Sobram a **Luciana** (pt-BR) e a **Joana** (pt-PT). As outras pessoas são elas com a fala **reamostrada** (`shift`: muda o tom e os formantes juntos).
  - Vozes da mesma família são o caso **difícil** para a diarização. Numa reunião de verdade, as vozes diferem mais.
- **`kiwi-helper --meeting <wav> --asr stream|batch|none --diarizer sortformer|lseend|vbx|none [--realtime]`** (`native/Sources/kiwi-helper/MeetingBench.swift`):
  - roda o ASR nos dois canais e a diarização no canal do sistema, ao mesmo tempo;
  - escreve JSON por linha (`word`, `spk`, `stats`);
  - o `--realtime` alimenta no ritmo do tempo real, para medir o atraso até o texto firme (`firmAt`).
- **`score.ts`:** a nota de cada rodada contra o gabarito.
  - WER por canal, com os números por extenso nos dois lados.
  - Erro de falante por palavra (WDER), com o melhor casamento um-para-um.
  - Falantes achados contra os reais.
  - Palavras de eco no canal "você".
  - Atraso p50 e p90, CPU e memória de pico.

O áudio e os resultados ficam em `audio/` e `results/`, que o git ignora.

## A medida do R3 (T4943)

`run-live.sh` roda `kiwi-helper --meeting-live <wav> --output speaker|headphones [--realtime]`. É o pipeline que o app usa, inteiro: os dois ASR em streaming, o Sortformer ao vivo, o filtro de eco e a correção do VBx no fim. Ele escreve as mesmas linhas `word`/`spk`, e o mesmo `score.ts` dá a nota (`results/score-live.jsonl`). Veja [docs/meetings/live.md](../../docs/meetings/live.md).
