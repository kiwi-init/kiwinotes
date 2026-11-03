#!/bin/sh
# Roda todos os motores duas vezes: a 1ª baixa e compila os modelos (frio); a 2ª mede o load real (quente)
# e é a que fica em results/*.json. Pegue `kiwi lock bench` antes: é pesado e a máquina é compartilhada.
set -u
# O turbo com prompt (+vocab) devolve texto vazio nesta versão do WhisperKit; por isso o +vocab do Whisper vai no small.
cd "$(dirname "$0")"
TURBO=whisper:openai_whisper-large-v3-v20240930_626MB
mkdir -p results
for pass in cold warm; do
  # A literal list: no word splitting of a variable, which some shells don't do.
  for e in parakeet-v3 parakeet-v3+vocab parakeet-ultra parakeet-ultra+vocab parakeet-ultra@pt \
           nemotron-unified@auto nemotron-unified@pt nemotron-unified@pt+vocab parakeet-unified \
           "$TURBO" whisper:openai_whisper-small whisper:openai_whisper-small+vocab whisper:openai_whisper-base \
           tcpp:cohere@pt tcpp:cohere-q8@pt tcpp:whisper-turbo@auto tcpp:whisper-turbo@pt tcpp:whisper-turbo@auto+vocab \
           tcpp:parakeet-ultra; do
    echo "=== $pass $e"
    .build/release/stt-bench "$e" 2>&1 | grep -v '^[[:space:]]*$' | tail -4
  done
done
