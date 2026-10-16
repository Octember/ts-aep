"""Fetch the Git LFS objects of an upstream py-aep checkout (samples, assets) via the GitHub LFS batch API."""
import json, sys, urllib.request, concurrent.futures as cf
from pathlib import Path

repo = Path(sys.argv[1])
pointers = {}
for p in (q for q in repo.rglob("*") if q.is_file() and ".git" not in q.parts and q.stat().st_size < 400):
    head = p.read_bytes()[:200]
    if not head.startswith(b"version https://git-lfs"):
        continue
    fields = dict(line.split(" ", 1) for line in head.decode().strip().splitlines())
    pointers.setdefault(fields["oid"].split(":")[1], []).append((p, int(fields["size"])))

oids = list(pointers)
print(len(oids), "objects")

def batch(chunk):
    req = urllib.request.Request(
        "https://github.com/forticheprod/py-aep.git/info/lfs/objects/batch",
        data=json.dumps({"operation": "download", "transfers": ["basic"],
                         "objects": [{"oid": o, "size": pointers[o][0][1]} for o in chunk]}).encode(),
        headers={"Accept": "application/vnd.git-lfs+json", "Content-Type": "application/vnd.git-lfs+json"})
    return json.load(urllib.request.urlopen(req))["objects"]

def download(obj):
    href = obj["actions"]["download"]
    data = urllib.request.urlopen(urllib.request.Request(href["href"], headers=href.get("header", {}))).read()
    for path, _ in pointers[obj["oid"]]:
        path.write_bytes(data)

objects = [o for i in range(0, len(oids), 100) for o in batch(oids[i:i + 100])]
with cf.ThreadPoolExecutor(16) as pool:
    list(pool.map(download, objects))
print("done")
