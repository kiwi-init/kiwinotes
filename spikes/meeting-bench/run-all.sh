#!/bin/sh
# A medida inteira do R0 (T4926). Pesado: pegue o `kiwi lock bench` antes. Nada toca som nem liga o mic.
#   ./run-all.sh   → results/*.jsonl e o resumo em results/score.jsonl
set -e
cd "$(dirname "$0")"
H=../../native/.build/release/kiwi-helper
mkdir -p results
run() { # <reunião> <asr> <diarizer> [--realtime]
  out="results/$1.$2.$3${4:+.rt}.jsonl"
  echo "→ $out" >&2
  $H --meeting "audio/$1.wav" --asr "$2" --diarizer "$3" $4 > "$out" 2>> results/err.log
}
run curta stream sortformer
run curta stream lseend
run curta batch vbx
run curta-eco stream sortformer
run longa stream sortformer
run longa stream lseend
run longa batch vbx
run curta stream sortformer --realtime
for m in curta curta-eco longa; do
  bun score.ts "audio/$m.truth.json" results/$m.*.jsonl
done > results/score.jsonl
cat results/score.jsonl
