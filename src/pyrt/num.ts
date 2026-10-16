// Python numeric semantics that differ from JS operators.

import { OverflowError, ValueError, ZeroDivisionError } from "./errors.ts";

/** `a // b` (floor division; ZeroDivisionError on 0). */
export function floordiv(a: number, b: number): number {
  if (b === 0) throw new ZeroDivisionError("division by zero");
  if (Number.isInteger(a) && Number.isInteger(b) && Math.abs(a) < 2 ** 53 && Math.abs(b) < 2 ** 53) {
    return Math.floor(a / b);
  }
  // CPython float floordiv: (a - a % b) / b, then fixed up.
  const mod = a % b;
  let div = (a - mod) / b;
  if (mod && b < 0 !== mod < 0) div -= 1;
  if (div) {
    const floordiv = Math.floor(div);
    if (div - floordiv > 0.5) return floordiv + 1;
    return floordiv;
  }
  return Math.sign(a / b) * 0;
}

/** `a % b` (result takes the sign of `b`). */
export function mod(a: number, b: number): number {
  if (b === 0) throw new ZeroDivisionError("modulo by zero");
  const r = a % b;
  if (r && r < 0 !== b < 0) return r + b;
  if (!r) return b < 0 ? -0 : 0;
  return r;
}

/** `divmod(a, b)` */
export function divmod(a: number, b: number): [number, number] {
  return [floordiv(a, b), mod(a, b)];
}

/** `int(x)` for a float: truncate toward zero; raises like Python on nan/inf. */
export function int(x: number | string | boolean | bigint, base = 10): number {
  if (typeof x === "boolean") return x ? 1 : 0;
  if (typeof x === "bigint") return Number(x);
  if (typeof x === "string") {
    const s = x.trim().replace(/_/g, "");
    const ok = base === 16 ? /^[+-]?(0x)?[0-9a-f]+$/i : base === 10 ? /^[+-]?\d+$/ : /^[+-]?[0-9a-z]+$/i;
    if (!ok.test(s)) throw new ValueError(`invalid literal for int() with base ${base}: '${x}'`);
    return Number.parseInt(s, base);
  }
  if (Number.isNaN(x)) throw new ValueError("cannot convert float NaN to integer");
  if (!Number.isFinite(x)) throw new OverflowError("cannot convert float infinity to integer");
  return Math.trunc(x) || 0;
}

/** `float(text)` */
export function float(x: string | number | boolean): number {
  if (typeof x === "number") return x;
  if (typeof x === "boolean") return x ? 1 : 0;
  const s = x.trim().toLowerCase().replace(/_/g, "");
  if (/^[+-]?(inf|infinity)$/.test(s)) return s.startsWith("-") ? -Infinity : Infinity;
  if (/^[+-]?nan$/.test(s)) return NaN;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/.test(s)) {
    throw new ValueError(`could not convert string to float: '${x}'`);
  }
  return Number(s);
}

/** The exact rational value of a finite double as `num / 2**exp2` (exp2 >= 0) or `num * 2**-exp2`. */
export function float_as_ratio(x: number): [bigint, bigint] {
  if (!Number.isFinite(x)) throw new OverflowError("cannot convert Infinity to integer ratio");
  if (x === 0) return [0n, 1n];
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, x);
  const hi = dv.getUint32(0);
  const lo = dv.getUint32(4);
  const sign = hi >>> 31 ? -1n : 1n;
  const exp = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (exp === 0) e = -1074;
  else {
    mant |= 1n << 52n;
    e = exp - 1075;
  }
  while (mant && !(mant & 1n)) {
    mant >>= 1n;
    e += 1;
  }
  if (e >= 0) return [sign * (mant << BigInt(e)), 1n];
  return [sign * mant, 1n << BigInt(-e)];
}

/**
 * Python `round(x)` (ties to even, returns an int) and `round(x, n)`
 * (correctly rounded on the exact binary value, ties to even).
 */
export function round(x: number, ndigits?: number | null): number {
  if (ndigits == null) {
    if (Number.isNaN(x)) throw new ValueError("cannot convert float NaN to integer");
    if (!Number.isFinite(x)) throw new OverflowError("cannot convert float infinity to integer");
    const f = Math.floor(x);
    const diff = x - f;
    if (diff > 0.5) return f + 1;
    if (diff < 0.5) return f || 0;
    return (f % 2 === 0 ? f : f + 1) || 0;
  }
  if (!Number.isFinite(x) || x === 0) return x;
  if (Number.isInteger(x) && ndigits >= 0) return x;
  const [num, den] = float_as_ratio(x);
  // value * 10**n = num * 10**n / den, rounded half-even to an integer q.
  let scaled_num = num;
  let scaled_den = den;
  if (ndigits >= 0) scaled_num *= 10n ** BigInt(ndigits);
  else scaled_den *= 10n ** BigInt(-ndigits);
  const neg = scaled_num < 0n;
  const a = neg ? -scaled_num : scaled_num;
  let q = a / scaled_den;
  const r2 = 2n * (a - q * scaled_den);
  if (r2 > scaled_den || (r2 === scaled_den && q & 1n)) q += 1n;
  const text = `${neg ? "-" : ""}${q}e${-ndigits}`;
  const result = Number(text);
  if (!Number.isFinite(result)) throw new OverflowError("rounded value too large to represent");
  return result === 0 && neg ? -0 : result;
}

/**
 * Builtin `sum()` over numbers as CPython 3.12+ computes it: exact for
 * ints, Neumaier-compensated for floats.
 */
export function sum(values: Iterable<number>, start = 0): number {
  let f = start;
  let c = 0;
  let any_float = !Number.isInteger(start);
  for (const x of values) {
    if (!any_float && Number.isInteger(x) && Number.isInteger(f) && Math.abs(f + x) < 2 ** 53) {
      f += x;
      continue;
    }
    any_float = true;
    const t = f + x;
    if (Number.isFinite(t)) {
      if (Math.abs(f) >= Math.abs(x)) c += f - t + x;
      else c += x - t + f;
    }
    f = t;
  }
  if (c && Number.isFinite(c)) f += c;
  return f;
}

/** `math.fsum` - exactly rounded sum (Shewchuk). */
export function fsum(values: Iterable<number>): number {
  const partials: number[] = [];
  for (let x of values) {
    let i = 0;
    for (let y of partials) {
      if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
      const hi = x + y;
      const lo = y - (hi - x);
      if (lo) partials[i++] = lo;
      x = hi;
    }
    partials.length = i;
    partials.push(x);
  }
  let n = partials.length;
  let hi = 0;
  if (n > 0) {
    hi = partials[--n];
    let lo = 0;
    while (n > 0) {
      const x = hi;
      const y = partials[--n];
      hi = x + y;
      const yr = hi - x;
      lo = y - yr;
      if (lo) break;
    }
    if (n > 0 && ((lo < 0 && partials[n - 1] < 0) || (lo > 0 && partials[n - 1] > 0))) {
      const y = lo * 2;
      const x = hi + y;
      const yr = x - hi;
      if (y === yr) hi = x;
    }
  }
  return hi;
}

/** `math.isclose(a, b, rel_tol=1e-9, abs_tol=0)` */
export function isclose(a: number, b: number, rel_tol = 1e-9, abs_tol = 0): boolean {
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const diff = Math.abs(b - a);
  return diff <= Math.abs(rel_tol * b) || diff <= Math.abs(rel_tol * a) || diff <= abs_tol;
}

/** `math.copysign` */
export function copysign(x: number, y: number): number {
  const neg = y < 0 || Object.is(y, -0);
  return neg ? -Math.abs(x) : Math.abs(x);
}

/** `math.radians` / `math.degrees` (CPython multiplies by pi/180 and 180/pi). */
export const radians = (x: number): number => x * (Math.PI / 180);
export const degrees = (x: number): number => x * (180 / Math.PI);

/** Python `repr(float)` / `str(float)`: shortest round-trip, Python spelling. */
export function float_repr(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const abs = Math.abs(x);
  if (abs >= 1e16 || abs < 1e-4) {
    let [m, e] = x.toExponential().split("e");
    const exp = Number(e);
    return `${m}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  }
  const s = String(x);
  return s.includes(".") ? s : `${s}.0`;
}

/** Python `str(x)` for a number that may be an int or a float. */
export function num_str(x: number, is_float = !Number.isInteger(x)): string {
  return is_float ? float_repr(x) : String(x);
}

/**
 * Python `format(x, spec)` for the numeric specs py_aep uses:
 * `[sign][0][width][.prec](f|e|g|%|d|x|X)`, plus `,` grouping.
 */
export function format(x: number, spec: string): string {
  const m = /^([<>=^]?)([+\- ]?)(0?)(\d*)(,?)(?:\.(\d+))?([fFeEgGdxX%n]?)$/.exec(spec);
  if (!m) throw new ValueError(`Unsupported format spec ${spec}`);
  const [, align, sign, zero, width_s, comma, prec_s, type] = m;
  const prec = prec_s === undefined ? undefined : Number(prec_s);
  const neg = x < 0 || Object.is(x, -0);
  const a = Math.abs(x);
  let body: string;
  switch (type) {
    case "f":
    case "F":
      body = fixed(a, prec ?? 6);
      break;
    case "%":
      body = fixed(a * 100, prec ?? 6) + "%";
      break;
    case "e":
    case "E":
      body = expo(a, prec ?? 6);
      break;
    case "g":
    case "G":
      body = general(a, prec ?? 6, false);
      break;
    case "d":
    case "n":
      body = String(Math.trunc(a));
      break;
    case "x":
      body = Math.trunc(a).toString(16);
      break;
    case "X":
      body = Math.trunc(a).toString(16).toUpperCase();
      break;
    default:
      body = prec === undefined ? (Number.isInteger(x) ? String(a) : float_repr(a)) : general(a, prec, true);
  }
  if (type === "E" || type === "G" || type === "F") body = body.toUpperCase();
  if (comma) {
    const [i, f] = body.split(".");
    body = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f === undefined ? "" : "." + f);
  }
  const sign_s = neg && !(a === 0 && type === "d") ? "-" : sign === "+" ? "+" : sign === " " ? " " : "";
  const width = width_s ? Number(width_s) : 0;
  if (zero && !align) return sign_s + body.padStart(width - sign_s.length, "0");
  const s = sign_s + body;
  if (align === "<") return s.padEnd(width);
  if (align === "^") {
    const pad = Math.max(0, width - s.length);
    return " ".repeat(Math.floor(pad / 2)) + s + " ".repeat(pad - Math.floor(pad / 2));
  }
  return s.padStart(width);
}

/** Correctly rounded fixed-point text of a non-negative double (ties to even on the exact value). */
function fixed(a: number, prec: number): string {
  if (!Number.isFinite(a)) return Number.isNaN(a) ? "nan" : "inf";
  const [num, den] = float_as_ratio(a);
  const scaled = num * 10n ** BigInt(prec);
  let q = scaled / den;
  const r2 = 2n * (scaled - q * den);
  if (r2 > den || (r2 === den && q & 1n)) q += 1n;
  const digits = q.toString().padStart(prec + 1, "0");
  return prec ? `${digits.slice(0, -prec)}.${digits.slice(-prec)}` : digits;
}

/** Correctly rounded `%.{prec}e` digits: [mantissa digits, exponent]. */
function sci_digits(a: number, prec: number): [string, number] {
  if (a === 0) return ["0".repeat(prec + 1), 0];
  const [num, den] = float_as_ratio(a);
  let exp = Math.floor(Math.log10(a));
  for (;;) {
    const shift = prec - exp;
    let n = num;
    let d = den;
    if (shift >= 0) n *= 10n ** BigInt(shift);
    else d *= 10n ** BigInt(-shift);
    let q = n / d;
    const r2 = 2n * (n - q * d);
    if (r2 > d || (r2 === d && q & 1n)) q += 1n;
    const s = q.toString();
    if (s.length === prec + 1) return [s, exp];
    exp += s.length > prec + 1 ? 1 : -1;
  }
}

function expo(a: number, prec: number): string {
  if (!Number.isFinite(a)) return Number.isNaN(a) ? "nan" : "inf";
  const [d, e] = sci_digits(a, prec);
  const m = prec ? `${d[0]}.${d.slice(1)}` : d;
  return `${m}e${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
}

/** `%g` (and the bare `.Ng` spec when `keep_point_free` is false). */
function general(a: number, prec: number, repr_style: boolean): string {
  if (!Number.isFinite(a)) return Number.isNaN(a) ? "nan" : "inf";
  const p = prec === 0 ? 1 : prec;
  if (a === 0) return repr_style ? "0.0" : "0";
  const [d, e] = sci_digits(a, p - 1);
  let out: string;
  if (e < -4 || e >= p) {
    let m = p > 1 ? `${d[0]}.${d.slice(1)}` : d;
    if (m.includes(".")) m = m.replace(/0+$/, "").replace(/\.$/, "");
    out = `${m}e${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
  } else {
    out = fixed(a, Math.max(0, p - 1 - e));
    if (out.includes(".")) out = out.replace(/0+$/, "").replace(/\.$/, "");
    if (repr_style && !out.includes(".") && !out.includes("e")) out += ".0";
  }
  return out;
}

/** Shift helpers: JS `<<`/`>>`/`&`/`|` are int32; these keep Python's unbounded-int results exact up to 2**53. */
export function lshift(x: number, n: number): number {
  return x * 2 ** n;
}
export function rshift(x: number, n: number): number {
  return Math.floor(x / 2 ** n);
}
/** `x & mask` for non-negative operands up to 2**53. */
export function and(x: number, mask: number): number {
  if (x <= 0xffffffff && mask <= 0xffffffff && x >= 0 && mask >= 0) return (x & mask) >>> 0;
  return Number(BigInt(x) & BigInt(mask));
}
/** `x | y` for non-negative operands up to 2**53. */
export function or(x: number, y: number): number {
  if (x <= 0xffffffff && y <= 0xffffffff && x >= 0 && y >= 0) return (x | y) >>> 0;
  return Number(BigInt(x) | BigInt(y));
}
/** `x & ~mask` for non-negative operands up to 2**53. */
export function and_not(x: number, mask: number): number {
  if (x <= 0xffffffff && mask <= 0xffffffff && x >= 0 && mask >= 0) return (x & ~mask) >>> 0;
  return Number(BigInt(x) & ~BigInt(mask));
}
