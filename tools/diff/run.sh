#!/usr/bin/env bash
# Differential check of the TS port against py-aep on every sample.
# usage: tools/diff/run.sh [JOBS]   -> .diff/report.json
set -euo pipefail
cd "$(dirname "$0")/../.."
jobs=${1:-8}
rm -rf .diff && mkdir -p .diff/batches
find samples/ -name '*.aep' | sort > .diff/samples.txt
split -l 12 .diff/samples.txt .diff/batches/b_
ls .diff/batches/b_* | xargs -P "$jobs" -n 1 tools/diff/batch.sh
python3 tools/diff/aggregate.py .diff/report_b_*.json > .diff/report.txt
head -60 .diff/report.txt
