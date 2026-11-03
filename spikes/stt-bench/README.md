# stt-bench: WhisperKit vs Parakeet (T51)

Spike para escolher o STT local. Não vai para o app. O resultado e a escolha estão no [ADR 0003](../../docs/adr/0003-stt.md).

```sh
./gen-audio.sh            # corpus.tsv → audio/*.wav (sintético, pelo `say`; ignorado pelo git)
swift build -c release
kiwi lock bench           # é pesado e a máquina é compartilhada
./run-all.sh > results/run.log   # todos os motores, frio e quente; resumo por motor no log, detalhe em results/*.json
kiwi unlock bench
```

- Um motor por vez: `.build/release/stt-bench parakeet-ultra+vocab`, `whisper:openai_whisper-small`, etc. (`--list-whisper` lista os modelos).
- `+vocab` liga o dicionário de `vocab.txt`: vocabulary boosting (CTC) no Parakeet e no Nemotron, prompt no Whisper.
- `@pt`, `@en` ou `@auto` (antes do `+vocab`) é a dica de idioma, como o VoiceInk passa: filtro por alfabeto no Parakeet v3/Ultra, prompt de língua no `nemotron-unified`. Ex.: `nemotron-unified@pt+vocab`.
- `parakeet-unified` é o checkpoint em inglês que o VoiceInk usa; `nemotron-unified` é o multilíngue.
- **Voz real:** `./record.sh` grava 10 frases do corpus em `~/kiwi-voz` (fora do repo); `./record.sh mix03` regrava só uma. Depois rode `STT_AUDIO=~/kiwi-voz STT_RESULTS=results-voz ./run-all.sh`. Áudio e transcrições de voz real nunca vão para o git (`results-voz/` está no `.gitignore`).
- Os modelos baixam para `~/Library/Caches/kiwinotes-stt-bench` (Whisper) e `~/Library/Application Support/FluidAudio/Models` (Parakeet), ~2,5 GB no total.
