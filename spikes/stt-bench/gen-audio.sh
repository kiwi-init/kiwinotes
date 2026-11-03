#!/bin/sh
# Gera os áudios do corpus com o `say` (vozes do macOS), em WAV 16 kHz mono. Nada de voz de pessoa real.
# Saída em ./audio (ignorada pelo git). Uso: ./gen-audio.sh
set -eu
cd "$(dirname "$0")"
mkdir -p audio
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# Two takes per sentence, "voice:words per minute". On this Mac every PT-BR voice name except Luciana falls back
# to Luciana (and Eddy EN to Samantha): same audio, byte for byte. So PT varies the pace instead of the voice.
grep -v '^#' corpus.tsv | while IFS='	' read -r id lang size text; do
  case "$lang" in
    en) takes="Samantha:175|Fred:175" ;;
    *)  takes="Luciana:175|Luciana:220" ;;
  esac
  n=0
  for take in $(echo "$takes" | tr '|' ' '); do
    n=$((n + 1))
    say -v "${take%%:*}" -r "${take##*:}" -o "$tmp/$id.aiff" "$text"
    afconvert -f WAVE -d LEI16@16000 -c 1 "$tmp/$id.aiff" "audio/${id}_v$n.wav"
  done
done
ls audio | wc -l | xargs echo "clips:"
