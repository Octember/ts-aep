#!/usr/bin/env bash
# One batch of edit_run.sh. usage: edit_batch.sh EDITS_PER_SAMPLE BATCH_FILE
set -uo pipefail
# Absolute: `.upstream` may be a symlink, so `..` inside it is not this checkout.
root=$(pwd)
per=$1; b=$2
(cd .upstream && tr "\n" "\0" < "$root/$b" | xargs -0 uv run --project . python "$root/tools/diff/edit_py.py" "$root/.diff/edit/out" "$per") 2>> .diff/edit/py.err
tr "\n" "\0" < "$b" | xargs -0 bun tools/diff/edit_ts.ts .diff/edit/out 2>> .diff/edit/ts.err
