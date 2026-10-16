"""Compare edit_py / edit_ts results. usage: edit_compare.py DIR"""
import collections, json, pathlib, re, sys
d = pathlib.Path(sys.argv[1])
tot = dict(samples=0, edits=0, outcome_mismatch=0, bytes_identical=0, bytes_differ=0, save_mismatch=0, no_plan=0)
kinds = collections.Counter(); examples = {}
for plan_f in sorted(d.glob("*.plan.json")):
    name = plan_f.name[: -len(".plan.json")]
    plan = json.loads(plan_f.read_text())
    if "edits" not in plan:
        tot["no_plan"] += 1
        continue
    tot["samples"] += 1
    py = json.loads((d / f"{name}.py.json").read_text())
    tsf = d / f"{name}.ts.json"
    if not tsf.exists():
        kinds["ts crashed"] += 1; examples.setdefault("ts crashed", name); continue
    ts = json.loads(tsf.read_text())
    tot["edits"] += len(plan["edits"])
    for e, a, b in zip(plan["edits"], py["outcomes"], ts["outcomes"]):
        if a != b:
            tot["outcome_mismatch"] += 1
            k = f'{re.sub(r"\[\d+\]", "[]", e["path"])}: py={a} ts={b}'
            kinds[k] += 1; examples.setdefault(k, name)
    if py["save"] != ts["save"]:
        tot["save_mismatch"] += 1
        k = f'save: py={py["save"]} ts={ts["save"]}'; kinds[k] += 1; examples.setdefault(k, name)
    elif py["save"] == "ok":
        same = (d / f"{name}.py.aep").read_bytes() == (d / f"{name}.ts.aep").read_bytes()
        tot["bytes_identical" if same else "bytes_differ"] += 1
        if not same:
            kinds["saved bytes differ"] += 1; examples.setdefault("saved bytes differ", name)
print(json.dumps(tot))
for k, n in kinds.most_common(40):
    print(f"{n:4d}  {k}   e.g. {examples[k]}")
