#!/usr/bin/env bash
# Edit-and-save differential over every sample. usage: tools/diff/edit_run.sh [EDITS_PER_SAMPLE] [JOBS]
set -euo pipefail
cd "$(dirname "$0")/../.."
per=${1:-40}; jobs=${2:-8}
rm -rf .diff/edit && mkdir -p .diff/edit/batches
find samples/ -name '*.aep' | sort > .diff/edit/samples.txt
split -l 12 .diff/edit/samples.txt .diff/edit/batches/b_
ls .diff/edit/batches/b_* | xargs -P "$jobs" -n 1 tools/diff/edit_batch.sh "$per"
python3 tools/diff/edit_compare.py .diff/edit/out
