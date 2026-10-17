#!/usr/bin/env bash
# Fault-injection differential: corrupt the btdk COS tree of every sample
# with text layers (fault_py.py make), then read + write + save each corrupted
# project in py-aep and the TS port and compare case by case.
# usage: tools/diff/fault_run.sh [JOBS]   -> .fault/out, summary on stdout
set -euo pipefail
cd "$(dirname "$0")/../.."
# Absolute: `.upstream` may be a symlink, so `..` inside it is not this checkout.
root=$(pwd)
jobs=${1:-8}
out=$root/.fault/out
rm -rf "$out" && mkdir -p "$out/m"
python3 -c "
import pathlib
for p in sorted(pathlib.Path('samples').rglob('*.aep')):
    if b'btdk' in p.read_bytes(): print(p)
" > "$out/samples.txt"
# One manifest per sample, merged in sample order (deterministic case list).
(cd .upstream && tr "\n" "\0" < "$out/samples.txt" | xargs -0 -P "$jobs" -I{} sh -c \
  'uv run -q --project . python "$1"/tools/diff/fault_py.py make "$2/m/$(echo "$3" | tr / _)" "$3"' _ "$root" "$out" {})
for s in $(cat "$out/samples.txt"); do
  d="$out/m/$(echo "$s" | tr / _)"
  cat "$d/cases.jsonl" >> "$out/cases.jsonl"
  mkdir -p "$out/cases" && mv "$d"/cases/*.aep "$out/cases/"
done
rm -rf "$out/m"
cut -d'"' -f4 "$out/cases.jsonl" | awk -v n="$jobs" -v o="$out/ids_" '{ print > (o (NR % n)) }'
(cd .upstream && ls "$out"/ids_* | xargs -P "$jobs" -I{} sh -c \
  'xargs uv run -q --project . python "$1"/tools/diff/fault_py.py run "$2" < "$3"' _ "$root" "$out" {}) 2> "$out/py.err"
ls "$out"/ids_* | xargs -P "$jobs" -I{} sh -c 'xargs bun tools/diff/fault_ts.ts "$1" < "$2"' _ "$out" {} 2> "$out/ts.err"
python3 tools/diff/fault_compare.py "$out"
