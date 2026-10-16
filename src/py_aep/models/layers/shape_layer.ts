// Port of py_aep/models/layers/shape_layer.py

import { getitem } from "../../../pyrt/index.ts";
import { LayerType } from "../../enums/index.ts";
import { label_index } from "../preferences.ts";
import { AVLayer } from "./av_layer.ts";
import type { CompItem } from "../items/composition.ts";
import type { Layer } from "./layer.ts";

/**
 * The `ShapeLayer` object represents a shape layer within a composition.
 *
 * Example:
 *     ```python
 *     from py_aep import parse
 *
 *     app = parse("project.aep")
 *     comp = app.project.compositions[0]
 *     shape_layer = comp.shape_layers[0]
 *     print(shape_layer.content)
 *     ```
 *
 * Info:
 *     `ShapeLayer` is a subclass of [AVLayer][] object. All methods and
 *     attributes of [AVLayer][] are available when working with `ShapeLayer`.
 *
 * See: https://ae-scripting.docsforadobe.dev/layer/shapelayer/
 */
export class ShapeLayer extends AVLayer {
  static _auto_name: string = "Shape Layer";

  // TODO(port): Python `# type: ignore[override]` — this keyword shape differs from AVLayer._new's
  static _new(kw: {
    name: string;
    layer_id: number;
    duration: number;
    containing_comp: CompItem;
    effect_param_defs?: Map<string, Map<string, Map<string, any>>> | null;
  }): ShapeLayer {
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
    }) as ShapeLayer;
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
