#!/bin/sh
# A rodada com voz real (T51) num comando só: mede os motores nos WAVs de ~/kiwi-voz (gravados pelo record.sh)
# e imprime a tabela no formato do ADR 0003, com o pós-processamento do sidecar (termos e aliases).
# Só números saem daqui: as transcrições e os aliases aprendidos ficam em results-voz/, fora do git.
# Uso: ./voz.sh    (pega e solta o `kiwi lock bench` sozinho)
set -eu
cd "$(dirname "$0")"
audio=${STT_AUDIO:-"$HOME/kiwi-voz"}
if ! ls "$audio"/*_r1.wav >/dev/null 2>&1; then
  echo "nenhuma gravação em $audio: grave com ./record.sh (e KIWI_TAKE=r2 ./record.sh mix01 mix02 mix03 mix05 mix06)"
  exit 1
fi
kiwi=$(command -v kiwi || echo "$HOME/.kiwi/bin/kiwi")
"$kiwi" lock bench
trap '"$kiwi" unlock bench' EXIT
swift build -c release 2>&1 | tail -1
rm -rf results-voz
# Os candidatos (#428): o Parakeet Ultra e o Nemotron sem CTC, como o sidecar roda, e o Whisper turbo com o prompt.
for e in parakeet-ultra nemotron-unified@pt tcpp:whisper-turbo@auto+vocab tcpp:whisper-turbo@auto; do
  echo "=== $e"
  # O resumo só: as linhas de cada clipe têm o texto transcrito.
  STT_AUDIO="$audio" STT_RESULTS=results-voz .build/release/stt-bench "$e" 2>&1 | grep -v '^[[:space:]]*$' | tail -3
done
echo
.build/release/stt-bench --report results-voz
