#!/usr/bin/env bash
# One batch of edit_run.sh. usage: edit_batch.sh EDITS_PER_SAMPLE BATCH_FILE
set -uo pipefail
per=$1; b=$2
(cd .upstream && xargs uv run --project . python ../tools/diff/edit_py.py ../.diff/edit/out "$per" < "../$b") 2>> .diff/edit/py.err
xargs bun tools/diff/edit_ts.ts .diff/edit/out < "$b" 2>> .diff/edit/ts.err
