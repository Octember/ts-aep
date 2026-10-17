import type { AsciiChunk } from "../binary/scalar_chunks.ts";
import { ChunkNotFoundError, filter_by_type, find_by_type, group_chunks } from "../binary/utils.ts";
import { AVItem } from "../models/items/av_item.ts";
import { View } from "../models/viewer/view.ts";
import { ViewOptions } from "../models/viewer/view_options.ts";
import { Viewer } from "../models/viewer/viewer.ts";
import type { Chunk } from "../binary/chunk.ts";
import type { Item } from "../models/items/item.ts";

/**
 * Parse viewer panels from folder-level chunks.
 *
 * Each item in the folder is followed by a viewer block bounded by
 * `fvdv` (start) and `fifl` (end).  The Nth viewer block belongs to the
 * Nth item in the folder.
 *
 * Viewer objects (panel state) are only created when a `fitt` chunk is
 * present (open panel). Views (from `fips` chunks) are assigned to the
 * viewer, and the viewer is linked back to AVItems for OutputModule ROI.
 *
 * @param folder_chunks - Chunks from a `LIST:Fold` or `LIST:Sfdr` body.
 * @param items - Ordered list of items in this folder, used to resolve each viewer block to its
 *   item.
 * @returns A list of parsed {@link Viewer | Viewer} objects.
 */
export function parse_viewers(folder_chunks: Chunk[], items: Item[]): Viewer[] {
  const blocks = group_chunks(folder_chunks, "fvdv", "fifl");
  const viewers: Viewer[] = [];
  for (const [i, block] of blocks.entries()) {
    const item = i < items.length ? items[i] : null;
    const viewer = _build_viewer(block);
    if (viewer != null) {
      viewer._views = _parse_views(block, item, viewer);
      if (item instanceof AVItem) item._viewer = viewer;
      viewers.push(viewer);
    }
  }
  return viewers;
}

/**
 * Parse view objects from a viewer block.
 *
 * Each locked view has 4 viewport slots (fips chunks) for the 3D
 * viewport layout. One View is created per locked view, using the
 * first viewport slot's options.
 *
 * @param block - The sequence of chunks from `fvdv` to `fifl`.
 * @param item - The item this viewer belongs to (for ROI validation).
 * @param viewer - The parent viewer that owns these views.
 * @returns A list of {@link View | View} objects.
 */
export function _parse_views(block: Chunk[], item: Item | null, viewer: Viewer): View[] {
  const fips_chunks = filter_by_type(block, "fips");
  const av_item = item instanceof AVItem ? item : null;
  // Each locked view owns 4 consecutive fips (3D viewport slots).
  // Create one View per group of 4, using the first slot.
  const views: View[] = [];
  for (let i = 0; i < fips_chunks.length; i += 4) {
    const fips = fips_chunks[i];
    views.push(
      new View({
        _viewer: viewer,
        options: new ViewOptions({ _fips: fips, _item: av_item }),
      }),
    );
  }
  return views;
}

/**
 * Build a Viewer from a block of folder-level chunks.
 *
 * A Viewer represents an open panel.  Blocks without a `fitt` chunk
 * have no open panel and return `null`.
 *
 * @param block - The sequence of chunks from `fvdv` to `fifl`.
 * @returns A {@link Viewer | Viewer} instance, or `null` if the block
 *   does not contain a recognised viewer type.
 */
export function _build_viewer(block: Chunk[]): Viewer | null {
  let fitt: AsciiChunk;
  try {
    fitt = find_by_type(block, "fitt");
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    return null;
  }

  const foac = find_by_type(block, "foac");
  const fiac = find_by_type(block, "fiac");

  return new Viewer({
    _fitt: fitt,
    _foac: foac,
    _fiac: fiac,
  });
}
