// `from __future__ import annotations` and the `typing` imports are dropped:
// annotations are TypeScript types only.
import { descriptor } from "../../../../pyrt/index.ts";
import { OpenExrCompression } from "../../../enums/index.ts";
import { ChunkField } from "../../descriptors.ts";
import { validate_positive_number } from "../../validators.ts";
import { FormatOptionsBase } from "./base.ts";
import type { OpenExrRoptChunk } from "../../../binary/render_chunks.ts";

/**
 * OpenEXR format-specific render options.
 *
 * These settings correspond to the OpenEXR Options dialog in After Effects,
 * accessible when the output format is set to OpenEXR or OpenEXR Sequence.
 *
 * @example
 * ```ts
 * import { OpenExrFormatOptions, parse } from "@bevyl-ai/ts-aep";
 *
 * const app = parse("project.aep");
 * const om = app.project.render_queue.items[0].output_modules[0];
 * if (om.format_options instanceof OpenExrFormatOptions) {
 *   console.log(om.format_options.compression);
 * }
 * ```
 */
export class OpenExrFormatOptions extends FormatOptionsBase {
  declare _body: OpenExrRoptChunk;

  /**
   * The compression method. Corresponds to the `Compression` dropdown
   * in the OpenEXR Options dialog. An out-of-enum stored value reads
   * back as a raw integer (the binary is trusted). Read / Write.
   */
  declare compression: OpenExrCompression | number;

  /**
   * Whether Luminance/Chroma encoding is enabled. Corresponds to the
   * `Luminance/Chroma` checkbox in the OpenEXR Options dialog.
   * Not applicable when compression is DWAA or DWAB. Read / Write.
   */
  declare luminance_chroma: boolean;

  /**
   * Whether 32-bit float output is used instead of the default 16-bit
   * half float. Corresponds to the `32-bit float (not recommended)`
   * checkbox in the OpenEXR Options dialog. Read / Write.
   */
  declare thirty_two_bit_float: boolean;

  constructor(kw: { _body: OpenExrRoptChunk }) {
    super();
    const { _body } = kw;
    this._body = _body;
  }

  /**
   * The DWA compression level. Only meaningful when `compression` is
   * `OpenExrCompression.DWAA` or `OpenExrCompression.DWAB`.
   * Stored as a little-endian `f4` in the Ropt body. Defaults to
   * `45.0`. Read / Write.
   */
  get dwa_compression_level(): number | null {
    if (this.compression === OpenExrCompression.DWAA || this.compression === OpenExrCompression.DWAB) {
      return this._body.dwa_compression_level;
    }
    return null;
  }

  set dwa_compression_level(value: number) {
    validate_positive_number(value);
    this._body.dwa_compression_level = value;
  }
}

descriptor(
  OpenExrFormatOptions,
  "compression",
  ChunkField.enum(OpenExrCompression, "_body", "compression", { allow_out_of_enum_values: true }),
);

descriptor(OpenExrFormatOptions, "luminance_chroma", ChunkField.bool("_body", "luminance_chroma"));

descriptor(OpenExrFormatOptions, "thirty_two_bit_float", ChunkField.bool("_body", "thirty_two_bit_float"));
