/** Orientation, shape, text document, and gradient property parsers. */

import type { ListChunk } from "../binary/chunk.ts";
import type { LdatChunk } from "../binary/ldat_chunks.ts";
import type { Fth5Chunk, OmtnChunk, ShphChunk } from "../binary/misc_chunks.ts";
import type { CdatChunk, OtdaChunk, TdmnChunk } from "../binary/property_chunks.ts";
import { ChunkNotFoundError, filter_by_list_type, filter_by_type, find_by_list_type, find_by_type } from "../binary/utils.ts";
import { CosParser } from "../cos/index.ts";
// Python's builtin `SyntaxError` as raised by `CosParser`.
import { SyntaxError_ } from "../cos/cos.ts";
import { PropertyValueType } from "../enums/index.ts";
import { ORIENTATION_KIND } from "../models/properties/parallel.ts";
import { FeatherPoint, Shape } from "../models/properties/shape.ts";
import type { Utf8Chunk } from "../binary/scalar_chunks.ts";
import type { CompItem } from "../models/items/composition.ts";
import type { Layer } from "../models/layers/layer.ts";
import type { Property } from "../models/properties/property.ts";
import { parse_gradient_xml } from "./gradient.ts";
import { parse_property } from "./property_value.ts";
import { parse_btdk_cos } from "./text.ts";
import { BytesIO, OverflowError, ValueError, warn, zip, instance_dict } from "../../pyrt/index.ts";

// `logging.getLogger(__name__)`: only the warning path is wired to pyrt `warn`.
export const logger = {
  debug(..._args: any[]) {},
  info(..._args: any[]) {},
  warning: (m: string) => warn(m),
};

export function parse_orientation(
  otst_chunk: ListChunk,
  match_name: string,
  property_depth: number,
  composition: CompItem,
  tdmn: TdmnChunk,
): Property {
  /**
   * Parse an orientation property.
   *
   * @param otst_chunk - The OTST chunk to parse.
   * @param match_name - A special name for the property used to build unique naming paths. The
   *   match name is not displayed, but you can refer to it in scripts. Every property has a unique
   *   match-name identifier. Match names are stable from version to version regardless of the
   *   display name (the name attribute value) or any changes to the application. Unlike the display
   *   name, it is not localized.
   * @param property_depth - The nesting depth of this property (0 = layer level).
   * @param composition - The parent composition.
   */
  const tdbs_chunk = find_by_list_type(otst_chunk.chunks, "tdbs");
  const prop = parse_property(tdbs_chunk, match_name, composition, property_depth, tdmn);
  prop._wrapper = otst_chunk;
  ORIENTATION_KIND.apply_model_metadata(prop);

  // cdat is parameterized with is_le; .value returns the correctly-
  // endian doubles regardless of context.
  try {
    const cdat = find_by_type(tdbs_chunk.chunks, "cdat") as CdatChunk;
    const values = [...cdat.values];
    while (values.length < 3) values.push(0.0);
    prop._cache_value(values.slice(0, 3));
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    prop._cache_value(null);
  }

  // Animated orientation keyframes store their 3-component values in
  // otky > otda chunks (one otda per keyframe), a sibling of tdbs inside
  // otst.  The tdbs items carry ease only and no value at all, so each
  // keyframe's value comes from the otda data instead.
  try {
    const otky_chunk = find_by_list_type(otst_chunk.chunks, "otky");
    prop._kf_value_container = otky_chunk;
    const otda_chunks = filter_by_type(otky_chunk.chunks, "otda") as OtdaChunk[];
    for (const [idx, kf] of prop.keyframes.entries()) {
      if (idx < otda_chunks.length) {
        kf._cache_value([...otda_chunks[idx].values]);
      }
    }
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
  }

  return prop;
}

export function _parse_shape_shap(shap_chunk: ListChunk, layer: Layer | null, mask_path: Property | null): Shape {
  /**
   * Parse a single shape path from a `shap` LIST chunk.
   *
   * Each `shap` LIST contains:
   * - `shph` chunk: shape header with closed flag and bounding box
   * - `list` LIST:  contains `lhd3` (point count/size) and `ldat`
   *   (raw normalized bezier points)
   *
   * Points in `ldat` are stored as `(x, y)` pairs,
   * normalized to the `[0, 1]` range of the bounding box.  Every three
   * consecutive points form a cycle:
   * `vertex, out_tangent, in_tangent_of_next_vertex`.
   *
   * Mask shapes use a normalized `[0, 1]` bounding box, so the
   * resulting coordinates must be scaled by the owning LAYER's source
   * size to get pixel values.  Shape-layer paths already have a pixel
   * bounding box.
   *
   * @param shap_chunk - A `shap` LIST chunk.
   * @param layer - The owning layer, which a mask shape denormalizes against. Only optional because
   *   a shape-layer path does not need one.
   * @param mask_path - The Mask Path property this shape is a value of (its mask's RotoBezier
   *   switch decides the reported tangents), or `None` for a shape-layer path.
   * @returns A {@link Shape} with absolute coordinates and tangent offsets.
   * @throws {@link ValueError} If a mask shape is parsed without its layer, which would silently
   *   yield raw normalized coordinates.
   */
  const is_mask_shape = mask_path != null;
  if (is_mask_shape && layer == null) {
    throw new ValueError("a mask shape must be parsed with its owning layer");
  }
  const shph_chunk = find_by_type(shap_chunk.chunks, "shph") as ShphChunk;
  const list_chunk = find_by_list_type(shap_chunk.chunks, "list");

  // An empty path (no vertices) carries only the lhd3 header, no ldat;
  // treat it as zero points so the value is an empty Shape, not None.
  let points: any[];
  try {
    const ldat = find_by_type(list_chunk.chunks, "ldat") as LdatChunk;
    points = ldat.items;
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    points = [];
  }

  // Extract variable-width mask feather data from fth5 chunk (if present).
  let feather_points: FeatherPoint[];
  try {
    const fth5 = find_by_type(shap_chunk.chunks, "fth5") as Fth5Chunk;
    feather_points = fth5.points.map((pt) => new FeatherPoint({ _fp: pt }));
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    feather_points = [];
  }

  let omtn: OmtnChunk | null;
  try {
    omtn = find_by_type(shap_chunk.chunks, "omtn") as OmtnChunk;
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    omtn = null;
  }

  return Shape._from_binary({
    _shph: shph_chunk,
    _points: points,
    _is_mask: is_mask_shape,
    _layer: is_mask_shape ? layer : null,
    _omtn: omtn,
    _mask_path: mask_path,
    feather_points,
  });
}

export function parse_shape(
  oms_chunk: ListChunk,
  match_name: string,
  property_depth: number,
  composition: CompItem,
  tdmn: TdmnChunk,
  layer: Layer | null = null,
): Property {
  /**
   * Parse a shape/mask-path property from an `om-s` LIST chunk.
   *
   * An `om-s` LIST contains:
   * - `tdbs` LIST: standard property metadata (timing, keyframes, etc.)
   * - `omks` LIST: shape keyframe values (one `shap` per keyframe,
   *   or one `shap` for static shapes)
   *
   * @param oms_chunk - The `om-s` LIST chunk to parse.
   * @param match_name - The property match name.
   * @param property_depth - Nesting depth of this property.
   * @param composition - The parent composition.
   * @param layer - The owning layer, required for a mask path (which denormalizes against the
   *   layer, not the composition).
   * @returns A {@link Property} with `property_value_type` set to
   *   {@link py_aep.enums.PropertyValueType.SHAPE | SHAPE} and `value` set to a {@link Shape}.
   */
  const tdbs_chunk = find_by_list_type(oms_chunk.chunks, "tdbs");
  const prop = parse_property(tdbs_chunk, match_name, composition, property_depth, tdmn);

  prop._wrapper = oms_chunk;
  prop._property_value_type = PropertyValueType.SHAPE;
  // Shape properties always carry a value (from omks), even though
  // tdb4 may report no_value=True (a static shape's cdat is the empty
  // 4-byte form).
  instance_dict(prop).set("_no_value", false);

  // Collect shape values from omks > shap LISTs
  let shape_values: Shape[];
  try {
    const omks_chunk = find_by_list_type(oms_chunk.chunks, "omks");
    prop._kf_value_container = omks_chunk;
    const mask_path = match_name === "ADBE Mask Shape" ? prop : null;
    shape_values = filter_by_list_type(omks_chunk.chunks, "shap").map((shap_chunk) =>
      _parse_shape_shap(shap_chunk, layer, mask_path),
    );
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    logger.debug("Could not parse omks shape data for %s", match_name);
    return prop;
  }

  // Assign static value (first shape).  Set an empty Shape as default
  // so that is_modified detects any real mask path as modified.
  prop.default_value = new Shape(null, null, null, { closed: false });
  if (shape_values.length) {
    prop._cache_value(shape_values[0]);
  }

  for (const [idx, kf] of prop.keyframes.entries()) {
    if (idx < shape_values.length) {
      kf._cache_value(shape_values[idx]);
    }
  }

  return prop;
}

export function parse_text_document(
  btds_chunk: ListChunk,
  match_name: string,
  property_depth: number,
  composition: CompItem,
  tdmn: TdmnChunk,
): Property {
  /**
   * Parse a text document property.
   *
   * @param btds_chunk - The BTDS chunk to parse.
   * @param match_name - A special name for the property used to build unique naming paths. The
   *   match name is not displayed, but you can refer to it in scripts. Every property has a unique
   *   match-name identifier. Match names are stable from version to version regardless of the
   *   display name (the name attribute value) or any changes to the application. Unlike the display
   *   name, it is not localized.
   * @param property_depth - The nesting depth of this property (0 = layer level).
   * @param composition - The parent composition.
   */
  const tdbs_chunk = find_by_list_type(btds_chunk.chunks, "tdbs");
  const prop = parse_property(tdbs_chunk, match_name, composition, property_depth, tdmn);
  prop._wrapper = btds_chunk;
  prop._property_value_type = PropertyValueType.TEXT_DOCUMENT;

  let btdk_chunk: ListChunk;
  let cos_data: any;
  try {
    btdk_chunk = find_by_list_type(btds_chunk.chunks, "btdk");
    // btdk is a ListChunk with list_type="btdk"; raw data stored in .data
    const parser = new CosParser(new BytesIO(btdk_chunk.data), btdk_chunk.data.length);
    cos_data = parser.parse();
  } catch (e) {
    if (
      !(
        e instanceof ChunkNotFoundError ||
        e instanceof OverflowError ||
        e instanceof SyntaxError_ ||
        e instanceof ValueError
      )
    ) {
      throw e;
    }
    logger.debug("Failed to parse btdk COS binary for %s", match_name);
    return prop;
  }

  if (!(cos_data instanceof Map)) {
    logger.debug("Unexpected btdk COS structure for %s", match_name);
    return prop;
  }

  const [text_documents, _fonts] = parse_btdk_cos(cos_data, btdk_chunk);
  // Wire each document to the project head so version-gated attributes
  // (e.g. the box-text setters) can resolve the AE major version, and to
  // the AE preferences, which hold the Character/Paragraph panel defaults
  // the reset methods restore.
  const project_head = composition._project._head;
  const project_preferences = composition._project._preferences;
  for (const doc of text_documents) {
    doc._head = project_head;
    doc._preferences = project_preferences;
  }
  if (text_documents?.length > 0) {
    if (prop.keyframes?.length > 0) {
      for (const [kf, doc] of zip(prop.keyframes, text_documents)) {
        kf._cache_value(doc);
      }
    } else {
      prop._cache_value(text_documents[0]);
    }
  }

  return prop;
}

export function parse_gradient(
  gcst_chunk: ListChunk,
  match_name: string,
  property_depth: number,
  composition: CompItem,
  tdmn: TdmnChunk,
): Property {
  /**
   * Parse a gradient color property from a GCst chunk.
   *
   * The GCst chunk contains:
   * - LIST:tdbs with base property metadata
   * - LIST:GCky with Utf8 chunks containing gradient XML per keyframe
   *
   * @param gcst_chunk - The GCst LIST chunk to parse.
   * @param match_name - The match name identifier for this property.
   * @param property_depth - The nesting depth of this property.
   * @param composition - The parent composition.
   * @param tdmn - The tdmn chunk for this property.
   */
  const tdbs_chunk = find_by_list_type(gcst_chunk.chunks, "tdbs");
  const prop = parse_property(tdbs_chunk, match_name, composition, property_depth, tdmn);

  prop._wrapper = gcst_chunk;
  let gcky_chunk: ListChunk;
  try {
    gcky_chunk = find_by_list_type(gcst_chunk.chunks, "GCky");
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    return prop;
  }

  prop._kf_value_container = gcky_chunk;
  const utf8_chunks = filter_by_type(gcky_chunk.chunks, "Utf8") as Utf8Chunk[];
  const gradient_values = [];
  for (const utf8 of utf8_chunks) {
    const gdata = parse_gradient_xml(utf8);
    if (gdata != null) {
      gradient_values.push(gdata);
    }
  }

  if (gradient_values.length) {
    if (prop.keyframes?.length > 0) {
      for (const [kf, gdata] of zip(prop.keyframes, gradient_values)) {
        kf._cache_value(gdata);
      }
    } else {
      prop._cache_value(gradient_values[0]);
    }
  }

  return prop;
}
