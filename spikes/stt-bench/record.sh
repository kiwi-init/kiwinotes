#!/bin/sh
# Grava as frases do corpus com a sua voz, para a rodada com voz real do benchmark.
# Os WAVs (16 kHz mono) vão para fora do repo: ~/kiwi-voz (ou $KIWI_VOZ). Nunca commite esse áudio.
# Uso: ./record.sh            grava as 10 frases
#      ./record.sh mix03 pt01 regrava só essas (sobrescreve)
#      KIWI_TAKE=r2 ./record.sh mix01 mix02 mix03 mix05 mix06   2ª tomada das misturadas: os aliases
#                             aprendem com a 1ª e são medidos na 2ª (./voz.sh)
# Depois: ./voz.sh
set -eu
cd "$(dirname "$0")"
out=${KIWI_VOZ:-"$HOME/kiwi-voz"}
take=${KIWI_TAKE:-r1}
mkdir -p "$out"
ids=${*:-"pt01 pt03 pt07 en01 en04 mix01 mix02 mix03 mix05 mix06"}
total=$(echo $ids | wc -w | tr -d ' ')
n=0
for id in $ids; do
  n=$((n + 1))
  text=$(grep "^$id	" corpus.tsv | cut -f4)
  if [ -z "$text" ]; then echo "id desconhecido: $id (veja corpus.tsv)"; exit 2; fi
  echo
  echo "[$n/$total] Leia em voz alta, no seu jeito normal de falar:"
  echo
  echo "    $text"
  echo
  printf "Enter para COMEÇAR a gravar… "
  read -r _ </dev/tty
  ffmpeg -nostdin -loglevel error -y -f avfoundation -i ":default" -ac 1 -ar 16000 -c:a pcm_s16le "$out/${id}_${take}.wav" &
  pid=$!
  printf "Gravando. Enter para PARAR… "
  read -r _ </dev/tty
  kill -INT "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  echo "ok: $out/${id}_${take}.wav"
done
echo
echo "Pronto: $total frases em $out"
