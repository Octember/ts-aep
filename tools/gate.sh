#!/usr/bin/env bash
# Every check a cleanup pass must keep green, against the counts in tools/gate_baseline.json.
# usage: tools/gate.sh [--fast]   (--fast skips the py-aep differential, which needs uv and .upstream)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .gate
base() { python3 -c "import json;print(json.load(open('tools/gate_baseline.json'))['$1'])"; }

echo "== tsc"
bun run --silent typecheck

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
echo "gate ok"
