#!/usr/bin/env bash
# One batch of tools/diff/run.sh: dump both sides, compare, discard dumps.
set -uo pipefail
# Absolute: `.upstream` may be a symlink, so `..` inside it is not this checkout.
root=$(pwd)
b=$1; n=$(basename "$b"); w=.diff/work_$n; mkdir -p "$w"
(cd .upstream && tr "\n" "\0" < "$root/$b" | xargs -0 uv run --project . python "$root/tools/diff/dump_py.py" "$root/$w/py") 2> "$w/py.err"
tr "\n" "\0" < "$b" | xargs -0 bun tools/diff/dump_ts.ts "$w/ts" 2> "$w/ts.err"
python3 tools/diff/compare.py "$w/py" "$w/ts" ".diff/report_$n.json" > /dev/null
rm -rf "$w/py" "$w/ts"
