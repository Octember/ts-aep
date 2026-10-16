"""First raw-framing difference between two RIFX files (no re-serialization).
usage: python3 tools/diff/raw_diff.py A.aep B.aep"""
import struct, sys

def walk(buf, start, end, path, out):
    p = start
    while p + 8 <= end:
        t = buf[p:p+4].decode("latin-1"); (n,) = struct.unpack(">I", buf[p+4:p+8])
        body = p + 8
        if t in ("LIST", "RIFX") and n >= 4:
            lt = buf[body:body+4].decode("latin-1")
            out.append((f"{path}/{t}:{lt}", n, None))
            if lt != "btdk":
                walk(buf, body + 4, min(body + n, end), f"{path}/{lt}", out)
            else:
                out.append((f"{path}/{lt}/<btdk>", n, buf[body+4:body+n]))
        else:
            out.append((f"{path}/{t}", n, buf[body:body+n]))
        p = body + n + (n & 1)
    if p != end:
        out.append((f"{path}/<tail {end - p} bytes>", end - p, buf[p:end]))
    return out

a = open(sys.argv[1], "rb").read(); b = open(sys.argv[2], "rb").read()
(na,) = struct.unpack(">I", a[4:8]); (nb,) = struct.unpack(">I", b[4:8])
A = walk(a, 0, 8 + na, "", []); B = walk(b, 0, 8 + nb, "", [])
for i, (x, y) in enumerate(zip(A, B)):
    if x[0] != y[0] or (x[2] is not None and x[2] != y[2]) or (x[2] is None and x[1] != y[1] and False):
        print(i, "\n  py:", x[0], x[1], (x[2] or b"")[:120], "\n  ts:", y[0], y[1], (y[2] or b"")[:120]); break
else:
    print("no leaf difference; lengths", len(A), len(B))
print("trailing xmp equal:", a[8+na:] == b[8+nb:])
