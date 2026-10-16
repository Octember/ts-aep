/**
 * Declarative field-format binding for chunk I/O.
 *
 * Each field declares its struct format via `fmt_field("B")`.
 * `_struct_info()` introspects attrs metadata to derive the combined
 * format string and field list.  Generic `Chunk.read()` / `write()`
 * use this to handle all fixed-layout chunks with zero per-class I/O code.
 */

import {
  AttrsBase,
  Factory,
  b,
  bytes_,
  concat,
  deferred,
  decode,
  dict_get,
  encode,
  enumerate,
  field,
  fields,
  getattr,
  int,
  lru_cache,
  lstrip,
  py_bool,
  struct,
  TypeError_,
  ValueError,
  zip,
  type Attribute,
  type FieldSpec,
} from "../../pyrt/index.ts";

const _chunk = deferred<typeof import("./chunk.ts")>("py_aep/binary/chunk");

export type _StructInfo = [
  string,
  readonly Attribute[],
  Map<number, string>,
  number,
  Map<number, string>,
  [string, Function, number] | null,
  Map<number, (value: any) => any>,
  string[],
  boolean,
  number,
];

export const _UNSET = Symbol("_UNSET");

/** The text of a fixed-size string field, read up to its first NUL,
 * that also keeps the field's raw bytes when non-zero bytes follow the
 * terminator.
 *
 * After Effects leaves such bytes behind: a renamed solid keeps the tail
 * of its previous name in its `opti`, and CSV / TXT data footage is coded
 * `"\0vsc"` / `"\0vst"` in `sspc` (AE 2026 imports). Writing the raw
 * bytes back keeps parse -> save byte-identical; an assigned plain `str`
 * is encoded and NUL-padded as usual.
 */
export class _NulTailStr extends String {
  declare raw: Uint8Array;
}

/** Decode a fixed-size string field up to its first NUL, keeping the
 * raw bytes when a non-zero tail follows it. */
export function _decode_fixed_str(value: Uint8Array, encoding: string): string | _NulTailStr {
  const nul = bytes_.find(value, b("\x00"));
  // surrogateescape keeps byte-exact round-trips even for legacy
  // non-UTF-8 bytes in old files.
  if (nul < 0) return decode(value, encoding, "surrogateescape");
  const text = decode(value.slice(0, nul), encoding, "surrogateescape");
  if (!py_bool(bytes_.strip(value.slice(nul), b("\x00")))) return text;
  const tailed = new _NulTailStr(text);
  tailed.raw = value;
  return tailed;
}

/** attrs converter for a fixed-size string field: a value holding a NUL
 * is stored as those field bytes, so it reads back as a re-parse of the
 * written file would (the text up to the NUL). */
export function _fixed_str_converter(encoding: string, size: number): (value: any) => any {
  function convert(value: any): any {
    if (typeof value === "string" && value.includes("\x00")) {
      const raw = encode(value, encoding, "surrogateescape").slice(0, size);
      return _decode_fixed_str(bytes_.ljust(raw, size, 0), encoding);
    }
    return value;
  }

  return convert;
}

export type FmtFieldOptions = {
  default?: any;
  repr?: boolean;
  encoding?: string | null;
  optional?: boolean;
  endian?: string | null;
  coerce?: ((value: any) => any) | null;
};

/** Declare an attrs field with its struct format in metadata.
 *
 * Args:
 *     fmt: struct format character(s) (e.g. `"B"`, `"48s"`).
 *     default: Default value for the field.  When omitted, bytes
 *         formats (`"Ns"`) default to `b"\\x00" * N` and all
 *         other formats default to `0`.
 *     repr: Whether to include this field in `repr()`.
 *     encoding: When set, the raw `bytes` from `struct.unpack`
 *         are decoded to `str` up to the first NUL, and on write the
 *         `str` is encoded back and NUL-padded to fill the fixed size
 *         (non-zero bytes read after the NUL are written back
 *         unchanged, see `_NulTailStr`).
 *     optional: When `True`, the field may be absent in older
 *         binary versions. Use `default=None` so that `None`
 *         means "not present" (preserves round-trip fidelity).
 *         Optional fields must come after all required fields.
 *     endian: Per-field byte-order override (e.g. `"<"` for
 *         little-endian). When `None` (default), the chunk-level
 *         big-endian default is used. Triggers per-field I/O in
 *         `Chunk.read()` / `Chunk.write()`.
 *     coerce: Type callable applied after unpacking (e.g. `bool`).
 *         On write, the inverse is applied (e.g. `int` for `bool`).
 */
export function fmt_field(fmt: string, kw: FmtFieldOptions = {}): FieldSpec {
  const {
    default: default_given = _UNSET,
    repr = true,
    encoding = null,
    optional = false,
    endian = null,
    coerce = null,
  } = kw;
  let default_ = default_given;
  if (default_ === _UNSET) {
    if (encoding != null) {
      default_ = "";
    } else if (fmt.endsWith("s")) {
      const n = fmt.length > 1 ? int(fmt.slice(0, -1)) : 1;
      default_ = new Uint8Array(n);
    } else {
      // Coerce so constructed chunks hold the read-time type
      // (e.g. bool_field defaults to False, not 0).
      default_ = coerce != null ? coerce(0) : 0;
    }
  }
  const md: Record<string, any> = { fmt };
  let converter: ((value: any) => any) | null = null;
  if (encoding != null) {
    md["encoding"] = encoding;
    converter = _fixed_str_converter(encoding, struct.calcsize(">" + fmt));
  }
  if (optional) md["optional"] = true;
  if (endian === "<") md["endian"] = endian;
  if (coerce != null) md["coerce"] = coerce;
  return field({ default: default_, repr, metadata: md, converter });
}

/** Declare a list-of-items field that fills the remaining body bytes.
 *
 * The item count is inferred at read time: `count = remaining // item_size`.
 * Item classes must use `fmt_field()` for their fields (with `endian`
 * and `encoding` as needed) so that `_struct_info()` can auto-serialize
 * them.
 *
 * Args:
 *     item_cls: Class used to deserialize each item.
 *     item_size: Fixed byte size of each serialized item.
 */
export function items_field(item_cls: Function, item_size: number): FieldSpec {
  const md: Record<string, any> = {
    items: true,
    item_cls,
    item_size,
  };
  return field({ default: Factory(() => []), metadata: md });
}

// ---------------------------------------------------------------------------
// Semantic aliases for common struct formats
// ---------------------------------------------------------------------------

/** Unsigned 1-byte integer field (`struct.unpack("B")`). */
export function u1_field(kw: FmtFieldOptions = {}): FieldSpec {
  return fmt_field("B", kw);
}

/** Unsigned 2-byte integer field (`struct.unpack("H")`). */
export function u2_field(kw: FmtFieldOptions = {}): FieldSpec {
  return fmt_field("H", kw);
}

/** Unsigned 4-byte integer field (`struct.unpack("I")`). */
export function u4_field(kw: FmtFieldOptions = {}): FieldSpec {
  return fmt_field("I", kw);
}

/** Unsigned 8-byte integer field (`struct.unpack("Q")`). */
export function u8_field(kw: FmtFieldOptions = {}): FieldSpec {
  return fmt_field("Q", kw);
}

/** Signed 2-byte integer field (`struct.unpack("h")`). */
export function s2_field(kw: FmtFieldOptions = {}): FieldSpec {
  return fmt_field("h", kw);
}

/** Signed 4-byte integer field (`struct.unpack("i")`). */
export function s4_field(kw: FmtFieldOptions = {}): FieldSpec {
  return fmt_field("i", kw);
}

/** 4-byte IEEE 754 float field (`struct.unpack("f")`). */
export function f4_field(kw: FmtFieldOptions = {}): FieldSpec {
  return fmt_field("f", kw);
}

/** 8-byte IEEE 754 double field (`struct.unpack("d")`). */
export function f8_field(kw: FmtFieldOptions = {}): FieldSpec {
  return fmt_field("d", kw);
}

/** Fixed-size raw bytes field (`struct.unpack("Ns")`). */
export function bytes_field(n: number, kw: FmtFieldOptions = {}): FieldSpec {
  return fmt_field(`${n}s`, kw);
}

/** Fixed-size string field, decoded via `encoding`. */
export function str_field(n: number, kw: FmtFieldOptions & { encoding?: string } = {}): FieldSpec {
  const { encoding = "utf-8", ...rest } = kw;
  return fmt_field(`${n}s`, { ...rest, encoding });
}

/** Fixed-size ASCII string field. */
export function ascii_field(n: number, kw: FmtFieldOptions = {}): FieldSpec {
  return fmt_field(`${n}s`, { ...kw, encoding: "ascii" });
}

/** 1-byte boolean field (`struct.unpack("B")`, coerced to `bool`). */
export function bool_field(kw: FmtFieldOptions = {}): FieldSpec {
  return fmt_field("B", { ...kw, coerce: py_bool });
}

export function _struct_info_uncached(cls: Function): _StructInfo | null {
  /** Derive struct layout metadata for a chunk class.
   *
   * Returns a 10-tuple `(fmt, data_fields, encodings,
   * optional_start, endians, items_info, coerces, init_names, simple,
   * expected_size)` or `None` for raw-bytes chunks that have neither
   * `fmt_field` nor `items_field` fields.
   *
   * - `encodings`: field-index -> encoding name.
   * - `optional_start`: index of first optional field.
   * - `endians`: field-index -> endian override (`"<"` or `">"`);
   *   non-empty triggers per-field I/O in `Chunk.read()` / `Chunk.write()`.
   * - `items_info`: `(init_param_name, item_cls, item_size)` or `None`.
   * - `coerces`: field-index -> type callable (e.g. `bool`).
   * - `simple`: `True` when the chunk has no string encodings, endian
   *   overrides, optional fields, or items, so `_decode_fields` can be
   *   replaced with `dict(zip(init_names, values))` plus inline coerce
   *   and trailing-bytes handling.
   * - `expected_size`: pre-computed `struct.calcsize('>' + fmt)`.
   */
  const base_names: ReadonlySet<string> =
    cls === _chunk().Chunk || _chunk().Chunk.isPrototypeOf(cls)
      ? new Set(fields(_chunk().Chunk).map((f) => f.name))
      : new Set();
  const fmt_parts: string[] = [];
  const data_fields: Attribute[] = [];
  const encodings = new Map<number, string>();
  const endians = new Map<number, string>();
  const coerces = new Map<number, (value: any) => any>();
  let optional_start: number | null = null;
  let items_info: [string, Function, number] | null = null;

  for (const f of fields(cls)) {
    if (base_names.has(f.name)) continue;
    if (f.metadata["items"]) {
      items_info = [_init_name(f.name), f.metadata["item_cls"], f.metadata["item_size"]];
      continue;
    }
    const fmt_char = f.metadata["fmt"];
    if (fmt_char != null) {
      const is_opt = f.metadata["optional"] ?? false;
      if (is_opt) {
        if (optional_start == null) optional_start = data_fields.length;
      } else if (optional_start != null) {
        throw new ValueError(`${cls.name}.${f.name}: required field after optional`);
      }
      const enc = f.metadata["encoding"];
      if (enc != null) encodings.set(data_fields.length, enc);
      const end = f.metadata["endian"];
      if (end != null) endians.set(data_fields.length, end);
      const crc = f.metadata["coerce"];
      if (crc != null) coerces.set(data_fields.length, crc);
      fmt_parts.push(fmt_char);
      data_fields.push(f);
    }
  }

  if (!py_bool(fmt_parts) && items_info == null) return null;

  if (optional_start == null) optional_start = data_fields.length;

  let combined = "";
  if (py_bool(fmt_parts)) {
    // Validate format/field count match at cache time
    combined = fmt_parts.join("");
    const n_values = struct
      .unpack(">" + combined, new Uint8Array(struct.calcsize(">" + combined)))
      .length;
    if (n_values !== data_fields.length) {
      throw new ValueError(
        `${cls.name}: struct format yields ${n_values} values ` +
          `but has ${data_fields.length} fmt_field fields`,
      );
    }
  }

  const init_names = data_fields.map((f) => _init_name(f.name));
  // Simple chunks have no string encodings, endian overrides, optional
  // fields, or items. Coerces are handled inline in the fast path.
  const simple =
    !py_bool(encodings) &&
    !py_bool(endians) &&
    items_info == null &&
    optional_start === data_fields.length;
  const expected_size = py_bool(combined) ? struct.calcsize(">" + combined) : 0;

  return [
    combined,
    [...data_fields],
    encodings,
    optional_start,
    endians,
    items_info,
    coerces,
    init_names,
    simple,
    expected_size,
  ];
}

// attrs `@define` sets `__hash__ = None` in class stubs, so type objects
// fail lru_cache's `Hashable` parameter check even though they are always
// hashable at runtime. The cast restores the precise signature for callers.
export const _struct_info: (cls: Function) => _StructInfo | null = lru_cache(_struct_info_uncached);

/** Convert attrs field name to init parameter name.
 *
 * attrs strips the leading underscore from private field names for
 * the `__init__` signature: `_trailing` -> `trailing=`.
 */
export function _init_name(name: string): string {
  return name.startsWith("_") ? lstrip(name, "_") : name;
}

/** Decode raw struct values into init keyword arguments.
 *
 * Applies encoding (bytes > str) and coerce (e.g. int > bool) transforms
 * declared via `fmt_field()`. Shared by `Chunk.read()` and
 * `FmtItem.frombytes()`.
 */
export function _decode_fields(
  data_fields: readonly Attribute[],
  values: any[],
  encodings: Map<number, string>,
  coerces: Map<number, (value: any) => any>,
  init_names: readonly string[] | null = null,
): Record<string, any> {
  // NOTE(port): kwargs dict is a plain object: keys are init-name identifiers
  // passed straight to `cls(**kw)`, never iterated for numeric-looking keys.
  const kw: Record<string, any> = {};
  for (const [i, [fld, raw]] of enumerate(zip([...data_fields], values))) {
    let value = raw;
    const enc = dict_get(encodings, i);
    if (enc != null && value != null) value = _decode_fixed_str(value, enc);
    const crc = dict_get(coerces, i);
    if (crc != null && value != null) value = crc(value);
    kw[init_names != null ? init_names[i] : _init_name(fld.name)] = value;
  }
  return kw;
}

/** Encode a single field value for struct packing.
 *
 * Applies encoding (str > null-padded bytes) and coerce reversal
 * (bool > int) transforms. Shared by `Chunk.write()` and
 * `FmtItem.tobytes()`.
 */
export function _encode_value(
  value: any,
  idx: number,
  encodings: Map<number, string>,
  coerces: Map<number, (value: any) => any>,
  endian: string,
  fmt_str: string,
): any {
  const enc = dict_get(encodings, idx);
  if (enc != null) {
    const field_size = struct.calcsize(endian + fmt_str);
    if (value instanceof _NulTailStr && value.raw.length === field_size) return value.raw;
    // `String(value)` unwraps a `_NulTailStr` (a String object) to its text.
    const encoded = encode(String(value), enc, "surrogateescape").slice(0, field_size);
    return concat(encoded, new Uint8Array(field_size - encoded.length));
  }
  if (coerces.has(idx)) return int(value);
  return value;
}

/** Base for item types whose fields are declared with `fmt_field`. */
export class FmtItem extends AttrsBase {
  /** Construct an item from bytes using its `_struct_info` metadata. */
  static frombytes(data: Uint8Array): FmtItem {
    const info = _struct_info(this);
    if (info == null) throw new TypeError_(`${this.name} has no fmt_field metadata`);
    const [
      fmt,
      data_fields,
      encodings,
      _optional_start,
      endians,
      _items_info,
      coerces,
      init_names,
      simple,
      expected,
    ] = info;
    let values: any[];
    if (py_bool(endians)) {
      values = [];
      let pos = 0;
      for (const [i, f] of enumerate(data_fields)) {
        const fe = dict_get(endians, i, ">");
        const ff = f.metadata["fmt"];
        const f_size = struct.calcsize(fe + ff);
        const [v] = struct.unpack(fe + ff, data.slice(pos, pos + f_size));
        values.push(v);
        pos += f_size;
      }
    } else {
      values = struct.unpack(">" + fmt, data.slice(0, expected));
    }
    let kw: Record<string, any>;
    if (simple) {
      // NOTE(port): kwargs keys are Python identifiers (never numeric-looking), so insertion order matches dict order.
      kw = {};
      for (const [name, v] of zip([...init_names], values)) kw[name] = v;
      for (const [i, crc] of coerces) {
        const name = init_names[i];
        kw[name] = crc(kw[name]);
      }
    } else {
      kw = _decode_fields(data_fields, values, encodings, coerces, init_names);
    }
    return new this(kw);
  }

  /** Serialize an item to bytes using its `_struct_info` metadata. */
  tobytes(): Uint8Array {
    const info = _struct_info(this.constructor as Function);
    if (info == null) {
      throw new TypeError_(`${this.constructor.name} has no fmt_field metadata`);
    }
    const [
      fmt,
      data_fields,
      encodings,
      _optional_start,
      endians,
      _items_info,
      coerces,
      _init_names,
      _simple,
      _expected,
    ] = info;
    if (py_bool(endians)) {
      const parts: Uint8Array[] = [];
      for (const [i, f] of enumerate(data_fields)) {
        const fe = dict_get(endians, i, ">");
        let value = getattr(this, f.name);
        value = _encode_value(value, i, encodings, coerces, fe, f.metadata["fmt"]);
        parts.push(struct.pack(fe + f.metadata["fmt"], value));
      }
      return bytes_.join(parts);
    }
    const values: any[] = [];
    for (const [i, f] of enumerate(data_fields)) {
      let value = getattr(this, f.name);
      value = _encode_value(value, i, encodings, coerces, ">", f.metadata["fmt"]);
      values.push(value);
    }
    return struct.pack(">" + fmt, ...values);
  }
}
