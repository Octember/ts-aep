"""First differing chunks between two .aep files (paths through the RIFX tree).
usage: uv run --project .upstream python tools/diff/chunk_diff.py A.aep B.aep"""
import sys
from py_aep.binary.chunk import ListChunk, read_aep

def flat(chunk, path, out):
    if isinstance(chunk, ListChunk):
        for i, c in enumerate(chunk.chunks):
            flat(c, f"{path}/{chunk.list_type}[{i}]", out)
    else:
        out.append((f"{path}/{chunk.chunk_type}", chunk.tobytes()))
    return out

def load(p):
    with open(p, "rb") as f:
        rifx, xmp = read_aep(f)
    return flat(rifx, "", []), xmp

(a, xa), (b, xb) = load(sys.argv[1]), load(sys.argv[2])
shown = 0
for i in range(max(len(a), len(b))):
    pa, ba = a[i] if i < len(a) else ("<end>", b"")
    pb, bb = b[i] if i < len(b) else ("<end>", b"")
    if pa != pb or ba != bb:
        print(f"{pa}  vs  {pb}\n  py: {ba[:96].hex()}\n  ts: {bb[:96].hex()}")
        shown += 1
        if shown >= 8: break
if xa != xb: print("XMP packet differs")
if not shown and xa == xb: print("chunk trees identical")
