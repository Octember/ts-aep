import type { Utf8Chunk } from "../binary/scalar_chunks.ts";
import { ChunkNotFoundError, filter_by_type, find_by_list_type, find_by_type } from "../binary/utils.ts";
import { _suppress_materialization } from "../models/descriptors.ts";
import { OutputModule } from "../models/renderqueue/output_module.ts";
import type { RenderQueueItem } from "../models/renderqueue/render_queue_item.ts";
import { parse_format_options } from "./format_options.ts";
import type { Chunk } from "../binary/chunk.ts";
import type { OutputModuleSettingsItem } from "../binary/render_chunks.ts";

/**
 * Parse an output module from its chunk group.
 *
 * Each output module consists of:
 * - Roou: Output options (binary data)
 * - Ropt: Render options (binary data)
 * - hdrm: HDR metadata (optional)
 * - Utf8: HDR10 / color metadata JSON (optional, only when hdrm present)
 * - LIST Als2: Output file path info (only once an output file is set;
 *   a freshly added module has none)
 *   - alas: JSON with fullpath and target_is_folder
 * - Utf8: Template/format name (e.g., "H.264 - Match Render Settings - 15 Mbps")
 * - Utf8: File name template (e.g., "[compName].[fileextension]" or "output.mp4")
 *
 * The format name and file-name template are always the last two top-level
 * `Utf8` chunks (the optional HDR-metadata `Utf8` precedes them, and the
 * `alas` lives inside the `Als2` LIST), so they are located by position
 * rather than relative to `Als2` - which may be absent.
 *
 * @param chunks - List of chunks belonging to this output module.
 * @param om_ldat_data - Parsed OutputModuleSettingsItem from LdatItem.
 * @param render_queue_item - The parent render queue item.
 * @returns OutputModule with parsed attributes.
 */
export const parse_output_module = _suppress_materialization().decorate(
  function parse_output_module(
    chunks: Chunk[],
    om_ldat_data: OutputModuleSettingsItem,
    render_queue_item: RenderQueueItem,
  ): OutputModule {
    const roou_chunk = find_by_type(chunks, "Roou");

    // The alas (output file path) is present only once a file is set.
    let alas_utf8: Utf8Chunk | null;
    try {
      const als2_chunk = find_by_list_type(chunks, "Als2");
      alas_utf8 = find_by_type(als2_chunk.chunks, "alas");
    } catch (e) {
      if (!(e instanceof ChunkNotFoundError)) throw e;
      alas_utf8 = null;
    }

    // Format name + file-name template are the last two top-level Utf8 chunks.
    const om_utf8 = filter_by_type(chunks, "Utf8");
    let name_utf8: Utf8Chunk | null;
    let file_name_utf8: Utf8Chunk | null;
    if (om_utf8.length >= 2) {
      name_utf8 = om_utf8.at(-2)!;
      file_name_utf8 = om_utf8.at(-1)!;
    } else {
      name_utf8 = null;
      file_name_utf8 = null;
    }

    const format_options = parse_format_options(chunks);

    return new OutputModule({
      _om_ldat: om_ldat_data,
      _roou: roou_chunk,
      _alas_utf8: alas_utf8,
      _file_name_utf8: file_name_utf8,
      _name_utf8: name_utf8,
      _render_settings_ldat: render_queue_item._ldat,
      parent: render_queue_item,
      format_options: format_options,
    });
  },
);
