import type { OptiChunk, SspcChunk } from "../binary/footage_chunks.ts";
import type { U1Chunk } from "../binary/scalar_chunks.ts";
import { ChunkNotFoundError, find_by_list_type, find_by_type } from "../binary/utils.ts";
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
  const sspc_chunk = find_by_type(pin_child_chunks, "sspc") as SspcChunk;
  const opti_chunk = find_by_type(pin_child_chunks, "opti") as OptiChunk;

  let clrs: ListChunk | null;
  let linl: U1Chunk | null;
  try {
    clrs = find_by_list_type(pin_child_chunks, "CLRS");
    try {
      linl = find_by_type(clrs.chunks, "linl") as U1Chunk;
    } catch (e) {
      if (!(e instanceof ChunkNotFoundError)) throw e;
      linl = null;
    }
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    clrs = null;
    linl = null;
  }

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
