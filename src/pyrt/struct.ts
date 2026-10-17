// Python's `struct` module for the standard-size formats ("<", ">", "!",
// "="). Integers unpack to `number`, except `q`/`Q` which unpack to
// `bigint` (Python ints are unbounded; a u64 does not fit a double).

import { OverflowError, StructError } from "./errors.ts";

/** What `pack` accepts: ints, floats and bools (numeric codes), bytes (`c`, `s`, `p`). */
export type PackValue = number | bigint | boolean | Uint8Array;

type Code = { ch: string; count: number; size: number };

// Type of the tuple `unpack(F, ...)` yields, for a literal format F (`any[]` otherwise).
type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
type DigitTuple = {
  "0": []; "1": [0]; "2": [0, 0]; "3": [0, 0, 0]; "4": [0, 0, 0, 0]; "5": [0, 0, 0, 0, 0];
  "6": [0, 0, 0, 0, 0, 0]; "7": [0, 0, 0, 0, 0, 0, 0]; "8": [0, 0, 0, 0, 0, 0, 0, 0]; "9": [0, 0, 0, 0, 0, 0, 0, 0, 0];
};
type Times10<T extends 0[]> = [...T, ...T, ...T, ...T, ...T, ...T, ...T, ...T, ...T, ...T];
type CountOf<S extends string, Acc extends 0[] = []> = S extends `${infer D extends Digit}${infer R}`
  ? CountOf<R, [...Times10<Acc>, ...DigitTuple[D]]>
  : Acc;
type SplitCount<S extends string, D extends string = ""> = S extends `${infer C extends Digit}${infer R}`
  ? SplitCount<R, `${D}${C}`>
  : [D, S];
type CodeValue = {
  c: Uint8Array; b: number; B: number; "?": boolean; h: number; H: number; i: number; I: number;
  l: number; L: number; q: bigint; Q: bigint; e: number; f: number; d: number;
};
type Fill<T extends 0[], V> = { [K in keyof T]: V };
type ParseCodes<S extends string> = S extends ""
  ? []
  : S extends ` ${infer R}`
    ? ParseCodes<R>
    : SplitCount<S> extends [infer D extends string, `${infer C}${infer R}`]
      ? C extends "x"
        ? ParseCodes<R>
        : C extends "s" | "p"
          ? [Uint8Array, ...ParseCodes<R>]
          : C extends keyof CodeValue
            ? D extends ""
              ? [CodeValue[C], ...ParseCodes<R>]
              : [...Fill<CountOf<D>, CodeValue[C]>, ...ParseCodes<R>]
            : any[]
      : any[];
/** The values `struct.unpack(F, data)` yields: a tuple for a literal format, `any[]` otherwise. */
export type Unpacked<F extends string> = string extends F
  ? any[]
  : F extends `${"<" | ">" | "!" | "=" | "@"}${infer R}`
    ? ParseCodes<R>
    : ParseCodes<F>;

const SIZES: Record<string, number> = {
  x: 1, c: 1, b: 1, B: 1, "?": 1, h: 2, H: 2, i: 4, I: 4, l: 4, L: 4,
  q: 8, Q: 8, e: 2, f: 4, d: 8, s: 1, p: 1,
};

const INT_RANGE: Record<string, [number, number]> = {
  b: [-0x80, 0x7f], B: [0, 0xff], h: [-0x8000, 0x7fff], H: [0, 0xffff],
  i: [-0x80000000, 0x7fffffff], I: [0, 0xffffffff], l: [-0x80000000, 0x7fffffff], L: [0, 0xffffffff],
};

const FLOAT32_MAX = 3.4028234663852886e38;

export class Struct<F extends string = string> {
  readonly format: F;
  readonly size: number;
  private readonly le: boolean;
  private readonly codes: Code[];

  constructor(format: F) {
    this.format = format;
    let f: string = format;
    this.le = false;
    const first = f[0];
    if (first === "<" || first === ">" || first === "!" || first === "=" || first === "@") {
      this.le = first === "<" || first === "=" || first === "@";
      f = f.slice(1);
    }
    this.codes = [];
    let size = 0;
    const re = /\s*(\d*)([xcbB?hHiIlLqQefdsp])/y;
    let m: RegExpExecArray | null;
    let pos = 0;
    while (pos < f.length) {
      re.lastIndex = pos;
      m = re.exec(f);
      if (!m) {
        if (/^\s*$/.test(f.slice(pos))) break;
        throw new StructError("bad char in struct format");
      }
      pos = re.lastIndex;
      const count = m[1] === "" ? 1 : Number(m[1]);
      const ch = m[2];
      this.codes.push({ ch, count, size: SIZES[ch] });
      size += SIZES[ch] * count;
    }
    this.size = size;
  }

  /** Number of values `unpack` yields. */
  get n_values(): number {
    let n = 0;
    for (const c of this.codes) {
      if (c.ch === "x") continue;
      n += c.ch === "s" || c.ch === "p" ? 1 : c.count;
    }
    return n;
  }

  unpack(data: Uint8Array): Unpacked<F>;
  unpack(data: Uint8Array): any[] {
    if (data.length !== this.size) {
      throw new StructError(`unpack requires a buffer of ${this.size} bytes`);
    }
    return this.unpack_from(data, 0);
  }

  unpack_from(data: Uint8Array, offset?: number): Unpacked<F>;
  unpack_from(data: Uint8Array, offset = 0): any[] {
    if (data.length - offset < this.size) {
      throw new StructError(`unpack_from requires a buffer of at least ${this.size + offset} bytes`);
    }
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const le = this.le;
    const out: any[] = [];
    let p = offset;
    for (const { ch, count } of this.codes) {
      if (ch === "x") {
        p += count;
        continue;
      }
      if (ch === "s" || ch === "p") {
        out.push(data.slice(p, p + count));
        p += count;
        continue;
      }
      for (let k = 0; k < count; k++) {
        switch (ch) {
          case "c": out.push(data.slice(p, p + 1)); break;
          case "b": out.push(dv.getInt8(p)); break;
          case "B": out.push(dv.getUint8(p)); break;
          case "?": out.push(dv.getUint8(p) !== 0); break;
          case "h": out.push(dv.getInt16(p, le)); break;
          case "H": out.push(dv.getUint16(p, le)); break;
          case "i": case "l": out.push(dv.getInt32(p, le)); break;
          case "I": case "L": out.push(dv.getUint32(p, le)); break;
          case "q": out.push(dv.getBigInt64(p, le)); break;
          case "Q": out.push(dv.getBigUint64(p, le)); break;
          case "e": out.push(half_to_float(dv.getUint16(p, le))); break;
          case "f": out.push(dv.getFloat32(p, le)); break;
          case "d": out.push(dv.getFloat64(p, le)); break;
        }
        p += SIZES[ch];
      }
    }
    return out;
  }

  pack(...values: PackValue[]): Uint8Array {
    if (values.length !== this.n_values) {
      throw new StructError(`pack expected ${this.n_values} items for packing (got ${values.length})`);
    }
    const out = new Uint8Array(this.size);
    const dv = new DataView(out.buffer);
    const le = this.le;
    let p = 0;
    let vi = 0;
    for (const { ch, count } of this.codes) {
      if (ch === "x") {
        p += count;
        continue;
      }
      if (ch === "s" || ch === "p") {
        const v = values[vi++];
        if (!(v instanceof Uint8Array)) throw new StructError("argument for 's' must be a bytes object");
        out.set(v.subarray(0, count), p);
        p += count;
        continue;
      }
      for (let k = 0; k < count; k++) {
        const v = values[vi++];
        switch (ch) {
          case "c":
            if (!(v instanceof Uint8Array) || v.length !== 1) {
              throw new StructError("char format requires a bytes object of length 1");
            }
            out[p] = v[0];
            break;
          case "?":
            out[p] = v ? 1 : 0;
            break;
          case "q":
          case "Q": {
            const big = to_bigint(v);
            if (ch === "Q") {
              if (big < 0n || big > 0xffffffffffffffffn) throw new StructError("argument out of range");
              dv.setBigUint64(p, big, le);
            } else {
              if (big < -0x8000000000000000n || big > 0x7fffffffffffffffn) throw new StructError("argument out of range");
              dv.setBigInt64(p, big, le);
            }
            break;
          }
          case "e":
            dv.setUint16(p, float_to_half(to_float(v)), le);
            break;
          case "f": {
            const x = to_float(v);
            if (Number.isFinite(x) && Math.abs(x) > FLOAT32_MAX && !Number.isFinite(Math.fround(x))) {
              throw new OverflowError("float too large to pack with f format");
            }
            dv.setFloat32(p, x, le);
            break;
          }
          case "d":
            dv.setFloat64(p, to_float(v), le);
            break;
          default: {
            const n = to_int(v);
            const [lo, hi] = INT_RANGE[ch];
            if (n < lo || n > hi) {
              throw new StructError(`'${ch}' format requires ${lo} <= number <= ${hi}`);
            }
            switch (ch) {
              case "b": dv.setInt8(p, n); break;
              case "B": dv.setUint8(p, n); break;
              case "h": dv.setInt16(p, n, le); break;
              case "H": dv.setUint16(p, n, le); break;
              case "i": case "l": dv.setInt32(p, n, le); break;
              case "I": case "L": dv.setUint32(p, n, le); break;
            }
          }
        }
        p += SIZES[ch];
      }
    }
    return out;
  }
}

function to_int(v: PackValue): number {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "bigint") return Number(v);
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new StructError("required argument is not an integer");
  }
  return v;
}

function to_bigint(v: PackValue): bigint {
  if (typeof v === "bigint") return v;
  return BigInt(to_int(v));
}

function to_float(v: PackValue): number {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "bigint") return Number(v);
  if (typeof v !== "number") throw new StructError("required argument is not a float");
  return v;
}

function half_to_float(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * f * 2 ** -24;
  if (e === 31) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * 2 ** (e - 15);
}

function float_to_half(x: number): number {
  const f32 = new Float32Array([x]);
  const u = new Uint32Array(f32.buffer)[0];
  const sign = (u >> 16) & 0x8000;
  const exp = ((u >> 23) & 0xff) - 127 + 15;
  const mant = u & 0x7fffff;
  if (Number.isNaN(x)) return sign | 0x7e00;
  if (exp >= 31) {
    if (Number.isFinite(x)) throw new OverflowError("float too large to pack with e format");
    return sign | 0x7c00;
  }
  if (exp <= 0) return sign | Math.round((mant | 0x800000) / 2 ** (14 - exp));
  return sign | (exp << 10) | Math.round(mant / 0x2000);
}

const CACHE = new Map<string, Struct>();

function get(format: string): Struct {
  let s = CACHE.get(format);
  if (s === undefined) {
    s = new Struct(format);
    CACHE.set(format, s);
  }
  return s;
}

/** `struct.pack(fmt, *values)` */
export function pack(format: string, ...values: PackValue[]): Uint8Array {
  return get(format).pack(...values);
}

/** `struct.unpack(fmt, data)` */
export function unpack<F extends string>(format: F, data: Uint8Array): Unpacked<F>;
export function unpack(format: string, data: Uint8Array): any[] {
  return get(format).unpack(data);
}

/** `struct.unpack_from(fmt, data, offset)` */
export function unpack_from<F extends string>(format: F, data: Uint8Array, offset?: number): Unpacked<F>;
export function unpack_from(format: string, data: Uint8Array, offset = 0): any[] {
  return get(format).unpack_from(data, offset);
}

/** `struct.pack_into(fmt, buffer, offset, *values)` (negative offsets count from the end). */
export function pack_into(format: string, buffer: Uint8Array, offset: number, ...values: PackValue[]): void {
  const s = get(format);
  if (offset < 0) {
    if (offset + s.size > 0) throw new StructError(`no space to pack ${s.size} bytes at offset ${offset}`);
    if (offset + buffer.length < 0) throw new StructError(`offset ${offset} out of range for ${buffer.length}-byte buffer`);
    offset += buffer.length;
  }
  if (buffer.length - offset < s.size) {
    throw new StructError(
      `pack_into requires a buffer of at least ${s.size + offset} bytes for packing ${s.size} bytes at offset ${offset} (actual buffer size is ${buffer.length})`,
    );
  }
  buffer.set(s.pack(...values), offset);
}

/** `struct.calcsize(fmt)` */
export function calcsize(format: string): number {
  return get(format).size;
}

/** `struct.iter_unpack(fmt, data)` */
export function* iter_unpack(format: string, data: Uint8Array): Generator<any[]> {
  const s = get(format);
  if (data.length % s.size) throw new StructError(`iterative unpacking requires a buffer of a multiple of ${s.size} bytes`);
  for (let p = 0; p < data.length; p += s.size) yield s.unpack_from(data, p);
}
