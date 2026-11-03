# stt-bench: WhisperKit vs Parakeet vs transcribe.cpp (T51)

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
- `tcpp:<modelo>` roda pelo transcribe.cpp (MIT; `Beingpax/Transcribe-cpp-swift` @ `0.2.0-dev.856d7c1`, o mesmo do VoiceInk), em Metal. Os modelos: `cohere` (Cohere Transcribe Q4_K_M, o do VoiceInk), `cohere-q8`, `whisper-turbo` (Whisper large-v3-turbo Q8_0) e `parakeet-ultra` (Q8_0). São GGUFs do `handy-computer` no Hugging Face, fixos por revisão e conferidos por SHA-256.
  - O Cohere não detecta o idioma: exige `@pt` ou `@en`. O Whisper sem dica (ou `@auto`) detecta sozinho.
  - `+vocab` só existe no Whisper: os termos vão como `initialPrompt`.
- **Voz real:** `./record.sh` grava 10 frases do corpus em `~/kiwi-voz` (fora do repo); `./record.sh mix03` regrava só uma. Depois rode `STT_AUDIO=~/kiwi-voz STT_RESULTS=results-voz ./run-all.sh`. Áudio e transcrições de voz real nunca vão para o git (`results-voz/` está no `.gitignore`).
- Os modelos baixam para `~/Library/Caches/kiwinotes-stt-bench` (WhisperKit e, em `transcribe-cpp/`, os GGUFs, ~5,6 GB) e `~/Library/Application Support/FluidAudio/Models` (Parakeet), ~2,5 GB.
