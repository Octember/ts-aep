"""Reflective dump of everything py_aep exposes for a project, as JSON lines.

Twin of dump_ts.ts: both walk public data descriptors / attributes in sorted
name order, follow each object once (later sightings emit a $ref), and
canonicalize values the same way, so the two outputs diff line by line.

usage: uv run --project .upstream python tools/diff/dump_py.py OUT_DIR SAMPLE...
"""

import enum
import inspect
import json
import math
import pathlib
import sys
import xml.etree.ElementTree as ET

import py_aep

MAX_DEPTH = 40


def num(x):
    if isinstance(x, bool):
        return x
    if isinstance(x, int):
        return x if abs(x) < 2**53 else {"$big": str(x)}
    if math.isnan(x):
        return {"$f": "nan"}
    if math.isinf(x):
        return {"$f": "inf" if x > 0 else "-inf"}
    if x == 0 and math.copysign(1, x) < 0:
        return {"$f": "-0"}
    return int(x) if x.is_integer() and abs(x) < 2**53 else x


def public_names(obj):
    names = set()
    for cls in type(obj).__mro__:
        if cls is object:
            continue
        for name, attr in vars(cls).items():
            if name.startswith("_"):
                continue
            if inspect.isroutine(attr) or isinstance(attr, (staticmethod, classmethod, type)):
                continue
            names.add(name)
    if hasattr(obj, "__dict__"):
        names.update(k for k in vars(obj) if not k.startswith("_"))
    return sorted(names)


def is_container(obj):
    return (
        hasattr(type(obj), "__iter__")
        and hasattr(type(obj), "__len__")
        and not isinstance(obj, (str, bytes, dict))
    )


class Dumper:
    def __init__(self, out):
        self.out = out
        self.seen = {}
        # id() is only unique among live objects: keep every visited object
        # alive so a freed temporary's id is never reused as a false $ref.
        self.keep = []

    def emit(self, path, value):
        self.out.write(json.dumps([path, value], separators=(",", ":"), allow_nan=False) + "\n")

    def walk(self, path, value, depth=0):
        if value is None or isinstance(value, (bool, str)):
            self.emit(path, str(value) if isinstance(value, str) else value)
        elif isinstance(value, enum.Enum):
            self.emit(path, num(value.value) if isinstance(value.value, (int, float)) else value.value)
        elif isinstance(value, (int, float)):
            self.emit(path, num(value))
        elif isinstance(value, (bytes, bytearray)):
            self.emit(path, {"$bytes": bytes(value).hex()})
        elif isinstance(value, pathlib.PurePath):
            self.emit(path, {"$path": str(value)})
        elif isinstance(value, (list, tuple)):
            self.emit(path, {"$list": len(value)})
            for i, v in enumerate(value):
                self.walk(f"{path}[{i}]", v, depth + 1)
        elif isinstance(value, dict):
            keys = list(value)
            self.emit(path, {"$dict": [str(k) for k in keys]})
            for k in keys:
                self.walk(f"{path}{{{k}}}", value[k], depth + 1)
        elif isinstance(value, (set, frozenset)):
            self.emit(path, {"$set": sorted(repr(v) for v in value)})
        elif isinstance(value, ET.Element):
            self.emit(path, {"$el": value.tag, "attrib": dict(value.attrib), "text": value.text, "tail": value.tail})
            for i, child in enumerate(value):
                self.walk(f"{path}[{i}]", child, depth + 1)
        elif callable(value) and not hasattr(value, "__dict__"):
            self.emit(path, {"$callable": True})
        else:
            key = id(value)
            if key in self.seen:
                self.emit(path, {"$ref": self.seen[key]})
                return
            self.seen[key] = path
            self.keep.append(value)
            self.emit(path, {"$obj": type(value).__name__})
            if depth >= MAX_DEPTH:
                return
            for name in public_names(value):
                try:
                    v = getattr(value, name)
                except Exception as e:  # noqa: BLE001 - recorded, compared across languages
                    self.emit(f"{path}.{name}", {"$err": type(e).__name__})
                    continue
                if inspect.ismethod(v) or inspect.isfunction(v):
                    continue
                self.walk(f"{path}.{name}", v, depth + 1)
            if is_container(value):
                try:
                    items = list(value)
                except Exception as e:  # noqa: BLE001
                    self.emit(f"{path}[*]", {"$err": type(e).__name__})
                    return
                self.emit(f"{path}[*]", {"$len": len(items)})
                for i, v in enumerate(items):
                    self.walk(f"{path}[{i}]", v, depth + 1)


def main():
    out_dir = pathlib.Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    for sample in sys.argv[2:]:
        name = sample.replace("/", "__")
        with open(out_dir / f"{name}.jsonl", "w") as out:
            d = Dumper(out)
            try:
                app = py_aep.parse(sample)
            except Exception as e:  # noqa: BLE001
                d.emit("$parse", {"$err": type(e).__name__})
                continue
            d.walk("app", app)


if __name__ == "__main__":
    main()
