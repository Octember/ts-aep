// `from __future__ import annotations` and the `typing` imports are dropped:
// annotations are TypeScript types only.
import { descriptor } from "../../../../pyrt/index.ts";
import { CineonFileFormat } from "../../../enums/index.ts";
import { ChunkField } from "../../descriptors.ts";
import { _validate_number, validate_one_of, validate_u2 } from "../../validators.ts";
import { FormatOptionsBase } from "./base.ts";
import type { RoptChunk } from "../../../binary/render_chunks.ts";

/**
 * Cineon/DPX format-specific render options.
 *
 * These settings correspond to the Cineon Settings dialog in After Effects,
 * accessible when the output format is set to Cineon Sequence or DPX
 * Sequence.
 *
 * @example
 * ```ts
 * import { CineonFormatOptions, parse } from "@bevyl-ai/ts-aep";
 *
 * const app = parse("project.aep");
 * const om = app.project.render_queue.items[0].output_modules[0];
 * if (om.format_options instanceof CineonFormatOptions) {
 *   console.log(om.format_options.file_format);
 * }
 * ```
 */
export class CineonFormatOptions extends FormatOptionsBase {
  declare _body: RoptChunk;

  constructor(kw: { _body: RoptChunk }) {
    super();
    const { _body } = kw;
    this._body = _body;
  }

  /**
   * The 10-bit black point value (0-1023). Defines the code value that
   * maps to the black point on a logarithmic scale. Read / Write.
   */
  declare ten_bit_black_point: number;

  /**
   * The 10-bit white point value (0-1023). Defines the code value that
   * maps to the white point on a logarithmic scale. Read / Write.
   */
  declare ten_bit_white_point: number;

  /**
   * The converted black point value, normalized to the 0.0-1.0 range.
   * This is the linear-light equivalent of the 10-bit black point. Read / Write.
   */
  declare converted_black_point: number;

  /**
   * The converted white point value, normalized to the 0.0-1.0 range.
   * This is the linear-light equivalent of the 10-bit white point. Read / Write.
   */
  declare converted_white_point: number;

  /** The gamma value applied during the Cineon/DPX conversion. Read / Write. */
  declare current_gamma: number;

  /** The highlight expansion value. Read / Write. */
  declare highlight_expansion: number;

  /** Whether logarithmic conversion is enabled. Read / Write. */
  declare logarithmic_conversion: boolean;

  /**
   * The file format for the Cineon output. See {@link CineonFileFormat} for
   * possible values. An out-of-enum stored value reads back as a raw
   * `number` (the binary is trusted). Read / Write.
   */
  declare file_format: CineonFileFormat | number;

  /**
   * The bit depth per channel (8, 10, 12, or 16). Read / Write.
   *
   * Only meaningful when `file_format` is `CineonFileFormat.DPX`. For
   * FIDO/Cineon 4.5 the output is always 10-bit and AE hides the Bit
   * Depth dropdown; the stored byte is inert and keeps whatever the last
   * DPX selection was (AE-observed), so reads may return a stale value.
   */
  declare bit_depth: number;
}

descriptor(
  CineonFormatOptions,
  "ten_bit_black_point",
  new ChunkField<number>("_body", "ten_bit_black_point", {
    validate: _validate_number({ min: 0, max: 1023, integer: true }),
  }),
);

descriptor(
  CineonFormatOptions,
  "ten_bit_white_point",
  new ChunkField<number>("_body", "ten_bit_white_point", {
    validate: _validate_number({ min: 0, max: 1023, integer: true }),
  }),
);

descriptor(
  CineonFormatOptions,
  "converted_black_point",
  new ChunkField<number>("_body", "converted_black_point", {
    validate: _validate_number(),
  }),
);

descriptor(
  CineonFormatOptions,
  "converted_white_point",
  new ChunkField<number>("_body", "converted_white_point", {
    validate: _validate_number(),
  }),
);

descriptor(
  CineonFormatOptions,
  "current_gamma",
  new ChunkField<number>("_body", "current_gamma", {
    validate: _validate_number(),
  }),
);

descriptor(
  CineonFormatOptions,
  "highlight_expansion",
  // Backed by a u2 field: an out-of-range value overflows `struct`
  // and crashes save() mid-write, leaving a partial .aep on disk.
  new ChunkField<number>("_body", "highlight_expansion", { validate: validate_u2 }),
);

descriptor(
  CineonFormatOptions,
  "logarithmic_conversion",
  ChunkField.bool("_body", "logarithmic_conversion"),
);

descriptor(
  CineonFormatOptions,
  "file_format",
  ChunkField.enum<CineonFileFormat | number>(CineonFileFormat, "_body", "file_format", {
    allow_out_of_enum_values: true,
  }),
);

descriptor(
  CineonFormatOptions,
  "bit_depth",
  new ChunkField<number>("_body", "bit_depth", {
    validate: validate_one_of([8, 10, 12, 16]),
  }),
);
