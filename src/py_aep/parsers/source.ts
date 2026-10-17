import { find_by_list_type_or_null, find_by_type, find_by_type_or_null } from "../binary/utils.ts";
import { FileSource } from "../models/sources/file.ts";
import { PlaceholderSource } from "../models/sources/placeholder.ts";
import { SolidSource } from "../models/sources/solid.ts";
import { getattr, hasattr, py_bool } from "../../pyrt/index.ts";
import type { ListChunk } from "../binary/chunk.ts";

/**
 * Parse a `LIST:Pin` chunk into a footage source.
 *
 * @param pin_chunk - A `LIST:Pin` chunk containing sspc + opti sub-chunks.
 */
export function parse_source(
  pin_chunk: ListChunk,
): FileSource | SolidSource | PlaceholderSource {
  const pin_child_chunks = pin_chunk.chunks;
  const sspc_chunk = find_by_type(pin_child_chunks, "sspc");
  const opti_chunk = find_by_type(pin_child_chunks, "opti");

  const clrs = find_by_list_type_or_null(pin_child_chunks, "CLRS");
  const linl = clrs === null ? null : find_by_type_or_null(clrs.chunks, "linl");

  const asset_type = getattr(opti_chunk, "asset_type", "");

  if (!py_bool(asset_type) && hasattr(opti_chunk, "placeholder_name")) {
    return new PlaceholderSource({
      _sspc: sspc_chunk,
      _opti: opti_chunk,
      _clrs: clrs,
      _linl: linl,
    });
  }
  if (asset_type.startsWith("Soli")) {
    return new SolidSource({ _sspc: sspc_chunk, _opti: opti_chunk, _clrs: clrs, _linl: linl });
  }
  return new FileSource({
    _pin: pin_chunk,
    _sspc: sspc_chunk,
    _opti: opti_chunk,
    _linl: linl,
    _clrs: clrs,
  });
}
