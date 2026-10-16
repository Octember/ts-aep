#!/usr/bin/env bash
# One batch of tools/diff/run.sh: dump both sides, compare, discard dumps.
set -uo pipefail
b=$1; n=$(basename "$b"); w=.diff/work_$n; mkdir -p "$w"
(cd .upstream && xargs uv run --project . python ../tools/diff/dump_py.py "../$w/py" < "../$b") 2> "$w/py.err"
xargs bun tools/diff/dump_ts.ts "$w/ts" < "$b" 2> "$w/ts.err"
python3 tools/diff/compare.py "$w/py" "$w/ts" ".diff/report_$n.json" > /dev/null
rm -rf "$w/py" "$w/ts"
