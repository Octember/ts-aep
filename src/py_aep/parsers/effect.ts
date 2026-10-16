/** Effect and parameter definition parsers. */

import type { Chunk, ContainerChunk, ListChunk } from "../binary/chunk.ts";
import type { PardChunk } from "../binary/misc_chunks.ts";
import type { TdmnChunk, TdsbChunk, TdsnChunk } from "../binary/property_chunks.ts";
import type { Utf8Chunk } from "../binary/scalar_chunks.ts";
import {
  ChunkNotFoundError,
  filter_by_list_type,
  filter_by_type,
  find_by_list_type,
  find_by_type,
} from "../binary/utils.ts";
import { MATCH_NAME_TO_AUTO_NAME } from "../data/match_names.ts";
import { EFFECT_PARAM_SPATIAL_FLAGS } from "../data/spatial_flags.ts";
import { PropertyControlType, PropertyType, PropertyValueType } from "../enums/index.ts";
import { _suppress_materialization } from "../models/descriptors.ts";
import { _CANVARY_OVERRIDES, _PROPERTY_DEFAULTS } from "../models/properties/overrides.ts";
import { Property } from "../models/properties/property.ts";
import { PropertyGroup } from "../models/properties/property_group.ts";
import { PropSpec } from "../synthesis/property.ts";
import { get_chunks_by_match_name, get_match_name_runs } from "./utils.ts";
import { parse_properties } from "./property.ts";
import type { CompItem } from "../models/items/composition.ts";
import type { Layer } from "../models/layers/layer.ts";
import {
  and,
  dict_get,
  enumerate,
  float,
  getitem,
  int,
  py_bool,
  py_eq,
  py_or,
  split,
  warn,
  zip,
} from "../../pyrt/index.ts";

// `logging.getLogger(__name__)`: this module logs nothing today, so only the
// warning path is wired to pyrt `warn`.
export const logger = {
  debug() {},
  info() {},
  warning: (m: string) => warn(m),
};

export const _PVT_DIMENSIONS: Map<number, number> = new Map<number, number>([
  [PropertyValueType.COLOR, 4],
  [PropertyValueType.ThreeD_SPATIAL, 3],
  [PropertyValueType.TwoD_SPATIAL, 2],
]);

/**
 * Convert an effect parameter definition dict into a `PropSpec`.
 *
 * Args:
 *     match_name: The property's match name.
 *     param_def: The parameter definition dict from parT parsing.
 *
 * Returns:
 *     A `PropSpec` suitable for `Property._new()`.
 */
export function _param_def_to_spec(match_name: string, param_def: Map<string, any>): PropSpec {
  const pvt = dict_get(param_def, "property_value_type", PropertyValueType.OneD);
  const control_type = getitem(param_def, "property_control_type");
  const is_color = control_type === PropertyControlType.COLOR;
  const dims = dict_get(_PVT_DIMENSIONS, pvt, 1);
  const is_spatial =
    [PropertyValueType.TwoD_SPATIAL, PropertyValueType.ThreeD_SPATIAL].includes(pvt) || is_color;
  const [value, default_value] = _resolve_effect_value(match_name, param_def, control_type);
  // PropSpec is a NamedTuple: positional, in field order. Skipped optional
  // fields are passed as `undefined` so their defaults apply.
  return new PropSpec(
    match_name,
    py_or(dict_get(param_def, "name"), match_name),
    value,
    pvt,
    dims,
    is_spatial,
    is_color,
    control_type === PropertyControlType.INTEGER,
    undefined,
    undefined,
    default_value,
    control_type !== PropertyControlType.MASK,
    undefined,
    undefined,
    dict_get(EFFECT_PARAM_SPATIAL_FLAGS, control_type),
  );
}

/**
 * Resolve value and default_value for a synthesized effect property.
 *
 * Returns pre-rescale values - point defaults stay in percent of the
 * layer size; `_scale_point_to_pixels` converts them to pixels.
 *
 * Args:
 *     match_name: The property's match name.
 *     param_def: The parameter definition dict from parT parsing.
 *     control_type: The effect control type.
 *
 * Returns:
 *     A (value, default_value) tuple.
 */
export function _resolve_effect_value(
  match_name: string,
  param_def: Map<string, any>,
  control_type: PropertyControlType,
): [any, any] {
  if (control_type === PropertyControlType.ENUM) {
    // An omitted popup holds its pard default (1-based), not the value
    // cached in the definition: ExtendScript reports the default for
    // S_BlurDirectional's Edge Mode (cached 1, default 3). A cached
    // value beyond the choice count is managed by the plug-in (the OCIO
    // transforms keep hashed ids there, which ExtendScript reports) and
    // is kept.
    let value = dict_get(param_def, "default_value");
    const last = dict_get(param_def, "last_value");
    if (last != null && (value == null || last > dict_get(param_def, "nb_options", 0))) {
      value = last;
    }
    return [value, value];
  }
  if ([PropertyControlType.TWO_D, PropertyControlType.THREE_D].includes(control_type)) {
    // An omitted point is its pard default, a percentage of the layer
    // size. The cached value is that same percentage or a 16.16-rounded
    // fraction: Path Text's 80 % caches 0.7999878, ExtendScript reports
    // exactly 80 on a 100-pixel layer.
    const value = dict_get(param_def, "default_value");
    return [value, value];
  }
  // Any other control: AE leaves a parameter at its default out of the
  // effect's tdgp, so an omitted one is at the default its pard declares,
  // then the override table's, then the pard `default` field. The cached
  // `last_value` is not the value: it is the value of whichever instance
  // wrote the definition (another one when the definition is borrowed),
  // or stale - S_BlurDirectional's Bias caches 0 where ExtendScript
  // reports 0.5. It only stands in for a pard that declares no default.
  let value = dict_get(param_def, "default_value");
  if (value == null) value = dict_get(_PROPERTY_DEFAULTS, match_name);
  if (value == null) value = dict_get(param_def, "default");
  if (value == null) value = dict_get(param_def, "last_value");
  return [value, value];
}

/**
 * Apply parameter definition metadata to a property.
 *
 * Sets last_value, min/max bounds, nb_options, and
 * property_parameters from the parameter definition dict.  Shared by
 * `_synthesize_effect_property` and `_merge_param_def`.
 *
 * Args:
 *     prop: The property to update in place.
 *     param_def: The parameter definition dict.
 */
export function _apply_param_def_metadata(prop: Property, param_def: Map<string, any>): void {
  prop.last_value = dict_get(param_def, "last_value");
  const min_val = dict_get(param_def, "min_value");
  if (min_val != null) prop._min_value_fallback = min_val;
  const max_val = dict_get(param_def, "max_value");
  if (max_val != null) prop._max_value_fallback = max_val;
  // The pard UI slider range - distinct from the valid range and the
  // source of an Essential Graphics slider controller's Smin/Smax.
  prop._slider_min = dict_get(param_def, "slider_min");
  prop._slider_max = dict_get(param_def, "slider_max");
  prop.nb_options = dict_get(param_def, "nb_options");
  // Direct write: the public setter has user-write semantics (validation
  // plus pdnm/pard chunk rewrites).
  prop._property_parameters = dict_get(param_def, "property_parameters");
  const units = dict_get(param_def, "units_text");
  if (units != null) prop._units_text = units;
  // The pard param flags carry the authoritative can-vary bit; the
  // residue table keeps the rare params where they disagree with
  // ExtendScript (e.g. the Puppet Engine dropdown).
  const can_vary = dict_get(param_def, "can_vary_over_time");
  if (can_vary != null && !_CANVARY_OVERRIDES.has(prop.match_name)) {
    prop._can_vary_over_time = can_vary;
  }
  if (py_bool(dict_get(param_def, "expressions_disabled"))) {
    prop._expressions_disabled = true;
  }
}

/**
 * A point parameter's parT default, converted to pixel coordinates.
 *
 * `raw` is the pard default, in percent of the LAYER size - the same
 * reference the instance `cdat` uses - so the conversion is
 * `raw / 100 * layer_size`, with a 3D point's Z sharing the height
 * divisor (`Property._effect_scale`).
 *
 * Measured in AE 2026: an untouched Gradient Ramp `End of Ramp` (pard
 * default 50 %, 100 %) reports [100, 100] on a 200x100 layer in an
 * 800x600 comp, and [128, 256] on a 256x256 layer in a 512x512 comp.
 * Only the layer reproduces both; normalizing against the composition
 * gives [400, 600] and [128, 256] - right only when layer and comp match,
 * which is why this went unnoticed.
 *
 * Returns `null` when the value is not a point.
 */
export function _point_default_pixels(raw: any, size: [number, number]): number[] | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const scale = [size[0], size[1], size[1]];
  return zip(raw as number[], scale).map(([v, factor]) => v / 100.0 * factor);
}

/** Convert a synthesized point property's value and default in place. */
export function _scale_point_to_pixels(prop: Property, size: [number, number]): void {
  const value = _point_default_pixels(prop._value, size);
  if (value != null) prop._value = value;
  const default_ = _point_default_pixels(prop.default_value, size);
  if (default_ != null) prop.default_value = default_;
}

/**
 * Parse effect parameter definitions from parT chunk.
 *
 * Each effect has a parT LIST containing parameter definitions that
 * describe the control type, default values, and ranges.
 *
 * Args:
 *     sspc_child_chunks: The SSPC chunk's child chunks.
 *
 * Returns:
 *     Dict mapping parameter match names to definition dicts.
 */
export function parse_effect_param_defs(
  sspc_child_chunks: Chunk[],
): Map<string, Map<string, any>> {
  const part_chunk = find_by_list_type(sspc_child_chunks, "parT");
  const param_defs = new Map<string, Map<string, any>>();

  const chunks_by_parameter = get_chunks_by_match_name(part_chunk);
  for (const [index, [match_name, parameter_chunks]] of enumerate(chunks_by_parameter)) {
    // Skip first, it describes parent
    if (index === 0) continue;
    param_defs.set(match_name, _parse_effect_parameter_def(parameter_chunks));
  }

  return param_defs;
}

/**
 * Merge parameter definition values into a parsed property.
 *
 * Overrides auto-detected property attributes with the more precise
 * values from the effect's parameter definition.
 *
 * Args:
 *     prop: The property to update in place.
 *     param_def: The parameter definition dict.
 *     point_size: The layer size a point parameter's default is
 *         relative to.
 */
export function _merge_param_def(
  prop: Property,
  param_def: Map<string, any>,
  point_size: [number, number],
): void {
  prop._auto_name = py_or(getitem(param_def, "name"), prop._auto_name);
  prop._property_control_type = getitem(param_def, "property_control_type");
  if (prop._arbs != null && param_def.has("default_arbp")) {
    prop._default_arbp = getitem(param_def, "default_arbp");
  }
  prop._property_value_type = dict_get(
    param_def,
    "property_value_type",
    prop.property_value_type,
  );
  // Prefer the override table, then the pard default field. For LAYER
  // references, pard stores a meaningless 0 and we have no static
  // override, so leave default_value unset entirely.
  let static_default = dict_get(_PROPERTY_DEFAULTS, prop.match_name);
  if (static_default == null) static_default = dict_get(param_def, "default");
  if (static_default != null) {
    prop.default_value = static_default;
  } else if (
    [PropertyControlType.TWO_D, PropertyControlType.THREE_D].includes(
      getitem(param_def, "property_control_type"),
    )
  ) {
    prop.default_value = _point_default_pixels(dict_get(param_def, "default_value"), point_size);
  } else if (getitem(param_def, "property_control_type") !== PropertyControlType.LAYER) {
    prop.default_value = dict_get(param_def, "default_value");
  }
  _apply_param_def_metadata(prop, param_def);
}

/**
 * Create a default Property from an effect parameter definition.
 *
 * When effect parameters are at their default value, AE omits them from
 * the binary tdgp chunk.  This function builds a Property (or, for group
 * separators, a PropertyGroup) from the parT definition so the parsed
 * output matches what ExtendScript reports.
 *
 * Args:
 *     match_name: The property's match name.
 *     param_def: The parameter definition dict from parT parsing.
 *     property_depth: The nesting depth for this property.
 *     parent_property: The effect group that owns the synthesized child.
 *
 * Returns:
 *     A Property or PropertyGroup with default values.
 */
export function _synthesize_effect_property(
  match_name: string,
  param_def: Map<string, any>,
  property_depth: number,
  kw: { parent_property: PropertyGroup },
): Property | PropertyGroup {
  const { parent_property } = kw;
  const control_type = getitem(param_def, "property_control_type");
  const pvt = dict_get(param_def, "property_value_type", PropertyValueType.OneD);

  if (pvt === PropertyValueType.NO_VALUE) {
    const raw_display = dict_get(param_def, "name");
    const display =
      typeof raw_display === "string" && raw_display
        ? raw_display
        : dict_get(MATCH_NAME_TO_AUTO_NAME, match_name, "");
    return PropertyGroup._new(match_name, display, property_depth, {
      parent_property,
      synthetic: true,
    });
  }

  const spec = _param_def_to_spec(match_name, param_def);
  const prop = Property._new(spec, property_depth, {
    parent_property,
    control_type,
    synthetic: true,
  });
  _apply_param_def_metadata(prop, param_def);
  return prop;
}

/**
 * Parse effect properties and merge with parameter definitions.
 *
 * Walks `param_defs` in canonical order, merging parsed binary
 * properties or synthesizing missing ones in a single pass.  Tail
 * children not in `param_defs` (e.g. Compositing Options) are appended
 * in their original parsed order.
 *
 * Args:
 *     tdgp_chunk: The tdgp chunk containing property data.
 *     param_defs: Parameter definitions to merge into properties.
 *     child_depth: The property depth for parsed child properties.
 *     composition: The parent composition.
 *     parent_property: The effect group that owns the parsed children.
 *
 * Returns:
 *     List of parsed and merged properties.
 */
export function _parse_effect_properties(
  tdgp_chunk: ListChunk,
  param_defs: Map<string, Map<string, any>>,
  child_depth: number,
  composition: CompItem,
  parent_property: PropertyGroup,
  group_match_name = "",
  layer: Layer | null = null,
): (Property | PropertyGroup)[] {
  // Point parameters normalize against the LAYER. The layer is only
  // reachable once the effect is attached, so callers that already know
  // it pass its size; during the initial parse it is unknown and the
  // composition stands in (what py_aep has always used).
  const point_size: [number, number] = py_or(
    layer != null ? layer._pixel_size : null,
    [float(composition.width), float(composition.height)] as [number, number],
  );

  // Skip index-0 internal parameters (not exposed in ExtendScript).
  const property_runs = [...get_match_name_runs(tdgp_chunk)].filter(
    ([name]) => !name.endsWith("-0000"),
  );

  const parsed = parse_properties(
    property_runs,
    child_depth,
    new Map(),
    composition,
    layer,
  );

  // Index parsed children by match_name for O(1) lookup.
  const parsed_by_mn = new Map<string, Property | PropertyGroup>(
    parsed.map((p) => [p.match_name, p] as [string, Property | PropertyGroup]),
  );

  // Single ordered walk over param_defs: merge existing or synthesize
  // missing, producing children in canonical parT order.
  const ordered: (Property | PropertyGroup)[] = [];
  for (const [match_name, param_def] of param_defs) {
    const existing = dict_get(parsed_by_mn, match_name);
    if (existing != null) {
      if (existing instanceof Property) {
        _merge_param_def(existing, param_def, point_size);
      }
      ordered.push(existing);
    } else if (match_name === "ADBE Force CPU GPU") {
      // Belongs inside ADBE Effect Built In Params, not here.
      continue;
    } else {
      const synth = _synthesize_effect_property(match_name, param_def, child_depth, {
        parent_property,
      });
      if (
        synth instanceof Property &&
        [PropertyControlType.TWO_D, PropertyControlType.THREE_D].includes(
          synth._property_control_type,
        )
      ) {
        _scale_point_to_pixels(synth, point_size);
      }
      ordered.push(synth);
    }
  }

  // Append tail children not in param_defs (e.g. ADBE Effect Built In
  // Params) in their original parsed order.
  for (const child of parsed) {
    if (!param_defs.has(child.match_name)) ordered.push(child);
  }

  // Synthesize Compositing Options group when absent from the binary.
  // synthesize_children() will fill it from _COMPOSITING_OPTIONS_SPECS.
  if (!ordered.some((c) => c.match_name === "ADBE Effect Built In Params")) {
    ordered.push(
      PropertyGroup._new("ADBE Effect Built In Params", "Compositing Options", child_depth, {
        parent_property,
        synthetic: true,
      }),
    );
  }

  return ordered;
}

/**
 * Parse an effect.
 *
 * Args:
 *     sspc_chunk: The SSPC chunk to parse.
 *     group_match_name: A special name for the property used to build unique
 *         naming paths. The match name is not displayed, but you can refer
 *         to it in scripts. Every property has a unique match-name
 *         identifier. Match names are stable from version to version
 *         regardless of the display name (the name attribute value) or any
 *         changes to the application. Unlike the display name, it is not
 *         localized. An indexed group (`PropertyBase.property_type ==
 *         PropertyType.indexed_group`) may not have a name value, but
 *         always has a match_name value.
 *     property_depth: The nesting depth of this group (0 = layer level).
 *     effect_param_defs: Project-level effect parameter definitions, used as
 *         fallback when layer-level parT chunks are missing.
 *     composition: The parent composition.
 *     layer: The layer the effect belongs to, whose pixel size is used to
 *         denormalize point parameters. Optional: during the initial
 *         parse the layer does not exist yet and the composition stands
 *         in.
 */
export const parse_effect = _suppress_materialization().decorate(function parse_effect(
  sspc_chunk: ListChunk,
  group_match_name: string,
  property_depth: number,
  effect_param_defs: Map<string, Map<string, Map<string, any>>>,
  composition: CompItem,
  tdmn: TdmnChunk,
  layer: Layer | null = null,
): PropertyGroup {
  const sspc_child_chunks = sspc_chunk.chunks;
  const fnam_chunk = find_by_type(sspc_child_chunks, "fnam") as ContainerChunk;

  // fnam is a ContainerChunk with a Utf8 child
  const fnam_utf8 = find_by_type(fnam_chunk.chunks, "Utf8") as Utf8Chunk;
  const tdgp_chunk = find_by_list_type(sspc_child_chunks, "tdgp");

  let param_defs: Map<string, Map<string, any>>;
  try {
    param_defs = parse_effect_param_defs(sspc_child_chunks);
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    param_defs = new Map();
  }

  // Layer-level sspc may have an empty parT when the same effect type
  // is used more than once (AE doesn't duplicate the data).  Fall back
  // to previously cached or project-level EfdG definitions.
  if (!py_bool(param_defs) && effect_param_defs.has(group_match_name)) {
    param_defs = getitem(effect_param_defs, group_match_name);
  }

  // Cache successful parT parsing so later instances of the same
  // effect can reuse the definitions.
  if (py_bool(param_defs) && !effect_param_defs.has(group_match_name)) {
    effect_param_defs.set(group_match_name, param_defs);
  }
  // Resolve _name_utf8 from the effect tdgp's tdsn child
  const tdsn = find_by_type(tdgp_chunk.chunks, "tdsn") as TdsnChunk;
  const effect_name_utf8 = tdsn.utf8;

  let effect_tdsb: TdsbChunk | null;
  try {
    effect_tdsb = find_by_type(tdgp_chunk.chunks, "tdsb") as TdsbChunk;
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    effect_tdsb = null;
  }

  const effect_group = new PropertyGroup({
    _tdmn: tdmn,
    _tdgp: tdgp_chunk,
    _tdsb: effect_tdsb,
    _name_utf8: effect_name_utf8,
    _fnam_utf8: fnam_utf8,
    match_name: group_match_name,
    property_depth,
    properties: [],
  });
  effect_group._is_effect = true;
  // An effect group is a NAMED group in After Effects: its parameter list is
  // fixed, so AE rejects duplicate/remove/moveTo on a param ("parent is not
  // an INDEXED_GROUP") while accepting them on the effect itself, whose
  // parent is the indexed Effect Parade. Measured on AE 2026:
  // `effect.propertyType === PropertyType.INDEXED_GROUP` is false, the
  // parade's is true.
  effect_group._property_type = PropertyType.NAMED_GROUP;

  const properties = _parse_effect_properties(
    tdgp_chunk,
    param_defs,
    property_depth + 1,
    composition,
    effect_group,
    group_match_name,
    layer,
  );
  effect_group._properties = properties;
  for (const child of properties) {
    child._parent_property = effect_group;
  }

  return effect_group;
});

type PardExtractor = (body: any, result: Map<string, any>) => void;

export const _PARD_EXTRACTORS: Map<number, PardExtractor> = new Map();

/** Register a pard field extractor for the given control type(s). */
export function _pard_extractor(
  ...control_types: PropertyControlType[]
): (func: PardExtractor) => PardExtractor {
  function decorator(func: PardExtractor): PardExtractor {
    for (const ct of control_types) _PARD_EXTRACTORS.set(ct, func);
    return func;
  }
  return decorator;
}

// Python's `@_pard_extractor(...)` decorator is applied as a registration call
// directly after each definition, which keeps the registration order.
export function _extract_angle(body: any, result: Map<string, any>): void {
  result.set("last_value", body.last_value);
  if (body.default != null) result.set("default", _intify(body.default));
  result.set("property_value_type", PropertyValueType.OneD);
}
_pard_extractor(PropertyControlType.ANGLE)(_extract_angle);

export function _extract_boolean(body: any, result: Map<string, any>): void {
  result.set("last_value", body.last_value);
  result.set("default_value", body.default);
  result.set("min_value", 0);
  result.set("max_value", 1);
}
_pard_extractor(PropertyControlType.BOOLEAN)(_extract_boolean);

export function _extract_color(body: any, result: Map<string, any>): void {
  // pard stores colors as [A, R, G, B] in 0-255 range;
  // ExtendScript uses [R, G, B, A] in 0-1 range.
  {
    const [a, r, g, b] = body.last_color;
    result.set("last_value", [r / 255.0, g / 255.0, b / 255.0, a / 255.0]);
  }
  {
    const [a, r, g, b] = body.default_color;
    result.set("default_value", [r / 255.0, g / 255.0, b / 255.0, a / 255.0]);
  }
  result.set("min_value", -3921568.62745098);
  result.set("max_value", 3921568.62745098);
  result.set("property_value_type", PropertyValueType.COLOR);
}
_pard_extractor(PropertyControlType.COLOR)(_extract_color);

export function _extract_enum(body: any, result: Map<string, any>): void {
  result.set("last_value", body.last_value);
  result.set("nb_options", body.nb_options);
  result.set("default_value", body.default);
  result.set("min_value", 1);
  result.set("max_value", body.nb_options);
}
_pard_extractor(PropertyControlType.ENUM)(_extract_enum);

/** Return integral floats as int, matching ExtendScript output. */
// TODO(port): int/float distinction - JS has one number type, so an integral
// float and an int are indistinguishable; this returns int(value) for both.
export function _intify(value: number): number {
  return Number.isInteger(float(value)) ? int(value) : value;
}

export function _extract_integer(body: any, result: Map<string, any>): void {
  if (body.default != null) result.set("default", body.default);
  result.set("min_value", body.valid_min);
  result.set("max_value", body.valid_max);
}
_pard_extractor(PropertyControlType.INTEGER)(_extract_integer);

export function _extract_scalar(body: any, result: Map<string, any>): void {
  result.set("last_value", body.last_value);
  if (body.default != null) result.set("default", _intify(body.default));
  result.set("min_value", _intify(body.valid_min));
  result.set("max_value", _intify(body.valid_max));
  result.set("slider_min", body.slider_min);
  result.set("slider_max", body.slider_max);
}
_pard_extractor(PropertyControlType.SCALAR)(_extract_scalar);

export function _extract_slider(body: any, result: Map<string, any>): void {
  result.set("last_value", body.last_value);
  if (body.default != null && Number.isFinite(body.default)) {
    result.set("default", _intify(body.default));
  }
  // Non-finite bounds mean the side is unbounded.
  if (Number.isFinite(body.valid_min)) result.set("min_value", _intify(body.valid_min));
  if (Number.isFinite(body.valid_max)) result.set("max_value", _intify(body.valid_max));
  if (Number.isFinite(body.slider_min)) result.set("slider_min", body.slider_min);
  if (Number.isFinite(body.slider_max)) result.set("slider_max", body.slider_max);
  // PF_ValueDisplayFlag_PERCENT is the only display flag AE serializes
  // reliably for float sliders; it maps to unitsText "percent".
  if (body.displays_percent) result.set("units_text", "percent");
}
_pard_extractor(PropertyControlType.SLIDER)(_extract_slider);

export function _extract_three_d(body: any, result: Map<string, any>): void {
  result.set("last_value", [body.last_value_x, body.last_value_y, body.last_value_z]);
  // Percent of the layer size; `_point_default_pixels` converts it.
  result.set("default_value", body.default);
  result.set("property_value_type", PropertyValueType.ThreeD_SPATIAL);
}
_pard_extractor(PropertyControlType.THREE_D)(_extract_three_d);

export function _extract_two_d(body: any, result: Map<string, any>): void {
  result.set("last_value", [body.last_value_x, body.last_value_y]);
  result.set("default_value", body.default);
  result.set("property_value_type", PropertyValueType.TwoD_SPATIAL);
}
_pard_extractor(PropertyControlType.TWO_D)(_extract_two_d);

export function _extract_layer(body: any, result: Map<string, any>): void {
  result.set("property_value_type", PropertyValueType.LAYER_INDEX);
  result.set("default_value", 0);
}
_pard_extractor(PropertyControlType.LAYER)(_extract_layer);

export function _extract_mask(body: any, result: Map<string, any>): void {
  result.set("property_value_type", PropertyValueType.MASK_INDEX);
  result.set("default_value", 0);
}
_pard_extractor(PropertyControlType.MASK)(_extract_mask);

export function _extract_curve(body: any, result: Map<string, any>): void {
  result.set("property_value_type", PropertyValueType.CUSTOM_VALUE);
}
_pard_extractor(PropertyControlType.CURVE)(_extract_curve);

export function _extract_no_value(body: any, result: Map<string, any>): void {
  result.set("property_value_type", PropertyValueType.NO_VALUE);
}
_pard_extractor(
  PropertyControlType.GROUP,
  PropertyControlType.UNKNOWN,
  PropertyControlType.UNKNOWN_14,
  PropertyControlType.PAINT_GROUP,
)(_extract_no_value);

/** Parse effect parameter definition from pard chunk, returning a dict of values. */
export function _parse_effect_parameter_def(parameter_chunks: Chunk[]): Map<string, any> {
  const pard_chunk = find_by_type(parameter_chunks, "pard") as PardChunk;

  const control_type = PropertyControlType.of(pard_chunk.property_control_type);

  const result = new Map<string, any>([
    ["name", pard_chunk.name],
    ["property_control_type", control_type],
    // PF param flags bit 1 = CANNOT_TIME_VARY (the tdb4 byte is
    // unreliable for effect parameters).
    ["can_vary_over_time", !and(pard_chunk.param_flags, 0x02)],
    ["expressions_disabled", pard_chunk.expressions_disabled],
  ]);

  const extractor = dict_get(_PARD_EXTRACTORS, control_type);
  if (extractor != null) extractor(pard_chunk, result);

  // An arbitrary-data parameter's default follows its pard: the Curves
  // effect's untouched curves, byte-identical to an untouched instance's.
  const default_arbp = filter_by_type(parameter_chunks, "aRbp");
  if (py_bool(default_arbp)) {
    result.set("default_arbp", default_arbp[0]);
  }

  try {
    const pdnm_chunk = find_by_type(parameter_chunks, "pdnm") as ContainerChunk;
    // pdnm is a ContainerChunk with a Utf8 child
    const utf8_chunk = find_by_type(pdnm_chunk.chunks, "Utf8") as Utf8Chunk;
    const pdnm_data = utf8_chunk.value;
    if (control_type === PropertyControlType.ENUM) {
      result.set("property_parameters", split(pdnm_data, "|"));
    } else if (py_bool(pdnm_data)) {
      result.set("name", pdnm_data);
    }
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
  }

  return result;
}

/**
 * Parse project-level effect definitions from LIST:EfdG.
 *
 * EfdG contains parameter definitions for every effect type used in the
 * project. Unlike layer-level sspc chunks, the EfdG definitions always
 * include a parT chunk.
 *
 * Args:
 *     root_chunks: The root chunks of the AEP file.
 *
 * Returns:
 *     Dict mapping effect match names to their parameter definitions
 *     (effect_match_name -> param_match_name -> param_def dict).
 */
export function parse_effect_definitions(
  root_chunks: Chunk[],
): Map<string, Map<string, Map<string, any>>> {
  let efdg_chunk: ListChunk;
  try {
    efdg_chunk = find_by_list_type(root_chunks, "EfdG");
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    return new Map();
  }

  const effect_defs = new Map<string, Map<string, Map<string, any>>>();
  const efdf_chunks = filter_by_list_type(efdg_chunk.chunks, "EfDf");

  for (const efdf_chunk of efdf_chunks) {
    const efdf_child_chunks = efdf_chunk.chunks;
    // First tdmn in EfDf contains the effect match name
    const tdmn_chunk = find_by_type(efdf_child_chunks, "tdmn");
    const effect_match_name = (tdmn_chunk as TdmnChunk).value;

    const sspc_chunk = find_by_list_type(efdf_child_chunks, "sspc");
    const param_defs = parse_effect_param_defs(sspc_chunk.chunks);
    effect_defs.set(effect_match_name, param_defs);
  }

  return effect_defs;
}

/**
 * All effect definitions in `LIST:EfdG` as `(match_name, display, sspc)`.
 *
 * AE stores a complete `LIST:sspc` template (`fnam` + `parT` + value
 * `tdgp` + `pgui`) for every effect type used in the project, so any
 * such effect can be re-applied by cloning that template. Returns `[]`
 * when the project has no `LIST:EfdG`. The walk is project-stable (AE
 * never re-reads it after parse), so callers cache the result rather
 * than re-walking per lookup.
 */
export function effect_definition_entries(
  root_chunks: Chunk[],
): [string, string, ListChunk][] {
  let efdg_chunk: ListChunk;
  try {
    efdg_chunk = find_by_list_type(root_chunks, "EfdG");
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    return [];
  }

  const entries: [string, string, ListChunk][] = [];
  for (const efdf_chunk of filter_by_list_type(efdg_chunk.chunks, "EfDf")) {
    const match_name = (find_by_type(efdf_chunk.chunks, "tdmn") as TdmnChunk).value;
    const sspc_chunk = find_by_list_type(efdf_chunk.chunks, "sspc");
    const fnam = find_by_type(sspc_chunk.chunks, "fnam") as ContainerChunk;
    const display = (find_by_type(fnam.chunks, "Utf8") as Utf8Chunk).value;
    entries.push([match_name, display, sspc_chunk]);
  }
  return entries;
}

/**
 * Find the definition matching `name` in `entries`.
 *
 * `name` is matched against the effect match name across all entries
 * first, then against the `fnam` display name.
 *
 * Returns:
 *     `(match_name, display_name, def_sspc)` for the matching
 *     definition, or `None`.
 */
export function match_effect_definition(
  entries: [string, string, ListChunk][],
  name: string,
): [string, string, ListChunk] | null {
  for (const entry of entries) {
    if (py_eq(name, entry[0])) return entry;
  }
  for (const entry of entries) {
    if (py_eq(name, entry[1])) return entry;
  }
  return null;
}
