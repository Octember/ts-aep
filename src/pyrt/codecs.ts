// Python `bytes.decode` / `str.encode` with CPython's error handlers.
// JS strings and Python 3 strs differ in one way that matters here: a
// Python str is code points, a JS string UTF-16 units. A lone surrogate is
// representable in both, which is what lets `surrogateescape` round-trip.

import { UnicodeDecodeError, UnicodeEncodeError, LookupError } from "./errors.ts";
import { CP1252, MAC_ROMAN } from "./codepages.ts";

export type Errors = "strict" | "surrogateescape" | "ignore" | "replace";

const NORM = new Map<string, string>();

function norm(encoding: string): string {
  let n = NORM.get(encoding);
  if (n === undefined) {
    n = norm_uncached(encoding);
    NORM.set(encoding, n);
  }
  return n;
}

function norm_uncached(encoding: string): string {
  const e = encoding.toLowerCase().replace(/_/g, "-");
  if (e === "utf8" || e === "utf-8") return "utf-8";
  if (e === "ascii" || e === "us-ascii") return "ascii";
  if (e === "latin-1" || e === "latin1" || e === "iso-8859-1") return "latin-1";
  if (e === "utf-16-le" || e === "utf-16le") return "utf-16-le";
  if (e === "utf-16-be" || e === "utf-16be") return "utf-16-be";
  if (e === "utf-16") return "utf-16";
  if (e === "utf-32" || e === "utf32" || e === "u32") return "utf-32";
  if (e === "utf-32-le" || e === "utf-32le") return "utf-32-le";
  if (e === "utf-32-be" || e === "utf-32be") return "utf-32-be";
  if (e === "mac-roman" || e === "macroman" || e === "mac") return "mac-roman";
  if (e === "cp1252" || e === "windows-1252") return "cp1252";
  return e;
}

function bad_byte(out: string[], byte: number, errors: Errors, enc: string, pos: number): void {
  if (errors === "surrogateescape") {
    out.push(String.fromCharCode(0xdc00 + byte));
  } else if (errors === "replace") {
    out.push("�");
  } else if (errors !== "ignore") {
    throw new UnicodeDecodeError(
      `'${enc}' codec can't decode byte 0x${byte.toString(16).padStart(2, "0")} in position ${pos}: invalid start byte`,
    );
  }
}

function is_ascii(data: Uint8Array): boolean {
  for (let i = 0; i < data.length; i++) if (data[i] >= 0x80) return false;
  return true;
}

/** Bytes below 0x100 as one char each (callers check the range). */
function chars(data: Uint8Array): string {
  if (data.length <= 0x2000) return Reflect.apply(String.fromCharCode, null, data);
  let s = "";
  for (let i = 0; i < data.length; i += 0x2000) {
    s += Reflect.apply(String.fromCharCode, null, data.subarray(i, i + 0x2000));
  }
  return s;
}

// WHATWG's fatal UTF-8 decoder rejects exactly what CPython's strict one does
// (surrogates, overlongs, > U+10FFFF, truncation); on error the byte-wise
// decoder below applies the error handler.
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function decode_utf8(data: Uint8Array, errors: Errors): string {
  try {
    return UTF8_FATAL.decode(data);
  } catch {
    return decode_utf8_slow(data, errors);
  }
}

function decode_utf8_slow(data: Uint8Array, errors: Errors): string {
  const out: string[] = [];
  const n = data.length;
  let i = 0;
  while (i < n) {
    const b0 = data[i];
    if (b0 < 0x80) {
      out.push(String.fromCharCode(b0));
      i += 1;
      continue;
    }
    let need = 0;
    let cp = 0;
    let lo = 0x80;
    let hi = 0xbf;
    if (b0 >= 0xc2 && b0 <= 0xdf) {
      need = 1;
      cp = b0 & 0x1f;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      need = 2;
      cp = b0 & 0x0f;
      if (b0 === 0xe0) lo = 0xa0;
      if (b0 === 0xed) hi = 0x9f; // no encoded surrogates
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      need = 3;
      cp = b0 & 0x07;
      if (b0 === 0xf0) lo = 0x90;
      if (b0 === 0xf4) hi = 0x8f;
    } else {
      bad_byte(out, b0, errors, "utf-8", i);
      i += 1;
      continue;
    }
    // Maximal subpart: escape the lead byte alone and resume at the first
    // byte that does not continue it (CPython's behavior).
    let j = 1;
    let ok = true;
    for (; j <= need; j++) {
      if (i + j >= n) {
        ok = false;
        break;
      }
      const b = data[i + j];
      const l = j === 1 ? lo : 0x80;
      const h = j === 1 ? hi : 0xbf;
      if (b < l || b > h) {
        ok = false;
        break;
      }
      cp = (cp << 6) | (b & 0x3f);
    }
    if (!ok) {
      if (errors === "strict") {
        throw new UnicodeDecodeError(
          `'utf-8' codec can't decode byte 0x${b0.toString(16)} in position ${i}: invalid continuation byte`,
        );
      }
      if (errors === "replace") {
        out.push("�");
      } else {
        for (let k = 0; k < j; k++) bad_byte(out, data[i + k], errors, "utf-8", i + k);
      }
      i += j;
      continue;
    }
    out.push(String.fromCodePoint(cp));
    i += need + 1;
  }
  return out.join("");
}

const UTF8_ENCODER = new TextEncoder();

function encode_utf8(text: string, errors: Errors): Uint8Array {
  // TextEncoder would turn a lone surrogate into U+FFFD; those go byte-wise.
  if (text.isWellFormed?.()) return UTF8_ENCODER.encode(text);
  return encode_utf8_slow(text, errors);
}

function encode_utf8_slow(text: string, errors: Errors): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i += 1;
        out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
        continue;
      }
    }
    if (c >= 0xd800 && c <= 0xdfff) {
      if (errors === "surrogateescape" && c >= 0xdc80 && c <= 0xdcff) {
        out.push(c - 0xdc00);
        continue;
      }
      if (errors === "ignore") continue;
      if (errors === "replace") {
        out.push(0x3f);
        continue;
      }
      throw new UnicodeEncodeError(
        `'utf-8' codec can't encode character '\\u${c.toString(16)}' in position ${i}: surrogates not allowed`,
      );
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Uint8Array.from(out);
}

function decode_single_byte(data: Uint8Array, errors: Errors, limit: number, enc: string, table?: readonly number[]): string {
  if (limit === 0x100) return chars(data);
  if (is_ascii(data)) return UTF8_FATAL.decode(data);
  const out: string[] = [];
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (b < limit) out.push(String.fromCharCode(b));
    else if (table && table[b - 0x80] >= 0) out.push(String.fromCharCode(table[b - 0x80]));
    else bad_byte(out, b, errors, enc, i);
  }
  return out.join("");
}

function encode_single_byte(text: string, errors: Errors, limit: number, enc: string, table?: readonly number[]): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= limit) return encode_single_byte_slow(text, errors, limit, enc, table);
    out[i] = c;
  }
  return out;
}

function encode_single_byte_slow(text: string, errors: Errors, limit: number, enc: string, table?: readonly number[]): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < limit) {
      out.push(c);
      continue;
    }
    const t = table ? table.indexOf(c) : -1;
    if (t >= 0) {
      out.push(0x80 + t);
      continue;
    }
    if (errors === "surrogateescape" && c >= 0xdc80 && c <= 0xdcff) out.push(c - 0xdc00);
    else if (errors === "ignore") continue;
    else if (errors === "replace") out.push(0x3f);
    else
      throw new UnicodeEncodeError(
        `'${enc}' codec can't encode character '\\u${c.toString(16).padStart(4, "0")}' in position ${i}: ${limit === 0x80 && !table ? "ordinal not in range(128)" : "character maps to <undefined>"}`,
      );
  }
  return Uint8Array.from(out);
}

function decode_utf16(data: Uint8Array, errors: Errors, le: boolean): string {
  if (data.length % 2 && errors === "strict") {
    throw new UnicodeDecodeError(`'utf-16-${le ? "le" : "be"}' codec can't decode byte: truncated data`);
  }
  const units: string[] = [];
  for (let i = 0; i + 1 < data.length; i += 2) {
    units.push(String.fromCharCode(le ? data[i] | (data[i + 1] << 8) : (data[i] << 8) | data[i + 1]));
  }
  return units.join("");
}

function encode_utf16(text: string, le: boolean): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[2 * i + (le ? 0 : 1)] = c & 0xff;
    out[2 * i + (le ? 1 : 0)] = c >> 8;
  }
  return out;
}

/**
 * UTF-32 decoding, CPython's error reporting included: a unit outside
 * range(0x110000) or in the surrogate range, and a truncated tail, go to the
 * error handler (`surrogateescape` escapes the leading bytes >= 0x80 of the
 * bad span and resumes after them, raising when there are none).
 */
function decode_utf32(data: Uint8Array, errors: Errors, le: boolean, offset = 0): string {
  const enc = le ? "utf-32-le" : "utf-32-be";
  const out: string[] = [];
  const n = data.length;
  let i = 0;
  const fail = (start: number, end: number, reason: string): number => {
    if (errors === "replace") {
      out.push("\ufffd");
      return end;
    }
    if (errors === "ignore") return end;
    if (errors === "surrogateescape") {
      let k = start;
      while (k < end && k - start < 4 && data[k] >= 0x80) out.push(String.fromCharCode(0xdc00 + data[k++]));
      if (k > start) return k;
    }
    const where =
      end - start === 1
        ? `byte 0x${data[start].toString(16).padStart(2, "0")} in position ${start + offset}`
        : `bytes in position ${start + offset}-${end - 1 + offset}`;
    throw new UnicodeDecodeError(`'${enc}' codec can't decode ${where}: ${reason}`);
  };
  while (i < n) {
    if (n - i < 4) {
      i = fail(i, n, "truncated data");
      continue;
    }
    const cp = le
      ? (data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24)) >>> 0
      : ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0;
    if (cp > 0x10ffff) i = fail(i, i + 4, "code point not in range(0x110000)");
    else if (cp >= 0xd800 && cp < 0xe000) i = fail(i, i + 4, "code point in surrogate code point range(0xd800, 0xe000)");
    else {
      out.push(String.fromCodePoint(cp));
      i += 4;
    }
  }
  return out.join("");
}

function encode_utf32(text: string, errors: Errors, le: boolean, name: string): Uint8Array {
  const cps: number[] = [];
  let pos = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0xd800 && cp < 0xe000) {
      if (errors === "ignore") {
        pos++;
        continue;
      }
      if (errors === "replace") {
        cps.push(0x3f);
        pos++;
        continue;
      }
      throw new UnicodeEncodeError(
        `'${name}' codec can't encode character '\\u${cp.toString(16)}' in position ${pos}: surrogates not allowed`,
      );
    }
    cps.push(cp);
    pos++;
  }
  const out = new Uint8Array(cps.length * 4);
  const dv = new DataView(out.buffer);
  cps.forEach((cp, k) => dv.setUint32(4 * k, cp, le));
  return out;
}

/** Python `data.decode(encoding, errors)`. */
export function decode(data: Uint8Array, encoding = "utf-8", errors: Errors = "strict"): string {
  switch (encoding === "utf-8" ? encoding : norm(encoding)) {
    case "utf-8":
      return decode_utf8(data, errors);
    case "ascii":
      return decode_single_byte(data, errors, 0x80, "ascii");
    case "latin-1":
      return decode_single_byte(data, errors, 0x100, "latin-1");
    case "mac-roman":
      return decode_single_byte(data, errors, 0x80, "charmap", MAC_ROMAN);
    case "cp1252":
      return decode_single_byte(data, errors, 0x80, "charmap", CP1252);
    case "utf-16-le":
      return decode_utf16(data, errors, true);
    case "utf-16-be":
      return decode_utf16(data, errors, false);
    case "utf-16": {
      if (data[0] === 0xff && data[1] === 0xfe) return decode_utf16(data.subarray(2), errors, true);
      if (data[0] === 0xfe && data[1] === 0xff) return decode_utf16(data.subarray(2), errors, false);
      return decode_utf16(data, errors, true);
    }
    case "utf-32-le":
      return decode_utf32(data, errors, true);
    case "utf-32-be":
      return decode_utf32(data, errors, false);
    case "utf-32": {
      // A BOM picks the byte order and is dropped; without one, little-endian (the native order).
      if (data[0] === 0xff && data[1] === 0xfe && data[2] === 0 && data[3] === 0) return decode_utf32(data.subarray(4), errors, true, 4);
      if (data[0] === 0 && data[1] === 0 && data[2] === 0xfe && data[3] === 0xff) return decode_utf32(data.subarray(4), errors, false, 4);
      return decode_utf32(data, errors, true);
    }
    default:
      throw new LookupError(`unknown encoding: ${encoding}`);
  }
}

/** Python `text.encode(encoding, errors)`. */
export function encode(text: string, encoding = "utf-8", errors: Errors = "strict"): Uint8Array {
  switch (encoding === "utf-8" ? encoding : norm(encoding)) {
    case "utf-8":
      return encode_utf8(text, errors);
    case "ascii":
      return encode_single_byte(text, errors, 0x80, "ascii");
    case "latin-1":
      return encode_single_byte(text, errors, 0x100, "latin-1");
    case "mac-roman":
      return encode_single_byte(text, errors, 0x80, "charmap", MAC_ROMAN);
    case "cp1252":
      return encode_single_byte(text, errors, 0x80, "charmap", CP1252);
    case "utf-16-le":
      return encode_utf16(text, true);
    case "utf-16-be":
      return encode_utf16(text, false);
    case "utf-16": {
      const body = encode_utf16(text, true);
      const out = new Uint8Array(body.length + 2);
      out.set([0xff, 0xfe]);
      out.set(body, 2);
      return out;
    }
    case "utf-32-le":
      return encode_utf32(text, errors, true, "utf-32-le");
    case "utf-32-be":
      return encode_utf32(text, errors, false, "utf-32-be");
    case "utf-32": {
      const body = encode_utf32(text, errors, true, "utf-32");
      const out = new Uint8Array(body.length + 4);
      out.set([0xff, 0xfe, 0, 0]);
      out.set(body, 4);
      return out;
    }
    default:
      throw new LookupError(`unknown encoding: ${encoding}`);
  }
}
