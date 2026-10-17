// `from __future__ import annotations` and the `typing` imports are dropped:
// annotations are TypeScript types only.
import { descriptor } from "../../../../pyrt/index.ts";
import { ChunkField } from "../../descriptors.ts";
import { FormatOptionsBase } from "./base.ts";
import type { RoptChunk } from "../../../binary/render_chunks.ts";

/**
 * TIFF format-specific render options.
 *
 * These settings correspond to the TIFF Options dialog in After Effects,
 * accessible when the output format is set to TIFF Sequence.
 *
 * @example
 * ```python
 * from py_aep import TiffFormatOptions, parse
 *
 * app = parse("project.aep")
 * om = app.project.render_queue.items[0].output_modules[0]
 * if isinstance(om.format_options, TiffFormatOptions):
 *     print(om.format_options.lzw_compression)
 * ```
 */
export class TiffFormatOptions extends FormatOptionsBase {
  declare _body: RoptChunk;

  constructor(kw: { _body: RoptChunk }) {
    super();
    const { _body } = kw;
    this._body = _body;
  }

  /** Whether LZW compression is enabled. Read / Write. */
  declare lzw_compression: boolean;

  /** Whether IBM PC byte order (little-endian) is used. Read / Write. */
  declare ibm_pc_byte_order: boolean;
}

descriptor(TiffFormatOptions, "lzw_compression", ChunkField.bool("_body", "lzw_compression"));

descriptor(TiffFormatOptions, "ibm_pc_byte_order", ChunkField.bool("_body", "ibm_pc_byte_order"));
