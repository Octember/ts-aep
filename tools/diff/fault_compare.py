"""Compare fault_py / fault_ts results case by case.

A case matches when both sides agree on the parse outcome, every dumped
text-document line (value or exception class at the same attribute), every
write outcome, and the save outcome / saved bytes.

usage: fault_compare.py OUT   (prints a JSON summary, then the mismatches)
"""
import collections
import json
import pathlib
import sys

out = pathlib.Path(sys.argv[1])
cases = [json.loads(line) for line in open(out / "cases.jsonl")]
tot = collections.Counter()
kinds = collections.Counter()
examples = {}
for case in cases:
    pyf, tsf = out / "py" / f"{case['id']}.json", out / "ts" / f"{case['id']}.json"
    tot["cases"] += 1
    if not pyf.exists() or not tsf.exists():
        tot["missing"] += 1
        k = f"missing {'py' if not pyf.exists() else 'ts'}"
        kinds[k] += 1
        examples.setdefault(k, case["id"])
        continue
    py, ts = json.loads(pyf.read_text()), json.loads(tsf.read_text())
    where = None
    if py.get("parse") != ts.get("parse"):
        where = f"parse: py={py.get('parse')} ts={ts.get('parse')}"
    elif "parse" not in py:
        for a, b in zip(py["dump"], ts["dump"]):
            if json.loads(a) != json.loads(b):
                where = f"dump: py={a[:160]} ts={b[:160]}"
                break
        else:
            if len(py["dump"]) != len(ts["dump"]):
                where = f"dump length py={len(py['dump'])} ts={len(ts['dump'])}"
        if where is None and py["writes"] != ts["writes"]:
            where = f"writes: py={py['writes']} ts={ts['writes']}"
        if where is None and py["save"] != ts["save"]:
            where = f"save: py={py['save']} ts={ts['save']}"
    if where is None:
        tot["identical"] += 1
        if "parse" in py:
            tot["parse_error_both"] += 1
        if any('"$err"' in line for line in py.get("dump", [])):
            tot["read_error_both"] += 1
        if any(w != "ok" for w in py.get("writes", [])):
            tot["write_error_both"] += 1
        if isinstance(py.get("save"), dict):
            tot["save_error_both"] += 1
    else:
        tot["differ"] += 1
        k = f"{'/'.join(map(str, case['path']))} {case['kind']} :: {where}"
        kinds[k] += 1
        examples.setdefault(k, case["id"])
print(json.dumps(dict(tot)))
for k, n in kinds.most_common(200):
    print(f"{n:3d} {examples[k]} {k}")
