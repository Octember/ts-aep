import type { Chunk, ListChunk } from "../binary/chunk.ts";
import type { CmtaChunk, IdtaChunk } from "../binary/item_chunks.ts";
import type { Utf8Chunk } from "../binary/scalar_chunks.ts";
import { filter_by_list_type, find_by_list_type } from "../binary/utils.ts";
import { CompItem } from "../models/items/composition.ts";
import type { FolderItem } from "../models/items/folder.ts";
import type { Project } from "../models/project.ts";
import type { Property } from "../models/properties/property.ts";
import type { ParamDef } from "./effect.ts";
import { parse_layer } from "./layer.ts";
import { parse_source } from "./source.ts";

/**
 * Parse a composition item.
 *
 * @param child_chunks - child chunks of the composition LIST chunk.
 * @param _idta - The idta chunk.
 * @param _name_utf8 - The Utf8 chunk containing the composition name.
 * @param _cmta - The cmta chunk (null if no comment).
 * @param _item_list - The LIST chunk for creating new chunks.
 * @param _gide - The LIST chunk for guides (null if no guides).
 * @param project - The project.
 * @param parent_folder - The composition's parent folder.
 * @param effect_param_defs - Project-level effect parameter definitions, used as fallback when
 *   layer-level parT chunks are missing.
 */
export function parse_composition(
  child_chunks: Chunk[],
  _idta: IdtaChunk,
  _name_utf8: Utf8Chunk,
  _cmta: CmtaChunk | null,
  _item_list: ListChunk,
  _gide: ListChunk | null,
  project: Project,
  parent_folder: FolderItem,
  effect_param_defs: Map<string, Map<string, ParamDef>>,
): CompItem {
  const pin_chunks = filter_by_list_type(child_chunks, "Pin ");
  const proxy_source = pin_chunks?.length > 0 ? parse_source(pin_chunks[0]) : null;

  return new CompItem({
    _child_chunks: child_chunks,
    _cmta,
    _idta,
    _item_list,
    _gide,
    _pin_chunks: pin_chunks,
    _name_utf8,
    project,
    parent_folder,
    effect_param_defs,
    proxy_source,
  });
}

/**
 * Get the composition markers.
 *
 * Marker keyframe times in the binary format are stored in absolute
 * composition time (not relative to the SecL layer's start time).
 *
 * @param child_chunks - child chunks of the composition LIST chunk.
 * @param composition - The parent composition.
 */
export function _get_markers(child_chunks: Chunk[], composition: CompItem): Property | null {
  const markers_layer_chunk = find_by_list_type(child_chunks, "SecL");
  const markers_layer = parse_layer(markers_layer_chunk, composition, new Map());
  if (markers_layer.marker == null) return null;

  return markers_layer.marker;
}
