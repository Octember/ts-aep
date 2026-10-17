// Python's `json.loads` / `json.dumps` (CPython 3.12 C scanner and encoder).
//
// Decoded values keep Python's types: an object is a `Map` (source
// key order, a repeated key keeps its first position and its last value), a
// number with a fraction or exponent is a boxed `PyFloat` (so `1.0` stays a
// float), an integer beyond 2**53 is a `bigint`. NaN / Infinity / -Infinity
// are accepted, as Python does.

import { ValueError, TypeError_ } from "./errors.ts";
import { float_repr, PyFloat, pyfloat } from "./num.ts";
import { py_cmp, type_name } from "./builtins.ts";
import { decode } from "./codecs.ts";

/** `json.JSONDecodeError` (a `ValueError`) with CPython's message and position fields. */
export class JSONDecodeError extends ValueError {
  declare msg: string;
  declare doc: string;
  declare pos: number;
  declare lineno: number;
  declare colno: number;
  constructor(msg: string, doc: string, pos: number) {
    const lineno = count_nl(doc, pos) + 1;
    const colno = pos - doc.lastIndexOf("\n", pos - 1);
    super(`${msg}: line ${lineno} column ${colno} (char ${pos})`);
    this.msg = msg;
    this.doc = doc;
    this.pos = pos;
    this.lineno = lineno;
    this.colno = colno;
  }
}

function count_nl(s: string, end: number): number {
  let n = 0;
  for (let i = s.indexOf("\n"); i !== -1 && i < end; i = s.indexOf("\n", i + 1)) n++;
  return n;
}

export type LoadsOptions = {
  /** `parse_float`: called with the number's text; default boxes it as `PyFloat`. */
  parse_float?: (text: string) => unknown;
  /** `parse_int`: called with the number's text; default `number`, or `bigint` past 2**53. */
  parse_int?: (text: string) => unknown;
  /** `parse_constant`: called with "NaN", "Infinity" or "-Infinity". */
  parse_constant?: (text: string) => unknown;
  /** `object_pairs_hook`: builds an object from its `[key, value]` pairs (default: `Map`). */
  object_pairs_hook?: (pairs: [string, unknown][]) => unknown;
};

function default_int(text: string): number | bigint {
  const n = Number(text);
  if (n === 0) return 0; // `-0` is the int 0
  return Number.isSafeInteger(n) ? n : BigInt(text);
}

const default_float = (text: string): PyFloat => pyfloat(Number(text));
const CONSTANTS: Record<string, number> = { NaN: NaN, Infinity: Infinity, "-Infinity": -Infinity };

/** `json.detect_encoding(b)` */
function detect_encoding(b: Uint8Array): string {
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return "utf-8-sig";
  if ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff)) {
    return b[0] === 0xff && b[1] === 0xfe && b[2] === 0 && b[3] === 0 ? "utf-32" : "utf-16";
  }
  if (b[0] === 0 && b[1] === 0 && b[2] === 0xfe && b[3] === 0xff) return "utf-32";
  if (b.length >= 4) {
    if (!b[0]) return b[1] ? "utf-16-be" : "utf-32-be";
    if (!b[1]) return b[2] || b[3] ? "utf-16-le" : "utf-32-le";
  } else if (b.length === 2) {
    if (!b[0]) return "utf-16-be";
    if (!b[1]) return "utf-16-le";
  }
  return "utf-8";
}

const WS = new Set([" ", "\t", "\n", "\r"]);
const ESC: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

/**
 * `json.loads(s)`; `s` may be `str` or `bytes` (encoding sniffed like CPython).
 * NOTE: bytes decode strictly; CPython's `surrogatepass` (encoded surrogates) is not modelled.
 */
export function json_loads(s: string | Uint8Array, opts: LoadsOptions = {}): any {
  let text: string;
  if (s instanceof Uint8Array) {
    const enc = detect_encoding(s);
    text = enc === "utf-8-sig" ? decode(s.subarray(3), "utf-8") : decode(s, enc);
  } else {
    text = String(s);
    if (text.startsWith("﻿")) throw new JSONDecodeError("Unexpected UTF-8 BOM (decode using utf-8-sig)", text, 0);
  }
  const parse_float = opts.parse_float ?? default_float;
  const parse_int = opts.parse_int ?? default_int;
  const parse_constant = opts.parse_constant ?? ((c: string) => CONSTANTS[c]);
  const pairs_hook = opts.object_pairs_hook ?? ((pairs: [string, unknown][]) => new Map(pairs));
  const n = text.length;
  const fail = (msg: string, pos: number): never => {
    throw new JSONDecodeError(msg, text, pos);
  };
  const skip = (i: number): number => {
    while (i < n && WS.has(text[i])) i++;
    return i;
  };

  // scanstring: `i` is just past the opening quote; returns [value, end].
  const scanstring = (i: number): [string, number] => {
    const begin = i - 1;
    let out = "";
    for (;;) {
      let j = i;
      while (j < n) {
        const c = text.charCodeAt(j);
        if (c === 0x22 || c === 0x5c) break;
        if (c < 0x20) fail("Invalid control character at", j);
        j++;
      }
      if (j >= n) fail("Unterminated string starting at", begin);
      out += text.slice(i, j);
      if (text[j] === '"') return [out, j + 1];
      // Backslash escape.
      j++;
      if (j >= n) fail("Unterminated string starting at", begin);
      const e = text[j];
      if (e !== "u") {
        const r = ESC[e];
        if (r === undefined) fail("Invalid \\escape", j - 1);
        out += r;
        i = j + 1;
        continue;
      }
      const hex4 = (at: number): number => {
        const h = text.slice(at, at + 4);
        if (h.length !== 4 || !/^[0-9a-fA-F]{4}$/.test(h)) fail("Invalid \\uXXXX escape", at - 1);
        return parseInt(h, 16);
      };
      let u = hex4(j + 1);
      j += 5;
      if (u >= 0xd800 && u <= 0xdbff && text[j] === "\\" && text[j + 1] === "u") {
        const u2 = hex4(j + 2);
        if (u2 >= 0xdc00 && u2 <= 0xdfff) {
          out += String.fromCharCode(u, u2);
          i = j + 6;
          continue;
        }
      }
      out += String.fromCharCode(u);
      i = j;
    }
  };

  const NUM = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?/y;

  // scan_once: returns [value, end] or null (StopIteration) at `i`.
  const scan_once = (i: number): [unknown, number] | null => {
    if (i >= n) return null;
    const c = text[i];
    if (c === '"') return scanstring(i + 1);
    if (c === "{") return parse_object(i + 1);
    if (c === "[") return parse_array(i + 1);
    if (c === "n" && text.startsWith("null", i)) return [null, i + 4];
    if (c === "t" && text.startsWith("true", i)) return [true, i + 4];
    if (c === "f" && text.startsWith("false", i)) return [false, i + 5];
    if (c === "N" && text.startsWith("NaN", i)) return [parse_constant("NaN"), i + 3];
    if (c === "I" && text.startsWith("Infinity", i)) return [parse_constant("Infinity"), i + 8];
    if (c === "-" && text.startsWith("-Infinity", i)) return [parse_constant("-Infinity"), i + 9];
    NUM.lastIndex = i;
    const m = NUM.exec(text);
    if (m === null) return null;
    const end = i + m[0].length;
    return [m[1] !== undefined || m[2] !== undefined ? parse_float(m[0]) : parse_int(m[0]), end];
  };

  const parse_object = (i: number): [unknown, number] => {
    const pairs: [string, unknown][] = [];
    i = skip(i);
    if (text[i] === "}") return [pairs_hook(pairs), i + 1];
    for (;;) {
      if (text[i] !== '"') fail("Expecting property name enclosed in double quotes", i);
      const [key, kend] = scanstring(i + 1);
      i = skip(kend);
      if (text[i] !== ":") fail("Expecting ':' delimiter", i);
      i = skip(i + 1);
      const r = scan_once(i);
      if (r === null) fail("Expecting value", i);
      pairs.push([key, r![0]]);
      i = skip(r![1]);
      if (text[i] === "}") return [pairs_hook(pairs), i + 1];
      if (text[i] !== ",") fail("Expecting ',' delimiter", i);
      i = skip(i + 1);
    }
  };

  const parse_array = (i: number): [unknown[], number] => {
    const out: unknown[] = [];
    i = skip(i);
    if (text[i] === "]") return [out, i + 1];
    for (;;) {
      const r = scan_once(i);
      if (r === null) fail("Expecting value", i);
      out.push(r![0]);
      i = skip(r![1]);
      if (text[i] === "]") return [out, i + 1];
      if (text[i] !== ",") fail("Expecting ',' delimiter", i);
      i = skip(i + 1);
    }
  };

  const start = skip(0);
  const r = scan_once(start);
  if (r === null) fail("Expecting value", start);
  const end = skip(r![1]);
  if (end !== n) fail("Extra data", end);
  return r![0];
}

export type DumpsOptions = {
  ensure_ascii?: boolean;
  allow_nan?: boolean;
  sort_keys?: boolean;
  indent?: number | string | null;
  separators?: readonly [string, string] | null;
  /** `default`: called for an object json cannot serialize; returns a serializable stand-in. */
  default_?: ((o: unknown) => unknown) | null;
  skipkeys?: boolean;
};

const ESCAPE_DCT: Record<string, string> = {
  '"': '\\"',
  "\\": "\\\\",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\b": "\\b",
  "\f": "\\f",
};

/** `json.encoder.encode_basestring_ascii` (per UTF-16 unit, lowercase hex, as CPython). */
export function encode_basestring_ascii(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const c = s.charCodeAt(i);
    const e = ESCAPE_DCT[ch];
    if (e !== undefined) out += e;
    else if (c < 0x20 || c > 0x7e) out += "\\u" + c.toString(16).padStart(4, "0");
    else out += ch;
  }
  return out + '"';
}

/** `json.encoder.encode_basestring` (`ensure_ascii=False`). */
export function encode_basestring(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const c = s.charCodeAt(i);
    const e = ESCAPE_DCT[ch];
    if (e !== undefined) out += e;
    else if (c < 0x20) out += "\\u" + c.toString(16).padStart(4, "0");
    else out += ch;
  }
  return out + '"';
}

function is_plain_object(o: unknown): boolean {
  if (o === null || typeof o !== "object") return false;
  const p = Object.getPrototypeOf(o);
  return p === Object.prototype || p === null;
}

/** `int.__repr__` for an integral JS number (exact decimal, no exponent). */
function int_repr(x: number): string {
  return Number.isSafeInteger(x) ? String(x) : BigInt(x).toString();
}

/**
 * `json.dumps(obj, ...)`. Python types map as elsewhere in pyrt: a `Map` or a
 * plain object is a JSON object, an array a JSON array, an integral `number` or a
 * `bigint` an int, a non-integral `number` or a `PyFloat` a float.
 */
export function json_dumps(obj: unknown, opts: DumpsOptions = {}): string {
  const { ensure_ascii = true, allow_nan = true, sort_keys = false, skipkeys = false } = opts;
  const default_ = opts.default_ ?? null;
  const indent = typeof opts.indent === "number" ? " ".repeat(opts.indent) : (opts.indent ?? null);
  const [item_sep, key_sep] = opts.separators ?? (indent !== null ? [",", ": "] : [", ", ": "]);
  const enc = ensure_ascii ? encode_basestring_ascii : encode_basestring;
  const markers = new Set<unknown>();

  const floatstr = (x: number): string => {
    let text: string;
    if (Number.isNaN(x)) text = "NaN";
    else if (x === Infinity) text = "Infinity";
    else if (x === -Infinity) text = "-Infinity";
    else return float_repr(x);
    if (!allow_nan) throw new ValueError(`Out of range float values are not JSON compliant: ${float_repr(x)}`);
    return text;
  };

  const encode_scalar = (o: unknown): string | undefined => {
    if (o == null) return "null";
    if (o === true) return "true";
    if (o === false) return "false";
    if (typeof o === "string" || o instanceof String) return enc(String(o));
    if (o instanceof PyFloat) return floatstr(o.value);
    if (typeof o === "number") return Number.isInteger(o) ? int_repr(o) : floatstr(o);
    if (typeof o === "bigint") return o.toString();
    return undefined;
  };

  const key_str = (k: unknown): string | null => {
    if (typeof k === "string" || k instanceof String) return String(k);
    if (k instanceof PyFloat) return floatstr(k.value);
    if (typeof k === "number") return Number.isInteger(k) ? int_repr(k) : floatstr(k);
    if (typeof k === "bigint") return k.toString();
    if (k === true) return "true";
    if (k === false) return "false";
    if (k == null) return "null";
    if (skipkeys) return null;
    throw new TypeError_(`keys must be str, int, float, bool or None, not ${type_name(k)}`);
  };

  const encode = (o: unknown, level: number): string => {
    const s = encode_scalar(o);
    if (s !== undefined) return s;
    const is_list = Array.isArray(o);
    const is_dict = o instanceof Map || is_plain_object(o);
    if (!is_list && !is_dict) {
      if (default_ === null) throw new TypeError_(`Object of type ${type_name(o)} is not JSON serializable`);
      if (markers.has(o)) throw new ValueError("Circular reference detected");
      markers.add(o);
      const r = encode(default_(o), level);
      markers.delete(o);
      return r;
    }
    if (markers.has(o)) throw new ValueError("Circular reference detected");
    let items: [unknown, unknown][] | unknown[];
    if (is_list) {
      if (o.length === 0) return "[]";
      items = o;
    } else {
      items = o instanceof Map ? [...o] : Object.entries(o);
      if (items.length === 0) return "{}";
      if (sort_keys) items = [...items].sort((a, b) => py_cmp(a[0], b[0]));
    }
    markers.add(o);
    let open = is_list ? "[" : "{";
    let sep = item_sep;
    const inner = level + 1;
    if (indent !== null) {
      const nl = "\n" + indent.repeat(inner);
      sep = item_sep + nl;
      open += nl;
    }
    const parts: string[] = [];
    if (is_list) {
      for (const v of items) parts.push(encode(v, inner));
    } else {
      for (const [k, v] of items as [unknown, unknown][]) {
        const ks = key_str(k);
        if (ks === null) continue;
        parts.push(enc(ks) + key_sep + encode(v, inner));
      }
    }
    markers.delete(o);
    const close = (indent !== null ? "\n" + indent.repeat(level) : "") + (is_list ? "]" : "}");
    return open + parts.join(sep) + close;
  };

  return encode(obj, 0);
}
