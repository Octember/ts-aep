"""Fault-injection differential, Python side.

`make OUT SAMPLE...`: for every sample with text layers, perturb the COS
tree inside each layer's `btdk` blob (wrong value kinds, missing keys,
extra keys, null where a container is expected) at the paths py_aep reads,
and save each corrupted project as OUT/cases/<id>.aep plus a manifest
(OUT/cases.jsonl). Every case is chosen deterministically.

`run OUT [ID...]`: parse each corrupted file, dump every text document's
public attributes (and a character / paragraph range), apply a fixed list
of writes, save, and record OUT/py/<id>.json. fault_ts.ts does the same on
the TS port; fault_compare.py diffs the two.

usage: uv run --project .upstream python tools/diff/fault_py.py make OUT SAMPLE...
       uv run --project .upstream python tools/diff/fault_py.py run OUT [ID...]
"""

import hashlib
import io
import json
import pathlib
import re
import sys

import py_aep
from py_aep.cos import CosName, CosParser, serialize

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from dump_py import Dumper  # noqa: E402

PER_SAMPLE = 60

# Shapes of the COS paths py_aep reads (array indices written as `*`).
CHAR_KEYS = "0|1|2|3|4|5|6|7|8|9|11|12|13|18|35|36|52|53|54|56|57|58|62|63|70"
PARA_KEYS = "0|1|2|3|4|5|7|8|9|21|29|33"
READ_SHAPES = [
    r"",
    r"0(/1(/0(/\*(/0(/99|/0(/0|/4|/5|/4/\*)?)?)?)?)?)?",
    r"0/5(/0(/\*(/0(/0|/6(/0|/(" + CHAR_KEYS + r"))?)?)?)?)?",
    r"0/8(/0(/\*(/0(/1(/0(/\*)?)?|/2(/(0|1|6|9|13|14)|/10(/0|/1)?|/11(/4|/18)?)?)?)?)?)?",
    r"1(/0(/0(/0)?)?|/2(/(" + CHAR_KEYS + r"))?|/4(/3)?|/5(/\*(/4(/\*(/0|/1)?)?)?)?)?",
    r"1/1(/\*(/0(/0|/7)?)?)?",
    r"1/1/\*/0/6(/0(/\*(/1|/0(/0(/0|/5|/6(/(" + CHAR_KEYS + r"))?)?)?)?)?)?",
    r"1/1/\*/0/6/0/\*/0/0/6/(53|54)(/99|/0(/0|/1(/\*)?)?)?",
    r"1/1/\*/0/5(/0(/\*(/1|/0(/0(/0|/5(/(" + PARA_KEYS + r"))?|/6)?)?)?)?)?",
    r"1/1/\*/0/8(/0(/\*(/1|/0(/0)?)?)?)?",
    r"1/1/\*/1(/1(/0(/\*(/1|/0(/1)?)?)?)?)?",
    r"1/1/\*/1/2(/\*)?((/6/\*)|/99|/10|/0(/0(/\*)?)?|/15(/0|/7(/7(/\*)?)?)?){0,6}",
]
READ_RE = re.compile("^(" + "|".join(READ_SHAPES) + ")$")

KINDS = ["del", "none", "true", "false", "int", "neg", "float", "float1", "str", "list", "list2", "dict", "name", "extra"]


def value_of(kind):
    return {
        "none": None,
        "true": True,
        "false": False,
        "int": 7,
        "neg": -3,
        "float": 2.5,
        "float1": 1.0,
        "str": "zz",
        "list": [],
        "list2": [1, 2.5],
        "dict": {},
        "name": CosName("Zz"),
    }[kind]


def walk_paths(node, path=(), depth=0):
    """Every (path, shape) below node; arrays visit indices 0, 1 and the last."""
    yield path, "/".join("*" if isinstance(k, int) else k for k in path)
    if depth > 14:
        return
    if isinstance(node, dict):
        for k, v in node.items():
            yield from walk_paths(v, path + (k,), depth + 1)
    elif isinstance(node, list):
        for i in sorted({0, 1, len(node) - 1} & set(range(len(node)))):
            yield from walk_paths(node[i], path + (i,), depth + 1)


def perturb(tree, path, kind):
    """Apply one perturbation in place; False when it does not apply."""
    if not path:
        if kind in ("del", "extra") or not isinstance(tree, dict):
            return False
        return value_of(kind)  # replace the root
    parent = tree
    for k in path[:-1]:
        parent = parent[k]
    last = path[-1]
    target = parent[last]
    if kind == "del":
        del parent[last]
    elif kind == "extra":
        if isinstance(target, dict):
            target["777"] = 7
        elif isinstance(target, list):
            target.append(7)
        else:
            return False
    else:
        parent[last] = value_of(kind)
    return True


def text_documents(app):
    """(layer path, doc) for every text document of every text layer."""
    out = []
    for ci, comp in enumerate(app.project.compositions):
        for li, layer in enumerate(comp.text_layers):
            st = layer.text.source_text
            kfs = st.keyframes
            if kfs:
                for ki, kf in enumerate(kfs):
                    out.append((f"c{ci}.l{li}.k{ki}", kf, "value"))
            else:
                out.append((f"c{ci}.l{li}", st, "value"))
    return out


def make(out, samples):
    cases_dir = out / "cases"
    cases_dir.mkdir(parents=True, exist_ok=True)
    manifest = open(out / "cases.jsonl", "a")
    for sample in samples:
        app = py_aep.parse(sample)
        bodies = []
        for _, holder, attr in text_documents(app):
            doc = getattr(holder, attr)
            body = getattr(doc, "_btdk_body", None)
            if body is not None and all(body is not b for b in bodies):
                bodies.append(body)
        cands = []
        for bi, body in enumerate(bodies[:3]):
            tree = CosParser(io.BytesIO(body.data), len(body.data)).parse()
            for path, shape in walk_paths(tree):
                if not READ_RE.match(shape):
                    continue
                # Only the first two documents (keyframes) of a layer.
                if len(path) > 2 and path[:2] == ("1", "1") and path[2] > 1:
                    continue
                for kind in KINDS:
                    key = f"{sample}|{bi}|{'/'.join(map(str, path))}|{kind}"
                    cands.append((hashlib.sha1(key.encode()).hexdigest(), bi, path, kind))
        # Hash order, but each (shape, kind) pair once before any repeats,
        # so a sample's cases spread over the paths and kinds it has.
        cands.sort()
        seen = set()
        firsts, repeats = [], []
        for c in cands:
            shape = "/".join("*" if isinstance(k, int) else k for k in c[2])
            (repeats if (shape, c[3]) in seen else firsts).append(c)
            seen.add((shape, c[3]))
        n = 0
        for h, bi, path, kind in firsts + repeats:
            if n >= PER_SAMPLE:
                break
            body = bodies[bi]
            original = body.data
            tree = CosParser(io.BytesIO(original), len(original)).parse()
            res = perturb(tree, path, kind)
            if res is False:
                continue
            if not path:
                tree = res
            body.data = serialize(tree)
            case_id = h[:12]
            try:
                app.project.save(str(cases_dir / f"{case_id}.aep"))
            finally:
                body.data = original
            manifest.write(json.dumps({"id": case_id, "sample": sample, "body": bi, "path": list(path), "kind": kind}) + "\n")
            n += 1
    manifest.close()


# Writes applied after the reads, each recorded as ok / exception class.
WRITES = [
    ("doc", "text", "Hi\nthere"),
    ("doc", "font_size", 20.0),
    ("doc", "tracking", 5),
    ("doc", "fill_color", [0.25, 0.5, 0.75]),
    ("doc", "apply_stroke", True),
    ("doc", "leading", 30.0),
    ("doc", "justification", 7414),
    ("doc", "font", "NoSuchFont-Regular"),
    ("doc", "box_text_size", [200.0, 100.0]),
    ("doc", "box_inset_spacing", 4.0),
    ("range", "font_size", 12.0),
    ("range", "kerning", 25),
    ("range", "text", "ab"),
    ("doc", "auto_kern_type", 11413),
]


def err(e):
    n = type(e).__name__
    return n


def run_case(out, case):
    dump = io.StringIO()
    d = Dumper(dump)
    result = {}
    try:
        app = py_aep.parse(str(out / "cases" / f"{case['id']}.aep"))
    except Exception as e:  # noqa: BLE001
        result["parse"] = err(e)
        return result
    docs = text_documents(app)
    writes = []
    for path, holder, attr in docs:
        try:
            doc = getattr(holder, attr)
        except Exception as e:  # noqa: BLE001
            d.emit(path, {"$err": err(e)})
            continue
        d.walk(path, doc)
        for name, args in (("character_range", (0, -1)), ("paragraph_range", (0,)), ("composed_line_range", (0,))):
            try:
                r = getattr(doc, name)(*args)
            except Exception as e:  # noqa: BLE001
                d.emit(f"{path}.{name}()", {"$err": err(e)})
                continue
            d.walk(f"{path}.{name}()", r)
    if docs:
        path, holder, attr = docs[0]
        for target, name, value in WRITES:
            try:
                doc = getattr(holder, attr)
                obj = doc if target == "doc" else doc.character_range(0, 1)
                if name == "justification":
                    value = py_aep.ParagraphJustification(value)
                elif name == "auto_kern_type":
                    value = py_aep.AutoKernType(value)
                setattr(obj, name, value)
                writes.append("ok")
            except Exception as e:  # noqa: BLE001
                writes.append(err(e))
    result["dump"] = dump.getvalue().splitlines()
    result["writes"] = writes
    try:
        buf = out / "py" / f"{case['id']}.aep"
        app.project.save(str(buf))
        result["save"] = hashlib.sha1(buf.read_bytes()).hexdigest()
        buf.unlink()
    except Exception as e:  # noqa: BLE001
        result["save"] = {"$err": err(e)}
    return result


def run(out, ids):
    (out / "py").mkdir(parents=True, exist_ok=True)
    cases = [json.loads(line) for line in open(out / "cases.jsonl")]
    want = set(ids)
    for case in cases:
        if want and case["id"] not in want:
            continue
        (out / "py" / f"{case['id']}.json").write_text(json.dumps(run_case(out, case)))


def main():
    mode, out = sys.argv[1], pathlib.Path(sys.argv[2])
    if mode == "make":
        make(out, sys.argv[3:])
    else:
        run(out, sys.argv[3:])


if __name__ == "__main__":
    main()
