/**
 * Strict-bool validation across the model layer.
 *
 * Writable boolean attributes reject non-bool values (the binary layer would
 * otherwise silently coerce truthy values - `"no"` -> `True`); real booleans
 * are accepted and round-trip. Covers a representative writable bool on each
 * major model. The render-queue package has its own coverage in
 * `test_rq_validation.py`.
 */

import { describe, expect, test } from "bun:test";
import {
  AssertionError_,
  getattr,
  len,
  Path,
  py_bool,
  StopIteration,
  str,
  TypeError_,
} from "../../src/pyrt/index.ts";
import { make_tmp_path, raises } from "../../src/pyrt/pytest.ts";
import { parse_app_fresh, parse_project_fresh } from "../helpers.ts";
import { ImportOptions } from "../../src/py_aep/models/import_options.ts";
import type { MaskPropertyGroup } from "../../src/py_aep/models/properties/mask_property_group.ts";
import type { FootageSource } from "../../src/py_aep/models/sources/footage.ts";

const SAMPLES = new Path(import.meta.path).parent.parent.parent.div("samples");
const LAYER = SAMPLES.div("models", "layer", "enabled_false.aep");
const FOOTAGE = SAMPLES.div("models", "essential_graphics", "media_replacement.aep");
const MASK = SAMPLES.div("models", "essential_graphics", "indexed_group_controllers.aep");
const VIEW = SAMPLES.div("models", "view", "grid_on.aep");

function _file_source(): FootageSource {
  const project = parse_project_fresh(FOOTAGE);
  const footage = project.footages.find(
    (f: any) => getattr(f, "main_source", null)?.constructor?.name === "FileSource",
  );
  if (footage === undefined) throw new StopIteration();
  return footage.main_source;
}

function _first_mask(): MaskPropertyGroup {
  const project = parse_project_fresh(MASK);
  for (const comp of project.compositions) {
    for (const layer of comp.layers) {
      const masks = getattr(layer, "masks", null);
      if (py_bool(masks) && len(masks) > 0) {
        return masks[0];
      }
    }
  }
  throw new AssertionError_("no mask found in sample");
}

// (id, factory returning a fresh mutable object, bool attribute name)
const CASES: [string, () => any, string][] = [
  [
    "comp.motion_blur",
    () => parse_project_fresh(LAYER).compositions[0],
    "motion_blur",
  ],
  [
    "comp.frame_blending",
    () => parse_project_fresh(LAYER).compositions[0],
    "frame_blending",
  ],
  [
    "layer.enabled",
    () => parse_project_fresh(LAYER).compositions[0].layers[0],
    "enabled",
  ],
  [
    "layer.solo",
    () => parse_project_fresh(LAYER).compositions[0].layers[0],
    "solo",
  ],
  ["layer.shy", () => parse_project_fresh(LAYER).compositions[0].layers[0], "shy"],
  [
    "project.frames_use_feet_frames",
    () => parse_project_fresh(LAYER),
    "frames_use_feet_frames",
  ],
  ["footage.invert_alpha", _file_source, "invert_alpha"],
  ["mask.inverted", _first_mask, "inverted"],
  ["view.grid", () => parse_app_fresh(VIEW).active_viewer.views[0].options, "grid"],
  ["import.sequence", () => new ImportOptions(str(LAYER)), "sequence"],
  [
    "import.force_alphabetical",
    () => new ImportOptions(str(LAYER)),
    "force_alphabetical",
  ],
];

// TODO(port): pytest `ids=_IDS` has no bun:test equivalent in test.each; the
// case ids are kept here but test names fall back to the `[%#]` row index.
const _IDS = CASES.map((c) => c[0]);
const _PARAMS = CASES.map((c): [() => any, string] => [c[1], c[2]]);

describe("TestStrictBool", () => {
  test.each(_PARAMS)("test_rejects_non_bool_string[%#]", (factory: () => any, attr: string) => {
    const obj = factory();
    raises(TypeError_, () => {
      (obj as any)[attr] = "no";
    });
  });

  test.each(_PARAMS)("test_rejects_bare_int[%#]", (factory: () => any, attr: string) => {
    const obj = factory();
    raises(TypeError_, () => {
      (obj as any)[attr] = 1;
    });
  });

  test.each(_PARAMS)("test_accepts_true_and_false[%#]", (factory: () => any, attr: string) => {
    const obj = factory();
    (obj as any)[attr] = true;
    expect(getattr(obj, attr)).toBe(true);
    (obj as any)[attr] = false;
    expect(getattr(obj, attr)).toBe(false);
  });
});

/** A validated bool still serializes through a disk round-trip. */
describe("TestBoolPersists", () => {
  test("test_comp_and_layer_flags_roundtrip", () => {
    const tmp_path = make_tmp_path();
    const project = parse_project_fresh(LAYER);
    const comp = project.compositions[0];
    const layer = comp.layers[0];
    comp.motion_blur = true;
    layer.solo = true;
    const out = tmp_path.div("bools.aep");
    project.save(out);

    const project2 = parse_project_fresh(out);
    const comp2 = project2.compositions[0];
    expect(comp2.motion_blur).toBe(true);
    expect(comp2.layers[0].solo).toBe(true);
  });
});
