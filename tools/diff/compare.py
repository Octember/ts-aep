"""Diff dump_py / dump_ts outputs. usage: compare.py PY_DIR TS_DIR [REPORT_JSON]"""
import collections, json, pathlib, re, sys

py_dir, ts_dir = map(pathlib.Path, sys.argv[1:3])
report = {"samples": 0, "identical": 0, "by_attr": collections.Counter(), "examples": {}, "per_sample": {}}

def norm_path(p):
    return re.sub(r"\[\d+\]|\{[^}]*\}", "[]", p)

def load(f):
    if not f.exists():
        return None
    return [json.loads(l) for l in f.open()]

for pf in sorted(py_dir.glob("*.jsonl")):
    report["samples"] += 1
    py = load(pf)
    ts = load(ts_dir / pf.name)
    if ts is None:
        report["per_sample"][pf.stem] = "missing ts dump"
        continue
    if py and py[0][0] == "$parse":
        # Python itself cannot parse this sample: a harness problem, never "identical".
        report["per_sample"][pf.stem] = f"python parse error {py[0][1]}"
        continue
    pm = dict((p, v) for p, v in py)
    tm = dict((p, v) for p, v in ts)
    diffs = []
    for p, v in py:
        if p not in tm:
            diffs.append((p, v, "<absent>"))
        elif tm[p] != v:
            diffs.append((p, v, tm[p]))
    for p, v in ts:
        if p not in pm:
            diffs.append((p, "<absent>", v))
    # Keep root differences only: drop anything under a path that already differs.
    diffs.sort(key=lambda d: d[0])
    roots = []
    for d in diffs:
        if roots and (d[0].startswith(roots[-1][0] + ".") or d[0].startswith(roots[-1][0] + "[") or d[0].startswith(roots[-1][0] + "{")):
            continue
        roots.append(d)
    diffs = roots
    if not diffs:
        report["identical"] += 1
        continue
    report["per_sample"][pf.stem] = len(diffs)
    seen_here = set()
    for p, a, b in diffs:
        k = norm_path(p)
        if k in seen_here:
            continue
        seen_here.add(k)
        report["by_attr"][k] += 1
        report["examples"].setdefault(k, {"sample": pf.stem, "path": p, "py": a, "ts": b})

out = {
    "per_sample": report["per_sample"],
    "samples": report["samples"],
    "identical": report["identical"],
    "differing": len(report["per_sample"]),
    "top": [{"attr": k, "samples": n, **report["examples"][k]} for k, n in report["by_attr"].most_common()],
}
if len(sys.argv) > 3:
    json.dump(out, open(sys.argv[3], "w"), indent=1, default=str)
print(json.dumps({k: out[k] for k in ("samples", "identical", "differing")}))
for t in out["top"][:40]:
    print(f'{t["samples"]:4d}  {t["attr"]}  py={json.dumps(t["py"])[:70]}  ts={json.dumps(t["ts"])[:70]}')
