#!/usr/bin/env bash
# Every check a cleanup pass must keep green, against the counts in tools/gate_baseline.json.
# usage: tools/gate.sh [--fast]   (--fast skips the py-aep differential, which needs uv and .upstream)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .gate
base() { python3 -c "import json;print(json.load(open('tools/gate_baseline.json'))['$1'])"; }

echo "== tsc"
bun run --silent typecheck

echo "== loose-type ratchet"
# any / unknown / as-cast counts per layer (tools/strict_report.ts) may only fall;
# lower tools/gate_baseline.json "loose_types" when they do.
python3 - "$(bun tools/strict_report.ts --json)" <<'PY'
import json, sys
now, base = json.loads(sys.argv[1]), json.load(open("tools/gate_baseline.json"))["loose_types"]
grew = [f"{layer} {k}: {now[layer][k]} > {v}" for layer, kinds in base.items() for k, v in kinds.items() if now[layer][k] > v]
fell = [f"{layer} {k}: {now[layer][k]} < {v}" for layer, kinds in base.items() for k, v in kinds.items() if now[layer][k] < v]
for line in fell: print("lower the baseline:", line)
for line in grew: print("grew:", line)
sys.exit(1 if grew else 0)
PY

echo "== generated chunk types"
bun tools/gen_chunk_types.ts --check

echo "== zero-cast ratchet (cos, models/text, resolvers/text_*)"
bun tools/type_ratchet.ts

echo "== tsdoc"
tsdoc=$(bun tools/tsdoc_lint.ts)
echo "$tsdoc"
python3 -c "import json,sys; sys.exit(0 if json.loads(sys.argv[1])['messages']==0 else 1)" "$tsdoc"

echo "== doc examples"
bun tools/doc_examples.ts | tail -1

echo "== bun test"
bun test --timeout 60000 > .gate/test.txt 2>&1 || true
pass=$(sed -nE 's/^ *([0-9]+) pass$/\1/p' .gate/test.txt | tail -1)
skip=$(sed -nE 's/^ *([0-9]+) skip$/\1/p' .gate/test.txt | tail -1)
fail=$(sed -nE 's/^ *([0-9]+) fail$/\1/p' .gate/test.txt | tail -1)
echo "pass=$pass skip=$skip fail=$fail"
if [ "${fail:-1}" != 0 ] || [ "${pass:-0}" -lt "$(base pass)" ] || [ "${skip:-0}" -gt "$(base skip)" ]; then
  grep -E "^\(fail\)" .gate/test.txt | head -40
  echo "bun test regressed (baseline pass=$(base pass) skip=$(base skip))"
  exit 1
fi

echo "== corpus round trip"
rt=$(bun tools/corpus_roundtrip.ts | head -1)
echo "$rt"
python3 -c "import json,sys; r=json.loads(sys.argv[1]); sys.exit(0 if r['identical']==r['total']==$(base samples) else 1)" "$rt"

if [ "${1:-}" = "--fast" ]; then echo "gate (fast) ok"; exit 0; fi

echo "== differential vs py-aep"
(cd .upstream && uv sync -q)
tools/diff/run.sh 8 > /dev/null
tools/diff/edit_run.sh 40 8 > /dev/null
python3 tools/diff/gate.py

echo "== fault-injection differential (corrupted btdk trees) vs py-aep"
fault=$(tools/diff/fault_run.sh 8)
echo "$fault" | head -1
python3 -c "import json,sys; r=json.loads(sys.argv[1]); sys.exit(0 if r.get('identical')==r['cases']>=$(base fault_cases) else 1)" "$(echo "$fault" | head -1)" || { echo "$fault" | head -40; exit 1; }
echo "gate ok"
