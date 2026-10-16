// Port of py_aep/models/layers/text_layer.py

import { getitem } from "../../../pyrt/index.ts";
import { ListChunk } from "../../binary/chunk.ts";
import { TdmnChunk, TdsbChunk, TdsnChunk } from "../../binary/property_chunks.ts";
import { LayerType } from "../../enums/index.ts";
import { label_index } from "../preferences.ts";
import { AVLayer } from "./av_layer.ts";
import type { CompItem } from "../items/composition.ts";
import type { Layer } from "./layer.ts";

/**
 * The `TextLayer` object represents a text layer within a composition.
 *
 * Example:
 *     ```python
 *     from py_aep import parse
 *
 *     app = parse("project.aep")
 *     comp = app.project.compositions[0]
 *     text_layer = comp.text_layers[0]
 *     print(text_layer.text)
 *     ```
 *
 * Info:
 *     `TextLayer` is a subclass of [AVLayer][] object. All methods and
 *     attributes of [AVLayer][] are available when working with `TextLayer`.
 *
 * See: https://ae-scripting.docsforadobe.dev/layer/textlayer/
 */
export class TextLayer extends AVLayer {
  static _auto_name: string = "Text";

  // TODO(port): Python `# type: ignore[override]` — this keyword shape differs from AVLayer._new's
  static _new(kw: {
    name: string;
    layer_id: number;
    duration: number;
    containing_comp: CompItem;
    btds: ListChunk;
    btgu: ListChunk;
    tdmn: TdmnChunk;
    effect_param_defs?: Map<string, Map<string, Map<string, any>>> | null;
  }): TextLayer {
    const {
      name,
      layer_id,
      duration,
      containing_comp,
      btds,
      btgu,
      tdmn,
      effect_param_defs = null,
    } = kw;
    const text_props_tdmn = new TdmnChunk({ value: "ADBE Text Properties" });
    const text_props_tdgp = new ListChunk({
      list_type: "tdgp",
      chunks: [
        new TdsbChunk({}),
        TdsnChunk.new_(),
        tdmn,
        btds,
        btgu,
        // AE terminates the group's match-name stream; without it
        // the file fails with "missing data in file".
        new TdmnChunk({ value: "ADBE Group End" }),
      ],
    });

    const layer = super._new({
      name,
      layer_id,
      duration,
      containing_comp,
      root_tdgp_extra: [text_props_tdmn, text_props_tdgp],
      effect_param_defs,
    }) as TextLayer;
    layer._ldta.layer_type = LayerType.TEXT;
    // The base factory named the layer from the AV type it started with.
    layer._match_name = getitem(
      (layer.constructor as typeof Layer)._LAYER_MATCH_NAMES,
      LayerType.TEXT,
    );
    // AE labels scripted text layers with the "Text Label Index"
    // preference (factory value 1, probed in AE 2026).
    layer._ldta.label = label_index(
      containing_comp._project._preferences,
      "Text Label Index",
      1,
    );
    return layer;
  }
}
