// `from __future__ import annotations` and the `typing` imports are dropped:
// annotations are TypeScript types only.
import { descriptor } from "../../../../pyrt/index.ts";
import { ChunkField } from "../../descriptors.ts";
import { validate_one_of } from "../../validators.ts";
import { FormatOptionsBase } from "./base.ts";
import type { RoptChunk } from "../../../binary/render_chunks.ts";

/**
 * Targa (TGA) format-specific render options.
 *
 * These settings correspond to the Targa Options dialog in After Effects,
 * accessible when the output format is set to Targa Sequence.
 *
 * Example:
 *     ```python
 *     from py_aep import TargaFormatOptions, parse
 *
 *     app = parse("project.aep")
 *     om = app.project.render_queue.items[0].output_modules[0]
 *     if isinstance(om.format_options, TargaFormatOptions):
 *         print(om.format_options.bits_per_pixel)
 *     ```
 */
export class TargaFormatOptions extends FormatOptionsBase {
  declare _body: RoptChunk;

  constructor(kw: { _body: RoptChunk }) {
    super();
    const { _body } = kw;
    this._body = _body;
  }

  /**
   * Color depth in bits per pixel (24 or 32). Read / Write.
   *
   * Not coupled to the module's `Channels` setting in the binary: AE
   * only rewrites this byte when the Targa Options dialog is visited,
   * so AE-saved files hold RGB with 32 bpp and RGB+Alpha with 24 bpp.
   * This value, not the module's `Depth`, decides the rendered file: AE
   * 2026 renders a 32-bpp TGA with 8 alpha bits for an RGB module whose
   * value is 32, and a 24-bpp TGA once it is 24.
   */
  declare bits_per_pixel: number;

  /** Whether RLE compression is enabled. Read / Write. */
  declare rle_compression: boolean;
}

descriptor(
  TargaFormatOptions,
  "bits_per_pixel",
  new ChunkField<number>("_body", "bits_per_pixel", { validate: validate_one_of([24, 32]) }),
);
descriptor(TargaFormatOptions, "rle_compression", ChunkField.bool("_body", "rle_compression"));
