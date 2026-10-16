"""Plan an upstream sync: list the py-aep files that changed since UPSTREAM_COMMIT
and the TS twins each change maps to.

usage: python3 tools/sync_upstream.py [TARGET_REF]   (default: origin/main)

Writes .sync/plan.json and one .sync/diffs/<file>.diff per changed Python file.
The plan is the work list for re-translating: each entry keeps the 1:1 mapping
(RULEBOOK.md §1), so a changed module is regenerated as a whole from the new
Python source and its diff, then the gates run (bun test, corpus round trip,
tools/diff). Bump UPSTREAM_COMMIT and tools/fetch-samples.sh picks up the new
samples.
"""

import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
UP = ROOT / ".upstream"


def git(*args):
    return subprocess.run(["git", "-C", str(UP), *args], check=True, capture_output=True, text=True).stdout


def ts_twin(py):
    p = pathlib.PurePosixPath(py)
    if p.name == "__init__.py":
        return str(p.parent / "index.ts")
    if p.parts[0] == "tests" and p.name.startswith("test_"):
        return str(p.with_name(p.stem + ".test.ts"))
    return str(p.with_suffix(".ts"))


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else "origin/main"
    base = (ROOT / "UPSTREAM_COMMIT").read_text().strip()
    git("fetch", "-q", "origin")
    head = git("rev-parse", target).strip()
    out = ROOT / ".sync"
    (out / "diffs").mkdir(parents=True, exist_ok=True)
    entries = []
    for line in git("diff", "--name-status", "-M", base, head, "--", "src/py_aep", "tests").splitlines():
        status, *paths = line.split("\t")
        py = paths[-1]
        if not py.endswith(".py"):
            continue
        entry = {"status": status[0], "py": py, "ts": ts_twin(py)}
        if status[0] == "R":
            entry["renamed_from"] = paths[0]
            entry["ts_from"] = ts_twin(paths[0])
        if status[0] != "D":
            diff = git("diff", base, head, "--", *paths)
            name = py.replace("/", "__") + ".diff"
            (out / "diffs" / name).write_text(diff)
            entry["diff"] = f".sync/diffs/{name}"
        entries.append(entry)
    samples = git("diff", "--name-only", base, head, "--", "samples").splitlines()
    plan = {"base": base, "target": head, "files": entries, "changed_samples": len(samples)}
    (out / "plan.json").write_text(json.dumps(plan, indent=1))
    by = {}
    for e in entries:
        by[e["status"]] = by.get(e["status"], 0) + 1
    print(json.dumps({"base": base[:7], "target": head[:7], "files": len(entries), "by_status": by, "changed_samples": len(samples)}))


if __name__ == "__main__":
    main()
