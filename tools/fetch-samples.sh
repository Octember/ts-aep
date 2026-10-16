#!/usr/bin/env bash
# Check out upstream py-aep at the pinned commit, pull its LFS samples, and
# link them where the translated tests expect them.
set -euo pipefail
cd "$(dirname "$0")/.."
commit=$(cat UPSTREAM_COMMIT)
if [ ! -d .upstream/.git ]; then
  git clone -q https://github.com/forticheprod/py-aep.git .upstream
fi
git -C .upstream fetch -q origin "$commit"
git -C .upstream -c advice.detachedHead=false checkout -q "$commit"
python3 -I tools/lfs_fetch.py "$PWD/.upstream"
ln -sfn .upstream/samples samples
echo "samples ready at $(cat UPSTREAM_COMMIT)"
