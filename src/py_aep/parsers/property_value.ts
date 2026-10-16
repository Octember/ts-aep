/** Core single-property parsing and keyframe extraction. */

import { warn } from "../../pyrt/index.ts";
import type { Chunk, ListChunk } from "../binary/chunk.ts";
import type { LdatChunk } from "../binary/ldat_chunks.ts";
import type { CdatChunk, Tdb4Chunk, TdmnChunk, TdsbChunk, TdsnChunk, TdumChunk } from "../binary/property_chunks.ts";
import type { S4Chunk, Utf8Chunk } from "../binary/scalar_chunks.ts";
import { ChunkNotFoundError, find_by_list_type, find_by_type } from "../binary/utils.ts";
import { _suppress_materialization } from "../models/descriptors.ts";
import { Keyframe } from "../models/properties/keyframe.ts";
import { Property } from "../models/properties/property.ts";
import type { CompItem } from "../models/items/composition.ts";

const logger = {
  debug() {},
  info() {},
  warning: (m: string) => warn(m),
};

/**
 * Parse a property.
 *
 * Args:
 *     tdbs_chunk: The TDBS chunk to parse.
 *     match_name: A special name for the property used to build unique
 *         naming paths. The match name is not displayed, but you can refer
 *         to it in scripts. Every property has a unique match-name
 *         identifier. Match names are stable from version to version
 *         regardless of the display name (the name attribute value) or any
 *         changes to the application. Unlike the display name, it is not
 *         localized.
 *     composition: The parent composition.
 *     property_depth: The nesting depth of this property (0 = layer level).
 */
export const parse_property = _suppress_materialization().decorate(function parse_property(
  tdbs_chunk: ListChunk,
  match_name: string,
  composition: CompItem,
  property_depth: number,
  tdmn: TdmnChunk,
): Property {
  const tdbs_child_chunks = tdbs_chunk.chunks;

  const tdsb_chunk = find_by_type(tdbs_child_chunks, "tdsb") as TdsbChunk;

  const tdb4_chunk = find_by_type(tdbs_child_chunks, "tdb4") as Tdb4Chunk;

  let cdat: CdatChunk | null;
  try {
    cdat = find_by_type(tdbs_child_chunks, "cdat") as CdatChunk;
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    cdat = null;
  }

  // Static value is read lazily by Property.value from _cdat via
  // _resolve_value.  Only extract here for non-cdat overrides.
  let value: any = null;

  // For LAYER control properties, keep the tdpi chunk reference so the
  // layer index can be resolved lazily (it changes on layer reorder).
  // tdli stores the 1-based mask index directly and is stable.
  let tdpi: S4Chunk | null = null;
  try {
    tdpi = find_by_type(tdbs_child_chunks, "tdpi") as S4Chunk;
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
  }
  try {
    value = (find_by_type(tdbs_child_chunks, "tdli") as S4Chunk).value;
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
  }

  let expression_utf8: Utf8Chunk | null;
  try {
    expression_utf8 = find_by_type(tdbs_child_chunks, "Utf8") as Utf8Chunk;
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    expression_utf8 = null;
  }

  let tdum: TdumChunk | null;
  try {
    tdum = find_by_type(tdbs_child_chunks, "tdum") as TdumChunk;
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    tdum = null;
  }
  let tduM: TdumChunk | null;
  try {
    tduM = find_by_type(tdbs_child_chunks, "tduM") as TdumChunk;
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    tduM = null;
  }

  const keyframes = _parse_keyframes(tdbs_child_chunks, composition.frame_rate);

  // Resolve _name_utf8 from the LIST:tdbs tdsn child.
  const tdsn = find_by_type(tdbs_child_chunks, "tdsn") as TdsnChunk;
  const name_utf8 = tdsn.utf8;

  const prop = new Property({
    _tdmn: tdmn,
    _tdsb: tdsb_chunk,
    _tdb4: tdb4_chunk,
    _expression_utf8: expression_utf8,
    _name_utf8: name_utf8,
    _tdbs: tdbs_chunk,
    _tdum: tdum,
    _tduM: tduM,
    _cdat: cdat,
    _tdpi: tdpi,
    _composition: composition,
    match_name,
    property_depth,
    keyframes,
    value,
  });

  return prop;
});

/**
 * Parse keyframes from a property's child chunks.
 *
 * Args:
 *     tdbs_child_chunks: The child chunks of the TDBS chunk.
 *     frame_rate: The frame rate of the parent composition.
 */
function _parse_keyframes(tdbs_child_chunks: Chunk[], frame_rate: number): Keyframe[] {
  let list_chunk: ListChunk;
  try {
    list_chunk = find_by_list_type(tdbs_child_chunks, "list");
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    return [];
  }

  let ldat: LdatChunk;
  try {
    ldat = find_by_type(list_chunk.chunks, "ldat") as LdatChunk;
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    return [];
  }

  const kf_items = ldat.items;

  return kf_items.map((kf) => new Keyframe({ _ldat_item: kf, _frame_rate: frame_rate }));
}
