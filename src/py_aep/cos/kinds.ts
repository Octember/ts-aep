/**
 * COS value kinds as zod schemas, and Python's operations over COS values.
 *
 * py_aep reads the text-document COS tree with plain Python: an
 * `isinstance` check where it cares about a value's kind, and otherwise a
 * builtin (`float(x)`, `int(x)`, `x + 1`, `x.get(k)`) that raises when the
 * kind is wrong. The kinds below are those `isinstance` checks, run by
 * {@link is} as type guards; the operations raise what the Python builtin
 * raises on every other kind. A reader therefore only holds a narrower
 * type than {@link CosNode} after one of them has run on the value.
 */

import * as z from "zod/mini";
import { AttributeError, KeyError, PyFloat, TypeError_, at, float, int, repr, type_name } from "../../pyrt/index.ts";
import { CosString, type CosDict, type CosNode } from "./cos.ts";

/** `isinstance(x, int)`: a boolean, or an integral JS number other than `-0` (a COS integer). */
export const py_int = z.union([z.boolean(), z.number().check(z.refine((n) => Number.isInteger(n) && !Object.is(n, -0)))]);

/** `isinstance(x, (int, float))`: a boolean, a JS number, or a boxed `PyFloat` (a COS real). */
export const py_number = z.union([z.boolean(), z.number(), z.instanceof(PyFloat)]);

/** `isinstance(x, str)`: a plain string or a `CosString` (lazy: `cos.ts` imports this module). */
export const py_str = z.union([z.string(), z.lazy(() => z.instanceof(CosString))]);

/** Whether `x` is of `kind`; narrows `x` to the kind's type. */
export function is<T extends CosNode>(kind: z.ZodMiniType<T>, x: CosNode | undefined): x is T {
  return kind.safeParse(x).success;
}

/** The ASCII bytes of a COS byte string as text, for `int(b"..")` / `float(b"..")`. */
function bytes_text(x: Uint8Array): string {
  return String.fromCharCode(...x);
}

/** Python `float(x)` on a COS value: `TypeError` for every kind `float()` refuses. */
export function cos_float(x: CosNode): number {
  if (is(py_number, x) || is(py_str, x)) return float(x);
  if (x instanceof Uint8Array) return float(bytes_text(x));
  throw new TypeError_(`float() argument must be a string or a real number, not '${type_name(x)}'`);
}

/** Python `int(x)` on a COS value: `TypeError` for every kind `int()` refuses. */
export function cos_int(x: CosNode): number {
  if (is(py_number, x) || is(py_str, x)) return int(x);
  if (x instanceof Uint8Array) return int(bytes_text(x));
  throw new TypeError_(`int() argument must be a string, a bytes-like object or a real number, not '${type_name(x)}'`);
}

/**
 * `x` as an arithmetic operand (`x + 1`, `a - b`, `abs(x)`): the number
 * behind an int, bool or float; `TypeError` for every other kind.
 */
export function cos_num(x: CosNode): number {
  if (is(py_number, x)) return float(x);
  throw new TypeError_(`unsupported operand type(s) for numeric operation: '${type_name(x)}'`);
}

/**
 * `x` where Python calls a dict method on it (`x.get(..)`,
 * `x.setdefault(..)`): `AttributeError` when `x` is not a dict.
 */
export function cos_dict(x: CosNode, method: string): CosDict {
  if (x instanceof Map) return x;
  throw new AttributeError(`'${type_name(x)}' object has no attribute '${method}'`);
}

/**
 * Python `x[key]` on a COS value: the dict's value, `KeyError` when the
 * key is absent, `TypeError` when `x` is not a dict.
 */
export function cos_item(x: CosNode, key: string): CosNode {
  if (!(x instanceof Map)) {
    if (Array.isArray(x)) throw new TypeError_("list indices must be integers or slices, not str");
    throw new TypeError_(`'${type_name(x)}' object is not subscriptable`);
  }
  const value = x.get(key);
  if (value === undefined) throw new KeyError(repr(key));
  return value;
}

/** Python `d.setdefault(key, value)` on a COS dict. */
export function cos_setdefault(d: CosNode, key: string, value: CosNode): CosNode {
  const dict = cos_dict(d, "setdefault");
  const current = dict.get(key);
  if (current !== undefined) return current;
  dict.set(key, value);
  return value;
}

/** Python `x[key] = value` on a COS value: `TypeError` when `x` is not a dict. */
export function cos_setitem(x: CosNode, key: string, value: CosNode): void {
  if (!(x instanceof Map)) throw new TypeError_(`'${type_name(x)}' object does not support item assignment`);
  x.set(key, value);
}

/** Python `x.pop(key, None)` on a COS value: `AttributeError` when `x` is not a dict. */
export function cos_pop(x: CosNode, key: string): void {
  cos_dict(x, "pop").delete(key);
}

/** Python `x.get(key, default)` on a COS value: `AttributeError` when `x` is not a dict. */
export function cos_get_or<D extends CosNode>(x: CosNode, key: string, default_: D): CosNode {
  const value = cos_dict(x, "get").get(key);
  return value === undefined ? default_ : value;
}

/** Python `x[i]` with an int index: a list item (`IndexError` past the end), a string's character, `KeyError` on a dict, else `TypeError`. */
export function cos_at(x: CosNode, i: number): CosNode {
  if (Array.isArray(x)) return at(x, i);
  if (typeof x === "string" || x instanceof String) return at(String(x), i);
  if (x instanceof Uint8Array) return at(x, i);
  if (x instanceof Map) throw new KeyError(repr(i));
  throw new TypeError_(`'${type_name(x)}' object is not subscriptable`);
}

/** Python `iter(x)` over a COS value: list items, dict keys, string characters or bytes; `TypeError` otherwise. */
export function cos_iter(x: CosNode): CosNode[] {
  if (Array.isArray(x)) return x;
  if (x instanceof Map) return [...x.keys()];
  if (typeof x === "string" || x instanceof String) return Array.from(String(x));
  if (x instanceof Uint8Array) return Array.from(x);
  throw new TypeError_(`'${type_name(x)}' object is not iterable`);
}

/** Python `x.append(item)` on a COS value: `AttributeError` when `x` is not a list. */
export function cos_append(x: CosNode, item: CosNode): void {
  if (!Array.isArray(x)) throw new AttributeError(`'${type_name(x)}' object has no attribute 'append'`);
  x.push(item);
}

/** A COS value as Python hands it out: floats are plain numbers, at any depth. */
export type CosUnboxed =
  | Exclude<CosNode, PyFloat | CosNode[] | CosDict>
  | CosUnboxed[]
  | Map<string, CosUnboxed>;

/**
 * `x` as Python hands it out: a `PyFloat` unboxed to its number. A list or
 * dict is a copy with its floats unboxed (Python returns the stored object;
 * only its identity differs).
 */
export function cos_unbox(x: CosNode): CosUnboxed {
  if (x instanceof PyFloat) return x.value;
  if (Array.isArray(x)) return x.map(cos_unbox);
  if (x instanceof Map) return new Map([...x].map(([k, v]): [string, CosUnboxed] => [k, cos_unbox(v)]));
  return x;
}

/** Python `x.insert(i, item)` on a COS value: `AttributeError` when `x` is not a list. */
export function cos_insert(x: CosNode, i: number, item: CosNode): void {
  if (!Array.isArray(x)) throw new AttributeError(`'${type_name(x)}' object has no attribute 'insert'`);
  x.splice(i, 0, item);
}

/**
 * Python `x in ints` for a set of ints: numbers (and booleans) by value,
 * other hashable kinds never; `TypeError` for the unhashable ones
 * (lists, dicts and the dataclass wrappers).
 */
export function cos_in(x: CosNode | undefined, ints: ReadonlySet<number>): boolean {
  if (x === undefined || x == null) return false;
  if (is(py_number, x)) return ints.has(float(x));
  if (typeof x === "string" || x instanceof String || x instanceof Uint8Array) return false;
  throw new TypeError_(`unhashable type: '${type_name(x)}'`);
}

/** A Python int or float held in COS data: a JS number, or a boxed `PyFloat` for an integral float. */
export type PyNum = number | PyFloat;

/** Whether a Python number is a float (`PyFloat`, or a JS number that is no integer). */
function is_float(x: PyNum): boolean {
  return x instanceof PyFloat || !Number.isInteger(x) || Object.is(x, -0);
}

/** `x` as a Python numeric operand (`a + b`): bool as int, else `TypeError` for non-numbers. */
export function py_num(x: CosNode): PyNum {
  if (typeof x === "boolean") return x ? 1 : 0;
  if (typeof x === "number" || x instanceof PyFloat) return x;
  throw new TypeError_(`unsupported operand type(s) for +: 'int' and '${type_name(x)}'`);
}

/** Python `a + b` / `a - b` on numbers: a float (kept boxed) when either side is one. */
export function py_add(a: PyNum, b: PyNum): PyNum {
  const sum = float(a) + float(b);
  return is_float(a) || is_float(b) ? new PyFloat(sum) : sum;
}

export function py_sub(a: PyNum, b: PyNum): PyNum {
  const diff = float(a) - float(b);
  return is_float(a) || is_float(b) ? new PyFloat(diff) : diff;
}

/** Python `len(x)` on a COS value: `TypeError` for kinds without a length. */
export function cos_len(x: CosNode): number {
  if (Array.isArray(x) || x instanceof Uint8Array) return x.length;
  if (typeof x === "string" || x instanceof String) return String(x).length;
  if (x instanceof Map) return x.size;
  throw new TypeError_(`object of type '${type_name(x)}' has no len()`);
}

/** Python `x.pop(i)` with an int index: a list item (`IndexError` past the end); a dict has no int keys (`KeyError`); else `AttributeError`. */
export function cos_pop_at(x: CosNode, i: number): CosNode {
  if (Array.isArray(x)) {
    const item = at(x, i);
    x.splice(i < 0 ? x.length + i : i, 1);
    return item;
  }
  if (x instanceof Map) throw new KeyError(repr(i));
  throw new AttributeError(`'${type_name(x)}' object has no attribute 'pop'`);
}

/** Python `item in x` for a string `item`: dict keys, list items, substrings; `TypeError` for other kinds. */
export function cos_contains(x: CosNode, item: string): boolean {
  if (x instanceof Map) return x.has(item);
  if (Array.isArray(x)) return x.some((v) => v === item || (v instanceof String && String(v) === item));
  if (typeof x === "string" || x instanceof String) return String(x).includes(item);
  if (x instanceof Uint8Array) throw new TypeError_("a bytes-like object is required, not 'str'");
  throw new TypeError_(`argument of type '${type_name(x)}' is not iterable`);
}
