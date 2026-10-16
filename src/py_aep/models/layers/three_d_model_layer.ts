import { AVLayer } from "./av_layer.ts";

/**
 * The `ThreeDModelLayer` object represents a 3D Model layer within a
 * composition.
 *
 * Example:
 *     ```python
 *     from py_aep import parse
 *
 *     app = parse("project.aep")
 *     comp = app.project.compositions[0]
 *     model_layer = comp.three_d_model_layers[0]
 *     print(model_layer.source)
 *     ```
 *
 * Info:
 *     `ThreeDModelLayer` is a subclass of [AVLayer][] object. All methods and
 *     attributes of [AVLayer][] are available when working with
 *     `ThreeDModelLayer`.
 *
 * Note:
 *     This functionality was added in After Effects 24.4
 *
 * See: https://ae-scripting.docsforadobe.dev/layer/threedmodellayer/
 */
export class ThreeDModelLayer extends AVLayer {
  /** `True` for 3D Model layers. Read-only. */
  get can_set_collapse_transformation(): boolean {
    return true;
  }

  /** `False` for 3D Model layers (time remapping is not supported). Read-only. */
  get can_set_time_remap_enabled(): boolean {
    return false;
  }
}
