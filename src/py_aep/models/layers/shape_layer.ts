// Port of py_aep/models/layers/shape_layer.py

import { getitem } from "../../../pyrt/index.ts";
import { LayerType } from "../../enums/index.ts";
import { label_index } from "../preferences.ts";
import { AVLayer } from "./av_layer.ts";
import type { CompItem } from "../items/composition.ts";
import type { Layer } from "./layer.ts";
import type { PropertyGroup } from "../properties/property_group.ts";

/**
 * The `ShapeLayer` object represents a shape layer within a composition.
 *
 *
 * Info:
 *     `ShapeLayer` is a subclass of {@link AVLayer} object. All methods and
 *     attributes of {@link AVLayer} are available when working with `ShapeLayer`.
 *
 * @example
 * ```ts
 * import { parse } from "@bevyl-ai/ts-aep";
 *
 * const app = parse("project.aep");
 * const comp = app.project.compositions[0];
 * const shape_layer = comp.shape_layers[0];
 * console.log(shape_layer.content);
 * ```
 * @see https://ae-scripting.docsforadobe.dev/layer/shapelayer/
 */
export class ShapeLayer extends AVLayer {
  static _auto_name: string = "Shape Layer";

  static _new(
    match_name: string,
    auto_name: string,
    property_depth: number,
    kw?: any,
  ): PropertyGroup;
  static _new(kw: {
    name: string;
    layer_id: number;
    duration: number;
    containing_comp: CompItem;
    effect_param_defs?: Map<string, Map<string, Map<string, any>>> | null;
  }): ShapeLayer;
  static _new(kw: Record<string, unknown>): ShapeLayer;
  static _new(kw: any): any {
    const {
      name,
      layer_id,
      duration,
      containing_comp,
      effect_param_defs = null,
    } = kw;
    const layer = super._new({
      name,
      layer_id,
      duration,
      containing_comp,
      effect_param_defs,
    });
    layer._ldta.layer_type = LayerType.SHAPE;
    // The base factory named the layer from the AV type it started with.
    layer._match_name = getitem(
      (layer.constructor as typeof Layer)._LAYER_MATCH_NAMES,
      LayerType.SHAPE,
    );
    layer._ldta.label = label_index(
      containing_comp._project._preferences,
      "Shape Label Index 2",
      8,
    );
    layer._ldta.collapse_transformation = true;
    return layer;
  }
}
