// `from __future__ import annotations` and the `typing` imports are dropped:
// annotations are TypeScript types only.
import {
  TypeError_,
  ValueError,
  descriptor,
  dict_get,
  float,
  int,
  is_real,
  json_dumps,
  json_loads,
  type_name,
  py_bool,
} from "../../../../pyrt/index.ts";
import { Hdr10ColorPrimaries, PngCompression } from "../../../enums/index.ts";
import { ChunkField, enum_or_raw, type Dynamic } from "../../descriptors.ts";
import { validate_enum, validate_one_of, validate_positive_number } from "../../validators.ts";
import { FormatOptionsBase } from "./base.ts";
import type { PngRoptChunk } from "../../../binary/render_chunks.ts";
import type { Utf8Chunk } from "../../../binary/scalar_chunks.ts";

/** HDR10 metadata JSON as AE stores it (parsed, not validated): the binary is trusted, so values are read as scalars. */
type Hdr10Meta = Map<string, Dynamic>;

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
 * @example
 * ```ts
 * import { PngFormatOptions, parse } from "@bevyl-ai/ts-aep";
 *
 * const app = parse("project.aep");
 * const om = app.project.render_queue.items[0].output_modules[0];
 * if (om.format_options instanceof PngFormatOptions) {
 *   console.log(om.format_options.compression);
 * }
 * ```
 */
export class PngFormatOptions extends FormatOptionsBase {
  declare _body: PngRoptChunk;
  declare _hdr10_utf8: Utf8Chunk | null;
  declare _hdr10_meta: Hdr10Meta;

  constructor(kw: { _body: PngRoptChunk; _hdr10_utf8?: Utf8Chunk | null }) {
    super();
    const { _body, _hdr10_utf8 = null } = kw;
    this._body = _body;
    this._hdr10_utf8 = _hdr10_utf8;
    this._hdr10_meta = new Map();
    if (_hdr10_utf8 != null) {
      try {
        const parsed = json_loads(_hdr10_utf8.value);
        if (parsed instanceof Map) this._hdr10_meta = parsed;
      } catch (e) {
        // Python: `except (json.JSONDecodeError, ValueError): pass`
        if (!(e instanceof ValueError)) throw e;
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
      this._hdr10_utf8.value = json_dumps(this._hdr10_meta, { separators: [",", ":"] });
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
    this._hdr10_meta.set("colorMetadataPresent", !!value);
    this._sync_hdr10();
  }

  /**
   * The color primaries used for HDR10 metadata. Corresponds to the
   * `Color Primaries` dropdown in the PNG Options dialog.
   * Only meaningful when `include_hdr10_metadata` is `true`. An
   * out-of-enum stored value reads back as a raw `int` (the binary
   * is trusted). Read / Write.
   */
  get color_primaries(): Hdr10ColorPrimaries | number {
    const raw = this._hdr10_meta.get("displayPrimaries") ?? null;
    if (raw == null) return Hdr10ColorPrimaries.P3_D65;
    return enum_or_raw((v: Dynamic) => {
      // Python `int(v)` raises TypeError for a list / dict; pyrt `int` would not.
      if (!is_real(v) && typeof v !== "string" && typeof v !== "boolean") {
        throw new TypeError_(`int() argument must be a string, a bytes-like object or a real number, not '${type_name(v)}'`);
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
   * `null` if not explicitly set. Corresponds to the
   * `Luminance Minimum` field in the PNG Options dialog. Read / Write.
   */
  get luminance_min(): number | null {
    const raw = this._hdr10_meta.get("minLuminance") ?? null;
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
   * `null` if not explicitly set. Corresponds to the
   * `Luminance Maximum` field in the PNG Options dialog. Read / Write.
   */
  get luminance_max(): number | null {
    const raw = this._hdr10_meta.get("maxLuminance") ?? null;
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
   * `null` if not explicitly set. Corresponds to the
   * `Content Light Maximum` field in the PNG Options dialog. Read / Write.
   */
  get content_light_max(): number | null {
    const raw = this._hdr10_meta.get("maxContentLightLevel") ?? null;
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
   * or `null` if not explicitly set. Corresponds to the
   * `Content Light Average` field in the PNG Options dialog. Read / Write.
   */
  get content_light_average(): number | null {
    const raw = this._hdr10_meta.get("maxFrameAverageLightLevel") ?? null;
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

descriptor(PngFormatOptions, "width", new ChunkField("_body", "width", { read_only: true }));
descriptor(PngFormatOptions, "height", new ChunkField("_body", "height", { read_only: true }));
descriptor(
  PngFormatOptions,
  "bit_depth",
  new ChunkField("_body", "bit_depth", { validate: validate_one_of([8, 16]) }),
);
descriptor(
  PngFormatOptions,
  "compression",
  ChunkField.enum(PngCompression, "_body", "compression", { allow_out_of_enum_values: true }),
);
