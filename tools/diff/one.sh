#!/usr/bin/env bash
# Diff the TS port against py-aep on given samples; print root differences.
# usage: tools/diff/one.sh samples/models/layer/outPoint_clamp.aep [...]
set -euo pipefail
cd "$(dirname "$0")/../.."
# Absolute: `.upstream` may be a symlink, so `..` inside it is not this checkout.
root=$(pwd)
w=$(mktemp -d)
(cd .upstream && uv run --project . python "$root"/tools/diff/dump_py.py "$w/py" "$@")
bun tools/diff/dump_ts.ts "$w/ts" "$@"
python3 tools/diff/compare.py "$w/py" "$w/ts" "$w/report.json"
echo "dumps: $w"
