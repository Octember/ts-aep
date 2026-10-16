/** Mutation round-trips for CompItem.renderer_options. */

import { describe, expect, test } from "bun:test";

import { KeyError, Path, ValueError } from "../../src/pyrt/index.ts";
import { approx, make_tmp_path, raises } from "../../src/pyrt/pytest.ts";
import { parse as parse_aep } from "../../src/py_aep/index.ts";
import "../../src/py_aep/binary/_register.ts";
import { EnvironmentLightShadowResolution, ShadowMapResolution } from "../../src/py_aep/enums/index.ts";

const SAMPLES_DIR = new Path(import.meta.path).parent.parent.parent.div("samples", "models");
const COMPOSITION_DIR = SAMPLES_DIR.div("composition");

function _reparse(app: any, tmp_path: Path): any {
  const out = tmp_path.div("modified.aep");
  app.project.save(out);
  return parse_aep(out).project.compositions.at(0)!;
}

describe("TestRoundtripRendererOptions", () => {
  test("test_classic_shadow_map", () => {
    const tmp_path = make_tmp_path();
    const app = parse_aep(COMPOSITION_DIR.div("renderer_classic_3d.aep"));
    app.project.compositions.at(0)!.renderer_options.shadow_map_resolution = ShadowMapResolution.RES_4000;

    const comp = _reparse(app, tmp_path);

    expect(comp.renderer_options.shadow_map_resolution).toBe(ShadowMapResolution.RES_4000);
  });

  test("test_cinema_4d_quality", () => {
    const tmp_path = make_tmp_path();
    const app = parse_aep(COMPOSITION_DIR.div("renderer_cinema_4d.aep"));
    app.project.compositions.at(0)!.renderer_options.quality = 99;

    expect(_reparse(app, tmp_path).renderer_options.quality).toBe(99);
  });

  test("test_advanced_scalars", () => {
    const tmp_path = make_tmp_path();
    const app = parse_aep(COMPOSITION_DIR.div("renderer_advanced_3d.aep"));
    const opts = app.project.compositions.at(0)!.renderer_options;
    opts.quality = 125;
    opts.resolution = EnvironmentLightShadowResolution.HALF;
    opts.smoothness = 20;

    const comp = _reparse(app, tmp_path);

    expect(comp.renderer_options.quality).toBe(125);
    expect(comp.renderer_options.resolution).toBe(EnvironmentLightShadowResolution.HALF);
    expect(comp.renderer_options.smoothness).toBe(20);
  });

  /** Pixel values survive a save, to float32 precision.
   *
   * `approx` is required: the field holds a float64 in memory and narrows
   * to float32 only when packed on save, so a value that crosses disk
   * returns off by ~4e-5 px. A set-then-read without saving would compare
   * exactly equal, which is the trap.
   */
  test("test_advanced_casting_box", () => {
    const tmp_path = make_tmp_path();
    const app = parse_aep(COMPOSITION_DIR.div("renderer_advanced_3d.aep"));
    const opts = app.project.compositions.at(0)!.renderer_options;
    opts.casting_box_size = 640.0;
    opts.casting_box_center = [100.0, 200.0, -300.0];

    const comp = _reparse(app, tmp_path);

    expect(approx(comp.renderer_options.casting_box_size, 640.0)).toBe(true);
    expect(approx(comp.renderer_options.casting_box_center, [100.0, 200.0, -300.0])).toBe(true);
  });

  test("test_mapping_write_round_trips", () => {
    const tmp_path = make_tmp_path();
    const app = parse_aep(COMPOSITION_DIR.div("renderer_advanced_3d.aep"));
    app.project.compositions.at(0)!.renderer_options.__setitem__("Quality", 42);

    expect(_reparse(app, tmp_path).renderer_options.__getitem__("Quality")).toBe(42);
  });

  test("test_bulk_assignment", () => {
    const tmp_path = make_tmp_path();
    const app = parse_aep(COMPOSITION_DIR.div("renderer_advanced_3d.aep"));
    app.project.compositions.at(0)!.renderer_options = new Map<string, any>([
      ["Quality", 7],
      ["Smoothness", 2],
    ]);

    const comp = _reparse(app, tmp_path);

    expect(comp.renderer_options.quality).toBe(7);
    expect(comp.renderer_options.smoothness).toBe(2);
  });
});

describe("TestRendererOptionsValidation", () => {
  test("test_quality_out_of_range", () => {
    const comp = parse_aep(COMPOSITION_DIR.div("renderer_advanced_3d.aep")).project.compositions.at(0)!;

    raises(ValueError, () => {
      comp.renderer_options.quality = 126;
    });
  });

  test("test_unknown_key", () => {
    const comp = parse_aep(COMPOSITION_DIR.div("renderer_cinema_4d.aep")).project.compositions.at(0)!;

    raises(KeyError, () => {
      comp.renderer_options.__setitem__("Nonexistent", 1);
    });
  });

  /** ChunkField.enum validates membership without a separate validator. */
  test("test_enum_rejects_out_of_range", () => {
    const comp = parse_aep(COMPOSITION_DIR.div("renderer_classic_3d.aep")).project.compositions.at(0)!;

    raises(ValueError, () => {
      comp.renderer_options.shadow_map_resolution = 9;
    });
  });

  test.each([-1, 30001])("test_casting_box_size_out_of_range[%#]", (bad: number) => {
    const comp = parse_aep(COMPOSITION_DIR.div("renderer_advanced_3d.aep")).project.compositions.at(0)!;

    raises(ValueError, () => {
      comp.renderer_options.casting_box_size = bad;
    });
  });

  test.each([[[0.0, 0.0]], [[40000.0, 0.0, 0.0]], [[0.0, -40000.0, 0.0]]])(
    "test_casting_box_center_rejected[%#]",
    (bad: number[]) => {
      const comp = parse_aep(COMPOSITION_DIR.div("renderer_advanced_3d.aep")).project.compositions.at(0)!;

      raises(ValueError, () => {
        comp.renderer_options.casting_box_center = bad;
      });
    },
  );

  test("test_smoothness_out_of_range", () => {
    const comp = parse_aep(COMPOSITION_DIR.div("renderer_advanced_3d.aep")).project.compositions.at(0)!;

    raises(ValueError, () => {
      comp.renderer_options.smoothness = 21;
    });
  });
});
