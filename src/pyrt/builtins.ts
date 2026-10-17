// Python builtins whose JS spelling differs in behavior, not just syntax.

import { AttributeError, IndexError, KeyError, TypeError_, ValueError } from "./errors.ts";
import { float_repr, PyFloat } from "./num.ts";

/**
 * Python truthiness: empty containers (array, string, bytes, Map, Set,
 * object with `__len__`) are false. JS treats `[]` and an empty
 * Uint8Array as true - never use bare `if (x)` on a container.
 */
export function py_bool(x: any): boolean {
  if (x == null) return false;
  if (x instanceof PyFloat) return x.value !== 0;
  if (typeof x === "boolean") return x;
  if (typeof x === "number") return x !== 0;
  if (typeof x === "bigint") return x !== 0n;
  if (typeof x === "string") return x.length > 0;
  if (Array.isArray(x) || ArrayBuffer.isView(x)) return (x as ArrayLike<unknown>).length > 0;
  if (x instanceof Map || x instanceof Set) return x.size > 0;
  if (typeof x.__bool__ === "function") return x.__bool__();
  if (typeof x.__len__ === "function") return x.__len__() > 0;
  return true;
}

/** `a or b` with Python truthiness (returns the operand, not a boolean). */
export function py_or<A, B>(a: A, b: B): A | B {
  return py_bool(a) ? a : b;
}

/** `a and b` with Python truthiness. */
export function py_and<A, B>(a: A, b: B): A | B {
  return py_bool(a) ? b : a;
}

/** `len(x)` */
export function len(x: any): number {
  if (typeof x === "string" || Array.isArray(x) || ArrayBuffer.isView(x)) return (x as ArrayLike<unknown>).length;
  if (x instanceof Map || x instanceof Set) return x.size;
  if (x && typeof x.__len__ === "function") return x.__len__();
  throw new TypeError(`object of type '${x?.constructor?.name}' has no len()`);
}

/** `range(stop)` / `range(start, stop, step)` */
export function* range(a: number, b?: number, step = 1): Generator<number> {
  const [start, stop] = b === undefined ? [0, a] : [a, b];
  if (step > 0) for (let i = start; i < stop; i += step) yield i;
  else for (let i = start; i > stop; i += step) yield i;
}

/** `zip(a, b, ...)` (shortest; `strict` raises on length mismatch). */
export function zip<T extends unknown[][]>(...arrays: T): { [K in keyof T]: T[K] extends (infer U)[] ? U : never }[] {
  const n = Math.min(...arrays.map((a) => a.length));
  const out: any[] = [];
  for (let i = 0; i < n; i++) out.push(arrays.map((a) => a[i]));
  return out;
}

/** `enumerate(xs, start)` */
export function* enumerate<T>(xs: Iterable<T>, start = 0): Generator<[number, T]> {
  let i = start;
  for (const x of xs) yield [i++, x];
}

/** Python ordering of numbers, strings, bools, and tuples/lists (lexicographic). */
export function py_cmp(a: any, b: any): number {
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const c = py_cmp(a[i], b[i]);
      if (c) return c;
    }
    return a.length - b.length;
  }
  if (typeof a === "string" && typeof b === "string") {
    // Python compares code points; JS `<` compares UTF-16 units.
    const ca = Array.from(a, (c) => c.codePointAt(0)!);
    const cb = Array.from(b, (c) => c.codePointAt(0)!);
    return py_cmp(ca, cb);
  }
  if (a instanceof Uint8Array && b instanceof Uint8Array) return py_cmp(Array.from(a), Array.from(b));
  if (a == null || b == null) throw new TypeError("'<' not supported between instances of 'NoneType'");
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `sorted(xs, key=..., reverse=...)` - stable, Python ordering. */
export function sorted<T>(xs: Iterable<T>, key?: ((x: T) => unknown) | null, reverse = false): T[] {
  const arr = [...xs];
  const k = key ?? ((x: T) => x);
  const decorated = arr.map((x, i) => [k(x), i, x] as const);
  decorated.sort((p, q) => {
    const c = py_cmp(p[0], q[0]);
    return (reverse ? -c : c) || p[1] - q[1];
  });
  return decorated.map((d) => d[2]);
}

/** `min(xs, key=..., default=...)` - first minimal element, like Python. */
export function min<T>(xs: Iterable<T>, key?: ((x: T) => unknown) | null, ...dflt: [T?]): T {
  let best: T | undefined;
  let best_k: unknown;
  let any = false;
  for (const x of xs) {
    const k = key ? key(x) : x;
    if (!any || py_cmp(k, best_k) < 0) [best, best_k, any] = [x, k, true];
  }
  if (!any) {
    if (dflt.length) return dflt[0] as T;
    throw new ValueError("min() iterable argument is empty");
  }
  return best as T;
}

/** `max(xs, key=..., default=...)` - first maximal element, like Python. */
export function max<T>(xs: Iterable<T>, key?: ((x: T) => unknown) | null, ...dflt: [T?]): T {
  let best: T | undefined;
  let best_k: unknown;
  let any = false;
  for (const x of xs) {
    const k = key ? key(x) : x;
    if (!any || py_cmp(k, best_k) > 0) [best, best_k, any] = [x, k, true];
  }
  if (!any) {
    if (dflt.length) return dflt[0] as T;
    throw new ValueError("max() iterable argument is empty");
  }
  return best as T;
}

/** `xs[i]` with Python's negative indexes and IndexError. */
export function at<T>(xs: ArrayLike<T>, i: number): T {
  const j = i < 0 ? xs.length + i : i;
  if (j < 0 || j >= xs.length) throw new IndexError("list index out of range");
  return xs[j];
}

/** `xs[start:end]` for arrays and strings with Python's clamping. */
export function py_slice<T extends { slice(s: number, e: number): T; length: number }>(xs: T, start?: number | null, end?: number | null, step?: number | null): T {
  const n = xs.length;
  if (step != null && step !== 1) {
    const out: unknown[] = [];
    if (step > 0) {
      const s = start == null ? 0 : start < 0 ? Math.max(0, n + start) : Math.min(start, n);
      const e = end == null ? n : end < 0 ? Math.max(0, n + end) : Math.min(end, n);
      for (let i = s; i < e; i += step) out.push((xs as unknown as ArrayLike<unknown>)[i]);
    } else {
      const s = start == null ? n - 1 : start < 0 ? n + start : Math.min(start, n - 1);
      const e = end == null ? -1 : end < 0 ? Math.max(-1, n + end) : end;
      for (let i = s; i > e; i += step) out.push((xs as unknown as ArrayLike<unknown>)[i]);
    }
    return (typeof xs === "string" ? out.join("") : out) as unknown as T;
  }
  const s = start == null ? 0 : start < 0 ? Math.max(0, n + start) : Math.min(start, n);
  const e = end == null ? n : end < 0 ? Math.max(0, n + end) : Math.min(end, n);
  return xs.slice(s, Math.max(s, e));
}

/** `d[k]` on a Map with KeyError. */
export function getitem<K, V>(d: Map<K, V>, k: K): V {
  if (!d.has(k)) throw new KeyError(repr(k));
  return d.get(k)!;
}

/** `d.get(k, default)` on a Map (None, not undefined, when absent). */
export function dict_get<K, V, D = null>(d: Map<K, V>, k: K, dflt: D = null as D): V | D {
  return d.has(k) ? d.get(k)! : dflt;
}

/** `d.setdefault(k, v)` */
export function setdefault<K, V>(d: Map<K, V>, k: K, v: V): V {
  if (!d.has(k)) d.set(k, v);
  return d.get(k)!;
}

/** `d.pop(k, default)` */
export function dict_pop<K, V>(d: Map<K, V>, k: K, ...dflt: [V?]): V {
  if (d.has(k)) {
    const v = d.get(k)!;
    d.delete(k);
    return v;
  }
  if (dflt.length) return dflt[0] as V;
  throw new KeyError(repr(k));
}

/**
 * Key for a Map/Set keyed by a Python tuple (or any hashable compound
 * value): `tkey(a, b)` stands for `(a, b)`.
 */
export function tkey(...parts: unknown[]): string {
  return JSON.stringify(parts, (_k, v) => (typeof v === "bigint" ? `${v}n` : v instanceof Uint8Array ? Array.from(v) : v));
}

/** `getattr(obj, name, default)` */
export function getattr(obj: any, name: string, ...dflt: [unknown?]): any {
  if (obj != null && name in Object(obj)) return obj[name];
  if (dflt.length) return dflt[0];
  throw new AttributeError(`'${obj?.constructor?.name}' object has no attribute '${name}'`);
}

/** `hasattr(obj, name)` */
export function hasattr(obj: any, name: string): boolean {
  if (obj == null || !(name in Object(obj))) return false;
  try {
    void obj[name];
    return true;
  } catch (e) {
    if (e instanceof AttributeError) return false;
    throw e;
  }
}

/** `x in container` for arrays, strings (substring), Maps (keys), Sets. */
export function contains(container: any, x: any): boolean {
  if (typeof container === "string") return container.includes(x);
  if (container instanceof Map || container instanceof Set) return container.has(x);
  if (Array.isArray(container)) return container.some((y) => py_eq(y, x));
  if (container && typeof container.__contains__ === "function") return container.__contains__(x);
  throw new TypeError("argument of type is not iterable");
}

/** `a == b` for values (numbers, strings, arrays/tuples, bytes, Maps, objects with `__eq__`). */
export function py_eq(a: any, b: any): boolean {
  if (a === b) return true;
  if (a instanceof PyFloat) a = a.value;
  if (b instanceof PyFloat) b = b.value;
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (typeof a === "number" && typeof b === "boolean") return a === (b ? 1 : 0);
  if (typeof a === "boolean" && typeof b === "number") return (a ? 1 : 0) === b;
  if ((typeof a === "bigint" || typeof b === "bigint") && (typeof a === "number" || typeof a === "bigint") && (typeof b === "number" || typeof b === "bigint")) {
    return BigInt(a) === BigInt(b);
  }
  if (a == null || b == null) return false;
  if (a instanceof String || b instanceof String) return String(a) === String(b);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => py_eq(x, b[i]));
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) if (!b.has(k) || !py_eq(v, b.get(k))) return false;
    return true;
  }
  if (a instanceof Set && b instanceof Set) return a.size === b.size && [...a].every((x) => b.has(x));
  if (typeof a.__eq__ === "function") return a.__eq__(b);
  return false;
}

// Not `str.isprintable()` (Py_UNICODE_ISPRINTABLE): other / separator categories except the space.
const NON_PRINTABLE = /^[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]$/u;

/** Python `repr(x)` for messages. */
export function repr(x: any): string {
  if (x == null) return "None";
  if (typeof x === "boolean") return x ? "True" : "False";
  if (typeof x === "number") return Number.isInteger(x) ? String(x) : float_repr(x);
  if (x instanceof PyFloat) return float_repr(x.value);
  if (typeof x === "bigint") return x.toString();
  if (typeof x === "string" || x instanceof String) {
    const s = String(x);
    const q = s.includes("'") && !s.includes('"') ? '"' : "'";
    let body = "";
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      if (ch === "\\") body += "\\\\";
      else if (ch === q) body += "\\" + q;
      else if (ch === "\n") body += "\\n";
      else if (ch === "\r") body += "\\r";
      else if (ch === "\t") body += "\\t";
      else if (cp < 0x20 || cp === 0x7f) body += "\\x" + cp.toString(16).padStart(2, "0");
      else if (cp < 0x7f || !NON_PRINTABLE.test(ch)) body += ch;
      else if (cp <= 0xff) body += "\\x" + cp.toString(16).padStart(2, "0");
      else if (cp <= 0xffff) body += "\\u" + cp.toString(16).padStart(4, "0");
      else body += "\\U" + cp.toString(16).padStart(8, "0");
    }
    return q + body + q;
  }
  if (x instanceof Uint8Array) {
    let s = "";
    for (const c of x) {
      if (c === 0x5c) s += "\\\\";
      else if (c === 0x27) s += "\\'";
      else if (c === 0x09) s += "\\t";
      else if (c === 0x0a) s += "\\n";
      else if (c === 0x0d) s += "\\r";
      else if (c >= 0x20 && c < 0x7f) s += String.fromCharCode(c);
      else s += "\\x" + c.toString(16).padStart(2, "0");
    }
    return `b'${s}'`;
  }
  if (Array.isArray(x)) return `[${x.map(repr).join(", ")}]`;
  if (x instanceof Map) return `{${[...x].map(([k, v]) => `${repr(k)}: ${repr(v)}`).join(", ")}}`;
  if (x instanceof Set) return x.size ? `{${[...x].map(repr).join(", ")}}` : "set()";
  if (typeof x.__repr__ === "function") return x.__repr__();
  return String(x);
}

/**
 * `type(x).__name__`. JS cannot tell a tuple from a list (both "list") or an
 * int-valued float from an int unless it is a boxed `PyFloat`; class
 * instances report their constructor name, which equals the Python class name.
 */
export function type_name(x: any): string {
  if (x == null) return "NoneType";
  if (typeof x === "boolean") return "bool";
  if (x instanceof PyFloat) return "float";
  if (typeof x === "number") return Number.isInteger(x) ? "int" : "float";
  if (typeof x === "bigint") return "int";
  if (typeof x === "string") return "str";
  if (typeof x === "function") return x.prototype && /^class\b/.test(Function.prototype.toString.call(x)) ? "type" : "function";
  if (x instanceof Uint8Array) return "bytes";
  if (Array.isArray(x)) return "list";
  if (x instanceof Map) return "dict";
  if (x instanceof Set) return "set";
  return x.constructor?.name ?? "object";
}

/** `[x, ...] * n` (list repetition; `n <= 0` gives an empty list). */
export function list_mul<T>(xs: readonly T[], n: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(...xs);
  return out;
}

/**
 * `mapping.items()` over the Mapping protocol: a `Map`'s entries, an
 * object's own `items()`, or `keys()` + `__getitem__`.
 */
export function mapping_items(m: any): [any, any][] {
  if (m instanceof Map) return [...m.entries()];
  if (typeof m.items === "function") return [...m.items()];
  if (typeof m.keys === "function" && typeof m.__getitem__ === "function") {
    return [...m.keys()].map((k: unknown): [unknown, unknown] => [k, m.__getitem__(k)]);
  }
  throw new TypeError_(`'${type_name(m)}' object is not a mapping`);
}

/**
 * `dict(arg)`: a new `Map` from a mapping (`Map`, an object with `keys()` /
 * `items()`) or an iterable of key/value pairs, in iteration order.
 */
export function dict<K = any, V = any>(arg?: any): Map<K, V> {
  if (arg == null) return new Map();
  if (arg instanceof Map) return new Map(arg);
  // CPython: anything with `keys()` is a mapping, read through `keys()` + `__getitem__`.
  if (typeof arg.keys === "function" && typeof arg.__getitem__ === "function") {
    return new Map([...arg.keys()].map((k: any): [any, any] => [k, arg.__getitem__(k)]));
  }
  const out = new Map<K, V>();
  let i = 0;
  for (const pair of arg as Iterable<any>) {
    const kv = [...pair];
    if (kv.length !== 2) {
      throw new ValueError(`dictionary update sequence element #${i} has length ${kv.length}; 2 is required`);
    }
    out.set(kv[0], kv[1]);
    i++;
  }
  return out;
}

/** Python `str(x)` for messages. */
export function str(x: any): string {
  if (typeof x === "string") return x;
  if (x instanceof String) return String(x);
  if (x != null && typeof x.__str__ === "function") return x.__str__();
  return repr(x);
}

/** `str.isdigit()`, `.isalpha()`, `.isspace()`, `.isupper()`, `.islower()` (Unicode-aware). */
export const isdigit = (s: string): boolean => s.length > 0 && /^\p{Nd}+$/u.test(s);
export const isalpha = (s: string): boolean => s.length > 0 && /^\p{L}+$/u.test(s);
export const isalnum = (s: string): boolean => s.length > 0 && /^[\p{L}\p{N}]+$/u.test(s);
export const isspace = (s: string): boolean => s.length > 0 && /^\s+$/u.test(s);
export const isupper = (s: string): boolean => /\p{Lu}|\p{Lt}/u.test(s) && !/\p{Ll}/u.test(s);
export const islower = (s: string): boolean => /\p{Ll}/u.test(s) && !/\p{Lu}|\p{Lt}/u.test(s);

/** `s.strip(chars)` / `.lstrip` / `.rstrip` (whitespace when chars omitted). */
export function strip(s: string, chars?: string | null): string {
  return rstrip(lstrip(s, chars), chars);
}
export function lstrip(s: string, chars?: string | null): string {
  if (chars == null) return s.replace(/^\s+/u, "");
  let i = 0;
  while (i < s.length && chars.includes(s[i])) i++;
  return s.slice(i);
}
export function rstrip(s: string, chars?: string | null): string {
  if (chars == null) return s.replace(/\s+$/u, "");
  let e = s.length;
  while (e > 0 && chars.includes(s[e - 1])) e--;
  return s.slice(0, e);
}

// One `str.isspace()` character (all are in the BMP).
const PY_WS = /^[\t\n\v\f\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/;

/** `s.split(sep, maxsplit)`; `sep=None` splits on whitespace runs. */
export function split(s: string, sep?: string | null, maxsplit = -1): string[] {
  if (sep == null) {
    // Runs of str.isspace() characters separate fields; a maxsplit remainder keeps its trailing whitespace.
    const out: string[] = [];
    const n = s.length;
    let i = 0;
    while (i < n) {
      while (i < n && PY_WS.test(s[i])) i++;
      if (i === n) break;
      if (maxsplit >= 0 && out.length === maxsplit) {
        out.push(s.slice(i));
        break;
      }
      let j = i;
      while (j < n && !PY_WS.test(s[j])) j++;
      out.push(s.slice(i, j));
      i = j;
    }
    return out;
  }
  if (sep === "") throw new ValueError("empty separator");
  const parts = s.split(sep);
  if (maxsplit < 0 || parts.length <= maxsplit + 1) return parts;
  return [...parts.slice(0, maxsplit), parts.slice(maxsplit).join(sep)];
}

/** `copy.deepcopy`: clones arrays, Maps, Sets, bytes, plain objects and class instances (prototype kept). */
export function deepcopy<T>(x: T, memo = new Map<unknown, unknown>()): T {
  if (x === null || typeof x !== "object") return x;
  if (memo.has(x)) return memo.get(x) as T;
  if (x instanceof Uint8Array) return x.slice() as unknown as T;
  if (Array.isArray(x)) {
    const out: unknown[] = [];
    memo.set(x, out);
    for (const v of x) out.push(deepcopy(v, memo));
    return out as unknown as T;
  }
  if (x instanceof Map) {
    const out = new Map();
    memo.set(x, out);
    for (const [k, v] of x) out.set(deepcopy(k, memo), deepcopy(v, memo));
    return out as unknown as T;
  }
  if (x instanceof Set) {
    const out = new Set();
    memo.set(x, out);
    for (const v of x) out.add(deepcopy(v, memo));
    return out as unknown as T;
  }
  if (typeof (x as unknown as { __deepcopy__(memo: Map<unknown, unknown>): T }).__deepcopy__ === "function") return (x as unknown as { __deepcopy__(memo: Map<unknown, unknown>): T }).__deepcopy__(memo);
  const out =
    x instanceof String
      ? Reflect.construct(String, [x.valueOf()], (x as { constructor: Function }).constructor)
      : Object.create(Object.getPrototypeOf(x));
  memo.set(x, out);
  for (const k of Reflect.ownKeys(x as object)) {
    if (x instanceof String && (k === "length" || (typeof k === "string" && /^\d+$/.test(k)))) continue;
    const d = Object.getOwnPropertyDescriptor(x, k)!;
    if ("value" in d) d.value = deepcopy(d.value, memo);
    Object.defineProperty(out, k, d);
  }
  return out;
}

/** `copy.copy`: shallow clone keeping the prototype. */
export function copy<T>(x: T): T {
  if (x === null || typeof x !== "object") return x;
  if (Array.isArray(x)) return [...x] as unknown as T;
  if (x instanceof Uint8Array) return x.slice() as unknown as T;
  if (x instanceof Map) return new Map(x) as unknown as T;
  if (x instanceof Set) return new Set(x) as unknown as T;
  if (x instanceof String) {
    const out = Reflect.construct(String, [x.valueOf()], (x as { constructor: Function }).constructor);
    for (const k of Object.keys(x)) if (!/^\d+$/.test(k)) out[k] = (x as unknown as Record<string, unknown>)[k];
    return out as unknown as T;
  }
  if (x instanceof String) return Object.assign(Object.setPrototypeOf(new String(x.valueOf()), Object.getPrototypeOf(x)), x);
  return Object.assign(Object.create(Object.getPrototypeOf(x)), x);
}

/** `functools.lru_cache(maxsize=None)` for functions of primitive / object-identity arguments. */
export function lru_cache<A extends unknown[], R>(fn: (...args: A) => R): ((...args: A) => R) & { cache_clear(): void } {
  const roots = new Map<unknown, unknown>();
  const RESULT = Symbol("result");
  const wrapped = (...args: A): R => {
    let node: Map<any, any> = roots;
    for (const a of args) {
      let next = node.get(a);
      if (!next) node.set(a, (next = new Map()));
      node = next;
    }
    if (!node.has(RESULT)) node.set(RESULT, fn(...args));
    return node.get(RESULT);
  };
  return Object.assign(wrapped, { cache_clear: () => roots.clear() });
}
