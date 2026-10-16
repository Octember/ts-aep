import collections, json, sys
tot = collections.Counter(); ex = {}; per = {}; samples = identical = 0
for f in sys.argv[1:]:
    r = json.load(open(f))
    samples += r["samples"]; identical += r["identical"]
    for t in r["top"]:
        tot[t["attr"]] += t["samples"]; ex.setdefault(t["attr"], t)
    per.update(r.get("per_sample", {}))
json.dump({"samples": samples, "identical": identical, "per_sample": per,
           "top": [dict(ex[k], samples=n) for k, n in tot.most_common()]}, open(".diff/report.json", "w"), indent=1, default=str)
print(json.dumps({"samples": samples, "identical": identical, "differing": samples - identical, "distinct_attr_paths": len(tot)}))
for k, n in tot.most_common(50):
    e = ex[k]
    print(f'{n:4d}  {k}\n      py={json.dumps(e["py"])[:100]}\n      ts={json.dumps(e["ts"])[:100]}')
