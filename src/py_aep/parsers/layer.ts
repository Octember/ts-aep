import { getitem, KeyError, warn } from "../../pyrt/index.ts";
import type { Chunk, ListChunk } from "../binary/chunk.ts";
import type { CmtaChunk } from "../binary/item_chunks.ts";
import { ChunkNotFoundError, filter_by_list_type, filter_by_type, find_by_list_type, find_by_type } from "../binary/utils.ts";
import { LayerType } from "../enums/index.ts";
import { _suppress_materialization } from "../models/descriptors.ts";
import { AVLayer } from "../models/layers/av_layer.ts";
import { CameraLayer } from "../models/layers/camera_layer.ts";
import { LightLayer } from "../models/layers/light_layer.ts";
import { ParametricMeshLayer } from "../models/layers/parametric_mesh_layer.ts";
import { ShapeLayer } from "../models/layers/shape_layer.ts";
import { TextLayer } from "../models/layers/text_layer.ts";
import { ThreeDModelLayer } from "../models/layers/three_d_model_layer.ts";
import { synthesize_layer_properties } from "../synthesis/core.ts";
import { parse_properties } from "./property.ts";
import { get_match_name_runs } from "./utils.ts";
import type { CompItem } from "../models/items/composition.ts";
import type { Layer } from "../models/layers/layer.ts";

// NOTE(port): eager module-level table exactly as in Python; the ESM import order (tests and py_aep/index.ts load the models first) keeps the layer classes out of the TDZ.
export const _LAYER_CLASSES: Map<number, typeof Layer> = new Map<number, typeof Layer>([
  [LayerType.AV, AVLayer],
  [LayerType.LIGHT, LightLayer],
  [LayerType.CAMERA, CameraLayer],
  [LayerType.TEXT, TextLayer],
  [LayerType.SHAPE, ShapeLayer],
  [LayerType.THREE_D_MODEL, ThreeDModelLayer],
  [LayerType.PARAMETRIC_MESH, ParametricMeshLayer],
] as Array<[number, typeof Layer]>);

/**
 * Extract Essential Properties override UUIDs from LIST:OvG2 chunks.
 *
 * @param tdgp_chunks - The children of the layer's root `tdgp` group, where `LIST:OvG2` is a direct
 *   child (beside the "ADBE Layer Overrides" marker). NOT the layer LIST's own children - `OvG2`
 *   sits one level deeper than that.
 * @returns A list of controller UUID strings from the OvG2/CPrp/Utf8 entries; each matches an
 *   `EssentialGraphicsController.uuid` on the source comp.
 */
export function _parse_ovg2_uuids(tdgp_chunks: Chunk[]): string[] {
  const uuids: string[] = [];
  for (const ovg2_list of filter_by_list_type(tdgp_chunks, "OvG2")) {
    for (const cprp of filter_by_list_type(ovg2_list.chunks, "CPrp")) {
      const utf8_chunks = filter_by_type(cprp.chunks, "Utf8");
      if (utf8_chunks?.length > 0) {
        uuids.push(utf8_chunks[0].value);
      }
    }
  }
  return uuids;
}

/**
 * Parse a composition layer.
 *
 * This layer is an instance of an item in a composition. Some information can
 * only be found on the source item. To access it, use `source_item = layer.source`.
 *
 * @param layer_chunk - The LIST chunk to parse.
 * @param composition - The composition.
 * @param effect_param_defs - Project-level effect parameter definitions, used as fallback when
 *   layer-level parT chunks are missing.
 * @returns An {@link AVLayer} for most layers, a {@link LightLayer} for light layers, or a
 *   {@link ParametricMeshLayer} for parametric mesh layers.
 */
export const parse_layer = _suppress_materialization().decorate(function parse_layer(
  layer_chunk: ListChunk,
  composition: CompItem,
  effect_param_defs: Map<string, Map<string, Map<string, unknown>>>,
): Layer {
  const child_chunks = layer_chunk.chunks;

  let cmta: CmtaChunk | null;
  try {
    cmta = find_by_type(child_chunks, "cmta");
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    cmta = null;
  }

  const ldta = find_by_type(child_chunks, "ldta");
  const name_utf8 = find_by_type(child_chunks, "Utf8");

  const layer_type = ldta.layer_type;

  let layer_cls: typeof Layer;
  try {
    layer_cls = getitem(_LAYER_CLASSES, layer_type);
  } catch (e) {
    if (!(e instanceof KeyError)) throw e;
    // NOTE(port): Python passes stacklevel=2; pyrt warn() only records the message, which is all that is observable.
    warn(`Failed to create layer type ${layer_type}, falling back to AVLayer`);
    layer_cls = AVLayer;
  }

  // OvG2 (Essential Properties overrides) is a direct child of the layer's
  // root tdgp, not of the layer LIST itself, so resolve the root tdgp first.
  const root_tdgp_chunk = find_by_list_type(child_chunks, "tdgp");

  const layer = new layer_cls({
    _ldta: ldta,
    _cmta: cmta,
    _name_utf8: name_utf8,
    _layer_list: layer_chunk,
    containing_comp: composition,
    properties: [],
    essential_property_uuids: _parse_ovg2_uuids(root_tdgp_chunk.chunks),
  });

  const properties = parse_properties(
    get_match_name_runs(root_tdgp_chunk),
    1,
    effect_param_defs,
    composition,
    layer,
  );

  layer._properties = properties;
  layer._tdgp = root_tdgp_chunk;
  for (const child of properties) {
    child._parent_property = layer;
  }

  synthesize_layer_properties(layer);
  return layer;
});
