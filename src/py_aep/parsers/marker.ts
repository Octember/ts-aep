/**
 * Marker parsing functions.
 *
 * Extracts composition and layer markers from MRST / Nmrd chunks.
 */

import type { ListChunk } from "../binary/chunk.ts";
import type { TdmnChunk } from "../binary/property_chunks.ts";
import type { NmhdChunk } from "../binary/misc_chunks.ts";
import type { Utf8Chunk } from "../binary/scalar_chunks.ts";
import {
  filter_by_list_type,
  filter_by_type,
  find_by_list_type,
  find_by_type,
} from "../binary/utils.ts";
import { PropertyValueType } from "../enums/index.ts";
import { MarkerValue } from "../models/properties/marker.ts";
import type { Property } from "../models/properties/property.ts";
import type { CompItem } from "../models/items/composition.ts";
import type { Keyframe } from "../models/properties/keyframe.ts";
import { parse_property } from "./property_value.ts";
import { at, enumerate } from "../../pyrt/index.ts";

/**
 * Parse markers from an MRST chunk.
 *
 * Returns the underlying [Property][] (the `tdbs` inside the
 * `mrst` chunk, with keyframes holding marker values).
 *
 * Args:
 *     mrst_chunk: The MRST chunk to parse.
 *     composition: The parent composition.
 *     property_depth: The nesting depth of this property (default 1).
 */
export function parse_markers(
  mrst_chunk: ListChunk,
  composition: CompItem,
  property_depth: number,
  tdmn: TdmnChunk,
): Property {
  const tdbs_chunk = find_by_list_type(mrst_chunk.chunks, "tdbs");
  const marker_prop = parse_property(
    tdbs_chunk,
    "ADBE Marker",
    composition,
    property_depth,
    tdmn,
  );
  marker_prop._wrapper = mrst_chunk;
  // ExtendScript reports MARKER (6420); the tdb4 flags alone would fall
  // back to OneD like any 1-D scalar.
  marker_prop._property_value_type = PropertyValueType.MARKER;
  const mrky_chunk = find_by_list_type(mrst_chunk.chunks, "mrky");
  marker_prop._kf_value_container = mrky_chunk;
  const nmrd_chunks = filter_by_list_type(mrky_chunk.chunks, "Nmrd");
  for (const [i, nmrd_chunk] of enumerate(nmrd_chunks)) {
    const kf = at(marker_prop.keyframes, i);
    kf._cache_value(
      parse_marker(
        nmrd_chunk,
        kf,
      ),
    );
  }
  return marker_prop;
}

/**
 * Parse a marker.
 *
 * Args:
 *     nmrd_chunk: The NMRD chunk to parse.
 *     keyframe: The keyframe that holds this marker value.
 *     frame_time: Fallback time in frames (used when no keyframe ref).
 */
export function parse_marker(
  nmrd_chunk: ListChunk,
  keyframe: Keyframe | null = null,
  frame_time = 0,
): MarkerValue {
  const nmhd_chunk = find_by_type(nmrd_chunk.chunks, "NmHd") as NmhdChunk;

  const utf8_chunks = filter_by_type(nmrd_chunk.chunks, "Utf8") as Utf8Chunk[];

  // Collect cue point param Utf8 chunks
  const param_utf8s: Utf8Chunk[] = utf8_chunks.slice(5);

  return MarkerValue._from_binary({
    _nmhd: nmhd_chunk,
    _comment_utf8: at(utf8_chunks, 0),
    _chapter_utf8: at(utf8_chunks, 1),
    _url_utf8: at(utf8_chunks, 2),
    _frame_target_utf8: at(utf8_chunks, 3),
    _cue_point_name_utf8: at(utf8_chunks, 4),
    _keyframe: keyframe,
    frame_time,
    _param_utf8s: param_utf8s,
    _nmrd: nmrd_chunk,
  });
}
