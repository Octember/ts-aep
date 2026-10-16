// `from __future__ import annotations` and the `typing` imports are dropped:
// annotations are TypeScript types only.
import {
  TypeError_,
  ValueError,
  descriptor,
  dict_get,
  float,
  int,
  num_str,
  py_bool,
} from "../../../../pyrt/index.ts";
import { Hdr10ColorPrimaries, PngCompression } from "../../../enums/index.ts";
import { ChunkField, enum_or_raw } from "../../descriptors.ts";
import { validate_enum, validate_one_of, validate_positive_number } from "../../validators.ts";
import { FormatOptionsBase } from "./base.ts";
import type { PngRoptChunk } from "../../../binary/render_chunks.ts";
import type { Utf8Chunk } from "../../../binary/scalar_chunks.ts";

// TODO(port): json.dumps / json.loads parity for the HDR10 Utf8 body. Python
// keeps int and float apart (`1000` vs `1000.0`); JSON.parse does not, so an
// integer-valued float read from the chunk re-serializes as an int. JSON.parse
// also rejects NaN / Infinity (Python accepts them) and reorders integer-like
// keys. Real HDR10 metadata uses identifier keys and non-integer nit values,
// so the common case round-trips byte-identically.

/** `json.dumps` string encoding with `ensure_ascii=True` (lowercase `\uXXXX`). */
// json.dumps parity
function _json_string(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += "\\\\";
    else if (c === 0x0a) out += "\\n";
    else if (c === 0x0d) out += "\\r";
    else if (c === 0x09) out += "\\t";
    else if (c === 0x08) out += "\\b";
    else if (c === 0x0c) out += "\\f";
    else if (c >= 0x20 && c <= 0x7e) out += s[i];
    else out += "\\u" + c.toString(16).padStart(4, "0");
  }
  return out + '"';
}

/**
 * `json.dumps(value, separators=(",", ":"))`. The Utf8 body is compared
 * byte-for-byte on save, so the spelling is reproduced here rather than
 * taken from `JSON.stringify` (which leaves non-ASCII unescaped).
 */
// json.dumps parity
function _json_dumps_compact(value: any): string {
  if (value == null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "number") {
    // json.dumps spells non-finite floats as NaN / Infinity, not float repr.
    if (Number.isNaN(value)) return "NaN";
    if (!Number.isFinite(value)) return value > 0 ? "Infinity" : "-Infinity";
    return num_str(value);
  }
  if (typeof value === "string") return _json_string(value);
  if (Array.isArray(value)) return "[" + value.map(_json_dumps_compact).join(",") + "]";
  if (value instanceof Map) {
    const parts: string[] = [];
    for (const [k, v] of value) parts.push(_json_string(String(k)) + ":" + _json_dumps_compact(v));
    return "{" + parts.join(",") + "}";
  }
  const parts: string[] = [];
  for (const [k, v] of Object.entries(value)) parts.push(_json_string(k) + ":" + _json_dumps_compact(v));
  return "{" + parts.join(",") + "}";
}

/**
 * `json.loads` with every JSON object decoded as a `Map` (a Python `dict`),
 * so later `.get` / `.pop` / item assignment and re-serialization keep the
 * insertion order.
 */
function _json_loads(text: string): any {
  return JSON.parse(text, (_key, value) =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? new Map(Object.entries(value))
      : value,
  );
}

/**
 * PNG format-specific render options.
 *
 * These settings correspond to the PNG Options dialog in After Effects,
 * accessible when the output format is set to PNG Sequence.
 *
 * The Ropt body for PNG contains a fixed-size binary block (typically 318
 * bytes) with width, height, and bit depth at known offsets. HDR10 metadata
 * is stored separately in a JSON `Utf8` chunk alongside the Ropt chunk.
 *
 * Example:
 *     ```python
 *     from py_aep import PngFormatOptions, parse
 *
 *     app = parse("project.aep")
 *     om = app.project.render_queue.items[0].output_modules[0]
 *     if isinstance(om.format_options, PngFormatOptions):
 *         print(om.format_options.compression)
 *     ```
 */
export class PngFormatOptions extends FormatOptionsBase {
  declare _body: PngRoptChunk;
  declare _hdr10_utf8: Utf8Chunk | null;
  declare _hdr10_meta: Map<string, any>;

  constructor(kw: { _body: PngRoptChunk; _hdr10_utf8?: Utf8Chunk | null }) {
    super();
    const { _body, _hdr10_utf8 = null } = kw;
    this._body = _body;
    this._hdr10_utf8 = _hdr10_utf8;
    this._hdr10_meta = new Map();
    if (_hdr10_utf8 != null) {
      try {
        const parsed = _json_loads(_hdr10_utf8.value);
        if (parsed instanceof Map) this._hdr10_meta = parsed;
      } catch (e) {
        // Python: `except (json.JSONDecodeError, ValueError): pass`
        if (!(e instanceof SyntaxError || e instanceof ValueError)) throw e;
      }
    }
  }

  /** The output width in pixels. Read-only. */
  declare width: number;

  /** The output height in pixels. Read-only. */
  declare height: number;

  /**
   * The output bit depth per channel: `8` or `16`, kept in step with the
   * output module's `Depth` setting. After Effects renders the module's
   * `Depth` (AE 2026), so change that rather than this field. Read / Write.
   */
  declare bit_depth: number;

  /**
   * The PNG compression / interlace mode. Corresponds to the
   * `Compression` dropdown in the PNG Options dialog. An out-of-enum
   * stored value reads back as a raw `int` (the binary is trusted).
   * Read / Write.
   */
  declare compression: PngCompression | number;

  /** Serialize `_hdr10_meta` back to the Utf8 chunk body. */
  _sync_hdr10(): void {
    if (this._hdr10_utf8 != null) {
      this._hdr10_utf8.value = _json_dumps_compact(this._hdr10_meta);
    }
  }

  /**
   * Whether HDR10 metadata is embedded in the PNG output.
   * Corresponds to the `Include HDR10 Metadata` checkbox in the PNG
   * Options dialog. Only available for 16-bit output. Read / Write.
   */
  get include_hdr10_metadata(): boolean {
    return py_bool(dict_get(this._hdr10_meta, "colorMetadataPresent", false));
  }

  set include_hdr10_metadata(value: boolean) {
    this._hdr10_meta.set("colorMetadataPresent", py_bool(value));
    this._sync_hdr10();
  }

  /**
   * The color primaries used for HDR10 metadata. Corresponds to the
   * `Color Primaries` dropdown in the PNG Options dialog.
   * Only meaningful when `include_hdr10_metadata` is `True`. An
   * out-of-enum stored value reads back as a raw `int` (the binary
   * is trusted). Read / Write.
   */
  get color_primaries(): Hdr10ColorPrimaries | number {
    const raw = dict_get(this._hdr10_meta, "displayPrimaries");
    if (raw == null) return Hdr10ColorPrimaries.P3_D65;
    return enum_or_raw((v: any) => {
      // Python `int(v)` raises TypeError for a list / dict; pyrt `int` would not.
      if (typeof v !== "number" && typeof v !== "string" && typeof v !== "boolean") {
        throw new TypeError_(`int() argument must be a string, a bytes-like object or a real number, not '${Array.isArray(v) ? "list" : "dict"}'`);
      }
      return Hdr10ColorPrimaries.of(int(v));
    })(raw);
  }

  set color_primaries(value: Hdr10ColorPrimaries) {
    validate_enum(Hdr10ColorPrimaries)(value);
    this._hdr10_meta.set("displayPrimaries", int(value));
    this._sync_hdr10();
  }

  /**
   * The minimum display luminance in nits for HDR10 metadata, or
   * `None` if not explicitly set. Corresponds to the
   * `Luminance Minimum` field in the PNG Options dialog. Read / Write.
   */
  get luminance_min(): number | null {
    const raw = dict_get(this._hdr10_meta, "minLuminance");
    return raw != null ? float(raw) : null;
  }

  set luminance_min(value: number | null) {
    if (value == null) {
      this._hdr10_meta.delete("minLuminance");
    } else {
      validate_positive_number(value);
      this._hdr10_meta.set("minLuminance", value);
    }
    this._sync_hdr10();
  }

  /**
   * The maximum display luminance in nits for HDR10 metadata, or
   * `None` if not explicitly set. Corresponds to the
   * `Luminance Maximum` field in the PNG Options dialog. Read / Write.
   */
  get luminance_max(): number | null {
    const raw = dict_get(this._hdr10_meta, "maxLuminance");
    return raw != null ? float(raw) : null;
  }

  set luminance_max(value: number | null) {
    if (value == null) {
      this._hdr10_meta.delete("maxLuminance");
    } else {
      validate_positive_number(value);
      this._hdr10_meta.set("maxLuminance", value);
    }
    this._sync_hdr10();
  }

  /**
   * The maximum content light level in nits for HDR10 metadata, or
   * `None` if not explicitly set. Corresponds to the
   * `Content Light Maximum` field in the PNG Options dialog. Read / Write.
   */
  get content_light_max(): number | null {
    const raw = dict_get(this._hdr10_meta, "maxContentLightLevel");
    return raw != null ? float(raw) : null;
  }

  set content_light_max(value: number | null) {
    if (value == null) {
      this._hdr10_meta.delete("maxContentLightLevel");
    } else {
      validate_positive_number(value);
      this._hdr10_meta.set("maxContentLightLevel", value);
    }
    this._sync_hdr10();
  }

  /**
   * The maximum frame average light level in nits for HDR10 metadata,
   * or `None` if not explicitly set. Corresponds to the
   * `Content Light Average` field in the PNG Options dialog. Read / Write.
   */
  get content_light_average(): number | null {
    const raw = dict_get(this._hdr10_meta, "maxFrameAverageLightLevel");
    return raw != null ? float(raw) : null;
  }

  set content_light_average(value: number | null) {
    if (value == null) {
      this._hdr10_meta.delete("maxFrameAverageLightLevel");
    } else {
      validate_positive_number(value);
      this._hdr10_meta.set("maxFrameAverageLightLevel", value);
    }
    this._sync_hdr10();
  }
}

descriptor(PngFormatOptions, "width", new ChunkField<number>("_body", "width", { read_only: true }));
descriptor(PngFormatOptions, "height", new ChunkField<number>("_body", "height", { read_only: true }));
descriptor(
  PngFormatOptions,
  "bit_depth",
  new ChunkField<number>("_body", "bit_depth", { validate: validate_one_of([8, 16]) }),
);
descriptor(
  PngFormatOptions,
  "compression",
  ChunkField.enum(PngCompression, "_body", "compression", { allow_out_of_enum_values: true }),
);
