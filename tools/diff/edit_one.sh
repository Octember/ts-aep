#!/usr/bin/env bash
# Edit-and-save differential on given samples, with chunk-level byte diff.
# usage: tools/diff/edit_one.sh [-n EDITS] SAMPLE...
set -euo pipefail
cd "$(dirname "$0")/../.."
per=40; [ "${1:-}" = "-n" ] && { per=$2; shift 2; }
w=$(mktemp -d)
(cd .upstream && uv run --project . python ../tools/diff/edit_py.py "$w" "$per" "$@")
bun tools/diff/edit_ts.ts "$w" "$@"
python3 tools/diff/edit_compare.py "$w"
for s in "$@"; do n=${s//\//__}
  if [ -f "$w/$n.py.aep" ] && [ -f "$w/$n.ts.aep" ] && ! cmp -s "$w/$n.py.aep" "$w/$n.ts.aep"; then
    echo "== $s"; (cd .upstream && uv run --project . python ../tools/diff/chunk_diff.py "$w/$n.py.aep" "$w/$n.ts.aep")
  fi
done
echo "work dir: $w (plan, outcomes, saved files)"
