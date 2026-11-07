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
- `tcpp:<modelo>` roda pelo transcribe.cpp (MIT), em Metal. Desde o T6602 é o mesmo do modo preciso do helper: a v0.4.1 oficial, pelo `TranscribeCpp` de `native/`. Até ali era o `Beingpax/Transcribe-cpp-swift` @ `0.2.0-dev.856d7c1`, o do VoiceInk, e o texto saiu igual nos 15 clipes de voz real. Os modelos: `cohere` (Cohere Transcribe Q4_K_M, o do VoiceInk), `cohere-q8`, `whisper-turbo` (Whisper large-v3-turbo Q8_0), `whisper-small` (Q8_0, o do modo preciso) e `parakeet-ultra` (Q8_0). São GGUFs do `handy-computer` no Hugging Face, fixos por revisão e conferidos por SHA-256.
  - O Cohere não detecta o idioma: exige `@pt` ou `@en`. O Whisper sem dica (ou `@auto`) detecta sozinho.
  - `+vocab` só existe no Whisper: os termos vão como `initialPrompt`.
- **Voz real:** `./record.sh` grava 10 frases do corpus em `~/kiwi-voz` (fora do repo); `./record.sh mix03` regrava só uma, e `KIWI_TAKE=r2 ./record.sh mix01 mix02 mix03 mix05 mix06` grava a 2ª tomada das misturadas. Depois, `./voz.sh` faz tudo: pega o `bench`, roda os candidatos (Parakeet Ultra, Nemotron `pt`, Whisper turbo com e sem prompt) e imprime a tabela do ADR 0003. Áudio e transcrições de voz real nunca vão para o git (`results-voz/` está no `.gitignore`).
- `stt-bench --report [dir]` (o fim do `voz.sh`) reaplica o pós-processamento do sidecar (T256, via `native/`) no texto de cada motor: nenhum, só os termos de `vocab.txt`, e termos mais aliases. Os aliases são aprendidos sozinhos numa tomada (as palavras que o motor escreveu no lugar de cada termo, entre as vizinhas que ele acertou) e medidos na outra: `_r1` → `_r2`, ou `_v1` → `_v2` no sintético. Só números saem; `STT_SHOW_ALIASES=1` mostra os aliases, e só funciona fora de uma pasta de voz real.
- Os modelos baixam para `~/Library/Caches/kiwinotes-stt-bench` (WhisperKit e, em `transcribe-cpp/`, os GGUFs, ~5,6 GB) e `~/Library/Application Support/FluidAudio/Models` (Parakeet), ~2,5 GB.
