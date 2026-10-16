// Python `bytes.decode` / `str.encode` with CPython's error handlers.
// JS strings and Python 3 strs differ in one way that matters here: a
// Python str is code points, a JS string UTF-16 units. A lone surrogate is
// representable in both, which is what lets `surrogateescape` round-trip.

import { UnicodeDecodeError, UnicodeEncodeError, LookupError } from "./errors.ts";

export type Errors = "strict" | "surrogateescape" | "ignore" | "replace";

function norm(encoding: string): string {
  const e = encoding.toLowerCase().replace(/_/g, "-");
  if (e === "utf8" || e === "utf-8") return "utf-8";
  if (e === "ascii" || e === "us-ascii") return "ascii";
  if (e === "latin-1" || e === "latin1" || e === "iso-8859-1") return "latin-1";
  if (e === "utf-16-le" || e === "utf-16le") return "utf-16-le";
  if (e === "utf-16-be" || e === "utf-16be") return "utf-16-be";
  if (e === "utf-16") return "utf-16";
  if (e === "mac-roman" || e === "macroman") return "mac-roman";
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

function decode_utf8(data: Uint8Array, errors: Errors): string {
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

function encode_utf8(text: string, errors: Errors): Uint8Array {
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

function decode_single_byte(data: Uint8Array, errors: Errors, limit: number, enc: string, table?: string): string {
  const out: string[] = [];
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (b < limit) out.push(String.fromCharCode(b));
    else if (table) out.push(table[b - 0x80]);
    else bad_byte(out, b, errors, enc, i);
  }
  return out.join("");
}

function encode_single_byte(text: string, errors: Errors, limit: number, enc: string, table?: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < limit) {
      out.push(c);
      continue;
    }
    const t = table ? table.indexOf(text[i]) : -1;
    if (t >= 0) {
      out.push(0x80 + t);
      continue;
    }
    if (errors === "surrogateescape" && c >= 0xdc80 && c <= 0xdcff) out.push(c - 0xdc00);
    else if (errors === "ignore") continue;
    else if (errors === "replace") out.push(0x3f);
    else
      throw new UnicodeEncodeError(
        `'${enc}' codec can't encode character '\\u${c.toString(16).padStart(4, "0")}' in position ${i}: ordinal not in range(${limit})`,
      );
  }
  return Uint8Array.from(out);
}

const MAC_ROMAN =
  "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ";

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

/** Python `data.decode(encoding, errors)`. */
export function decode(data: Uint8Array, encoding = "utf-8", errors: Errors = "strict"): string {
  switch (norm(encoding)) {
    case "utf-8":
      return decode_utf8(data, errors);
    case "ascii":
      return decode_single_byte(data, errors, 0x80, "ascii");
    case "latin-1":
      return decode_single_byte(data, errors, 0x100, "latin-1");
    case "mac-roman":
      return decode_single_byte(data, errors, 0x80, "mac-roman", MAC_ROMAN);
    case "cp1252":
      return new TextDecoder("windows-1252").decode(data);
    case "utf-16-le":
      return decode_utf16(data, errors, true);
    case "utf-16-be":
      return decode_utf16(data, errors, false);
    case "utf-16": {
      if (data[0] === 0xff && data[1] === 0xfe) return decode_utf16(data.subarray(2), errors, true);
      if (data[0] === 0xfe && data[1] === 0xff) return decode_utf16(data.subarray(2), errors, false);
      return decode_utf16(data, errors, true);
    }
    default:
      throw new LookupError(`unknown encoding: ${encoding}`);
  }
}

/** Python `text.encode(encoding, errors)`. */
export function encode(text: string, encoding = "utf-8", errors: Errors = "strict"): Uint8Array {
  switch (norm(encoding)) {
    case "utf-8":
      return encode_utf8(text, errors);
    case "ascii":
      return encode_single_byte(text, errors, 0x80, "ascii");
    case "latin-1":
      return encode_single_byte(text, errors, 0x100, "latin-1");
    case "mac-roman":
      return encode_single_byte(text, errors, 0x80, "mac-roman", MAC_ROMAN);
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
    default:
      throw new LookupError(`unknown encoding: ${encoding}`);
  }
}
