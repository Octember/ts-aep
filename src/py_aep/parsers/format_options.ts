/** Parsers for format-specific render options (Ropt chunk). */

import type { Chunk } from "../binary/chunk.ts";
import type { OpenExrRoptChunk, PngRoptChunk } from "../binary/render_chunks.ts";
import { find_by_type_or_null } from "../binary/utils.ts";
import { CineonFormatOptions, JpegFormatOptions, OpenExrFormatOptions, PngFormatOptions, TargaFormatOptions, TiffFormatOptions, XmlFormatOptions } from "../models/renderqueue/format_options/index.ts";

export type FormatOptions =
  | CineonFormatOptions
  | JpegFormatOptions
  | OpenExrFormatOptions
  | PngFormatOptions
  | TargaFormatOptions
  | TiffFormatOptions
  | XmlFormatOptions;

// Format codes that use XML-based PremiereData options
export const _XML_FORMAT_CODES: ReadonlySet<string> = new Set([".AVI", "H264", "Mp3 ", "MooV", "wao_"]);

/**
 * Parse format-specific options from the Ropt chunk, if present.
 *
 * @param chunks - List of chunks belonging to an output module.
 * @returns A format-specific options object, or `null` when the Ropt chunk is absent or the format
 *   is not yet supported.
 */
export function parse_format_options(chunks: Chunk[]): FormatOptions | null {
  const ropt_chunk = find_by_type_or_null(chunks, "Ropt");
  if (ropt_chunk === null) return null;

  const format_code = ropt_chunk.format_code;

  if (format_code === "sDPX") {
    return new CineonFormatOptions({ _body: ropt_chunk });
  }
  if (format_code === "JPEG") {
    return new JpegFormatOptions({ _body: ropt_chunk });
  }
  if (format_code === "TPIC") {
    return new TargaFormatOptions({ _body: ropt_chunk });
  }
  if (format_code === "TIF ") {
    return new TiffFormatOptions({ _body: ropt_chunk });
  }
  if (format_code === "oEXR") {
    return new OpenExrFormatOptions({ _body: ropt_chunk as OpenExrRoptChunk });
  }
  if (format_code === "png!") {
    const hdr10_utf8 = find_by_type_or_null(chunks, "Utf8");
    return new PngFormatOptions({
      _body: ropt_chunk as PngRoptChunk,
      _hdr10_utf8: hdr10_utf8,
    });
  }
  if (_XML_FORMAT_CODES.has(format_code)) {
    return new XmlFormatOptions({ _body: ropt_chunk });
  }

  return null;
}
