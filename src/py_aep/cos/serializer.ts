/**
 * Serialize Python objects back to COS (Carousel Object Syntax) binary.
 *
 * This is the inverse of `CosParser.parse`: it takes a nested Python
 * structure (dicts, lists, strings, numbers, bools, `null`,
 * `IndirectObject`, `IndirectReference`, `Stream`) and emits COS-format
 * bytes suitable for writing back into a btdk chunk's `binary_data`.
 */

import { BytesIO, b, bytes_, concat, encode, format, getattr, PyFloat, TypeError_, type_name, unbox } from "../../pyrt/index.ts";
import { CosName, IndirectObject, IndirectReference, Stream } from "./cos.ts";

/**
 * Serialize a parsed COS value tree back to binary.
 *
 * @param data - The Python object tree to serialize. May be a dict, list,
 *   str, int, float, bool, `null`, `bytes`,
 *   `IndirectObject`, `IndirectReference`, or `Stream`.
 * @returns The COS binary representation.
 */
export function serialize(data: any): Uint8Array {
  const buf = new BytesIO();
  // AE's btdk blob begins with a leading space before the first token.
  buf.write(b(" "));
  _write_value(buf, data, { top_level: true });
  return buf.getvalue();
}

/** Write a space separator unless the buffer already ends with whitespace. */
export function _space(buf: BytesIO): void {
  const pos = buf.tell();
  if (pos === 0) return;
  buf.seek(pos - 1);
  const last = buf.read(1);
  if (!bytes_.contains(b(" \t\n\r"), last)) buf.write(b(" "));
}

/** Dispatch `value` to the appropriate serialization handler. */
export function _write_value(buf: BytesIO, value: any, kw: { top_level?: boolean } = {}): void {
  const { top_level = false } = kw;
  if (value instanceof Map) {
    if (top_level) {
      _write_dict_content(buf, value);
    } else {
      _space(buf);
      _write_dict(buf, value);
    }
  } else if (Array.isArray(value)) {
    if (top_level) {
      _write_array_content(buf, value);
    } else {
      _space(buf);
      _write_array(buf, value);
    }
  } else if (typeof value === "boolean") {
    // Must come before int check since bool is a subclass of int
    _space(buf);
    buf.write(value ? b("true") : b("false"));
  } else if (typeof value === "bigint" || (typeof value === "number" && Number.isInteger(value) && !Object.is(value, -0))) {
    // A plain integral JS number is a Python int; a Python float reaches here boxed as `PyFloat`.
    _space(buf);
    buf.write(encode(String(value), "ascii"));
  } else if (typeof value === "number" || value instanceof PyFloat) {
    _space(buf);
    buf.write(_format_float(unbox(value)));
  } else if (value instanceof CosName) {
    _space(buf);
    _write_identifier(buf, value.value);
  } else if (typeof value === "string" || value instanceof String) {
    // A CosString / _NulTailStr is a String object in TS (a str subclass in Python),
    // so a typeof check alone would miss it.
    _space(buf);
    _write_string(buf, value as string);
  } else if (value instanceof Uint8Array) {
    _space(buf);
    _write_hex_string(buf, value);
  } else if (value == null) {
    _space(buf);
    buf.write(b("null"));
  } else if (value instanceof IndirectObject) {
    _space(buf);
    _write_indirect_object(buf, value);
  } else if (value instanceof IndirectReference) {
    _space(buf);
    _write_indirect_reference(buf, value);
  } else if (value instanceof Stream) {
    _space(buf);
    _write_stream(buf, value);
  } else {
    throw new TypeError_(`Cannot serialize COS value of type ${type_name(value)}`);
  }
}

/**
 * Format a float matching After Effects' COS conventions.
 *
 * Whole-valued floats keep a trailing `.0` (AE writes `0.0` / `9.0`,
 * not `0` / `9`), which distinguishes them from COS integers and keeps
 * the serialized blob byte-faithful.
 */
export function _format_float(value: number): Uint8Array {
  let text = format(value, ".10g");
  // no '.', exponent, 'nan'/'inf'
  if (![".", "e", "E", "n", "i"].some((c) => text.includes(c))) text += ".0";
  // AE omits the leading zero for |v| < 1 (".5", "-.5") but keeps "0.0".
  if (text.startsWith("0.") && text !== "0.0") {
    text = text.slice(1);
  } else if (text.startsWith("-0.") && text !== "-0.0") {
    text = "-" + text.slice(2);
  }
  return encode(text, "ascii");
}

/** Write a COS dictionary: `<< /key value /key value >>`. */
export function _write_dict(buf: BytesIO, d: Map<string, any>): void {
  buf.write(b("<<"));
  _write_dict_content(buf, d);
  _space(buf);
  buf.write(b(">>"));
}

/** Write dict key/value pairs without the `<<`/`>>` delimiters. */
export function _write_dict_content(buf: BytesIO, d: Map<string, any>): void {
  for (const [key, val] of d) {
    _space(buf);
    _write_identifier(buf, key);
    _write_value(buf, val);
  }
}

/** Write a COS array: `[ val val val ]`. */
export function _write_array(buf: BytesIO, lst: any[]): void {
  buf.write(b("["));
  _write_array_content(buf, lst);
  _space(buf);
  buf.write(b("]"));
}

/** Write array elements without `[`/`]` delimiters. */
export function _write_array_content(buf: BytesIO, lst: any[]): void {
  for (const item of lst) {
    _write_value(buf, item);
  }
}

/** Write a COS identifier (name object): `/foo`. */
export function _write_identifier(buf: BytesIO, name: string): void {
  buf.write(b("/"));
  let escaped = "";
  for (const ch of name) {
    const code = ch.codePointAt(0)!;
    if (code < 0x21 || code > 0x7e || "()[]<>{}/%#".includes(ch)) {
      escaped += `#${code.toString(16).padStart(2, "0")}`;
    } else {
      escaped += ch;
    }
  }
  buf.write(encode(escaped, "ascii"));
}

/**
 * Write a COS string literal: `(escaped content)`.
 *
 * Strings are encoded as UTF-16 BE with a BOM prefix (AE's convention
 * for text data) unless the value is a `CosString` that was parsed as
 * raw ASCII / UTF-8 (e.g. bit-flag strings), in which case the original
 * single-byte encoding is reproduced for byte fidelity.
 */
export function _write_string(buf: BytesIO, s: string): void {
  let raw: Uint8Array;
  if (getattr(s, "cos_utf16", true)) {
    raw = concat(b("\xfe\xff"), encode(String(s), "utf-16-be"));
  } else {
    raw = encode(String(s), "utf-8");
  }
  buf.write(b("("));
  buf.write(_escape_string(raw));
  buf.write(b(")"));
}

/**
 * Escape bytes for a COS string literal.
 *
 * Only the characters that affect COS string parsing are escaped:
 * the delimiters `(` / `)` and the escape character `\`. After
 * Effects writes control bytes (newline, CR, backspace, form-feed)
 * raw inside string literals, so they are left unescaped to keep the
 * serialized blob byte-faithful.
 */
export function _escape_string(raw: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (const byte of raw) {
    if (byte === b("(")[0]) {
      out.push(...b("\\("));
    } else if (byte === b(")")[0]) {
      out.push(...b("\\)"));
    } else if (byte === b("\\")[0]) {
      out.push(...b("\\\\"));
    } else {
      out.push(byte);
    }
  }
  return Uint8Array.from(out);
}

/** Write a COS hex string: `<hexdata>`. */
export function _write_hex_string(buf: BytesIO, data: Uint8Array): void {
  buf.write(b("<"));
  buf.write(encode(bytes_.hex(data), "ascii"));
  buf.write(b(">"));
}

/** Write `N G obj <data> endobj`. */
export function _write_indirect_object(buf: BytesIO, obj: IndirectObject): void {
  buf.write(encode(`${obj.object_number}`, "ascii"));
  buf.write(b(" "));
  buf.write(encode(`${obj.generation_number}`, "ascii"));
  buf.write(b(" obj"));
  _write_value(buf, obj.data);
  buf.write(b(" endobj"));
}

/** Write `N G R`. */
export function _write_indirect_reference(buf: BytesIO, ref: IndirectReference): void {
  buf.write(encode(`${ref.object_number}`, "ascii"));
  buf.write(b(" "));
  buf.write(encode(`${ref.generation_number}`, "ascii"));
  buf.write(b(" R"));
}

/** Write `<< dict >> stream\n<bytes>endstream`. */
export function _write_stream(buf: BytesIO, stream: Stream): void {
  _write_dict(buf, stream.dictionary);
  buf.write(b("stream\n"));
  buf.write(stream.data);
  buf.write(b("endstream"));
}
