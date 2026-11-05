#!/bin/sh
# A medida do R3 (T4943): o pipeline ao vivo inteiro (`--meeting-live`) nas reuniões do R0, com o mesmo score.ts.
# Pesado: pegue o `kiwi lock bench` antes. Nada toca som nem liga o mic.
#   ./run-live.sh   → results/*.live*.jsonl e o resumo em results/score-live.jsonl
set -e
cd "$(dirname "$0")"
H=../../native/.build/release/kiwi-helper
mkdir -p results
[ -f audio/longa.wav ] || bun gen.ts
live() { # <reunião> <saída> [--realtime]
  out="results/$1.live.$2${3:+.rt}.jsonl"
  echo "→ $out" >&2
  $H --meeting-live "audio/$1.wav" --output "$2" $3 > "$out" 2>> results/err-live.log
}
live curta headphones
live curta speaker          # o filtro de eco ligado numa reunião sem eco: não pode tirar a sua fala
live curta-eco speaker      # a meta do ADR 0009: perto de 0 palavras de eco
live longa headphones
live curta headphones --realtime
for m in curta curta-eco longa; do
  bun score.ts "audio/$m.truth.json" results/$m.live.*.jsonl
done > results/score-live.jsonl
cat results/score-live.jsonl
