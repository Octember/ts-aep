/** Tests for CompItem.renderer_options (3D renderer options). */

import { describe, expect, test } from "bun:test";
import { approx, raises } from "../../src/pyrt/pytest.ts";
import { AttributeError, KeyError, Path, len, py_eq } from "../../src/pyrt/index.ts";
import "../../src/py_aep/binary/_register.ts";
import { RayTracedRendererOptions, parse as parse_aep } from "../../src/py_aep/index.ts";
import { EnvironmentLightShadowResolution, ShadowMapResolution } from "../../src/py_aep/enums/index.ts";

// `Path(__file__).parent.parent.parent / "samples" / "models"` in the Python source.
// A TS file's `import.meta.dir` is already its directory, so two `.parent` steps reach the root.
const SAMPLES_DIR = new Path(import.meta.dir).parent.parent.div("samples", "models");
const COMPOSITION_DIR = SAMPLES_DIR.div("composition");

/** Python `dict(mapping)`: a Map of the mapping's keys to their values. */
// TODO(pyrt): dict() of a Mapping has no pyrt shim; local helper for SettingsView.
const dict_of = (m: any): Map<string, any> => new Map([...m.keys()].map((k: string) => [k, m.__getitem__(k)]));

describe("TestRenderOptionEnums", () => {
  /** Index into AE's dropdown, confirmed at 0, 1 and 8. */
  test("test_shadow_map_resolution_is_positional", () => {
    expect(ShadowMapResolution.COMP_SIZE).toBe(0);
    expect(ShadowMapResolution.RES_250).toBe(1);
    expect(ShadowMapResolution.RES_4000).toBe(8);
    expect(len(ShadowMapResolution.members())).toBe(9);
  });

  test("test_shadow_map_resolution_labels", () => {
    // TODO(port): Python `member.label` is a property on the enum; the py_enum shim has no
    // label helper, so this assumes the generated enum exposes `label_of(member)` (like `name_of`).
    expect(ShadowMapResolution.label_of(ShadowMapResolution.COMP_SIZE)).toBe("Comp Size");
    expect(ShadowMapResolution.label_of(ShadowMapResolution.RES_750)).toBe("750");
  });

  test("test_environment_light_shadow_resolution", () => {
    expect(EnvironmentLightShadowResolution.HALF).toBe(0);
    expect(EnvironmentLightShadowResolution.FULL).toBe(1);
    expect(EnvironmentLightShadowResolution.DOUBLE).toBe(2);
  });

  test("test_environment_light_shadow_resolution_labels", () => {
    // TODO(port): see test_shadow_map_resolution_labels; `label` is assumed to be `label_of`.
    expect(EnvironmentLightShadowResolution.label_of(EnvironmentLightShadowResolution.HALF)).toBe("Half (2MB)");
    expect(EnvironmentLightShadowResolution.label_of(EnvironmentLightShadowResolution.DOUBLE)).toBe("Double (128MB)");
  });
});

describe("TestRendererOptionsReads", () => {
  test("test_classic_defaults", () => {
    const comp = parse_aep(COMPOSITION_DIR.div("renderer_classic_3d.aep")).project.compositions[0];
    const opts = comp.renderer_options;

    expect(opts.shadow_map_resolution).toBe(ShadowMapResolution.COMP_SIZE);
    expect(opts.__getitem__("Shadow Map Resolution")).toBe(ShadowMapResolution.COMP_SIZE);
  });

  test("test_advanced_defaults", () => {
    const comp = parse_aep(COMPOSITION_DIR.div("renderer_advanced_3d.aep")).project.compositions[0];
    const opts = comp.renderer_options;

    expect(opts.quality).toBe(8);
    expect(opts.resolution).toBe(EnvironmentLightShadowResolution.FULL);
    expect(opts.smoothness).toBe(3);
    // Comp-relative: stored 1.0 / 0.0 render as comp width and centre.
    expect(approx(opts.casting_box_size, comp.width)).toBe(true);
    expect(approx(opts.casting_box_center, [comp.width / 2, comp.height / 2, 0.0])).toBe(true);
  });

  test("test_cinema_4d_defaults", () => {
    const comp = parse_aep(COMPOSITION_DIR.div("renderer_cinema_4d.aep")).project.compositions[0];

    expect(comp.renderer_options.quality).toBe(25);
  });

  /** renderer_options returns a Mapping. */
  test("test_is_a_mapping", () => {
    const comp = parse_aep(COMPOSITION_DIR.div("renderer_cinema_4d.aep")).project.compositions[0];
    const opts = comp.renderer_options;

    expect(py_eq(dict_of(opts), new Map([["Quality", 25]]))).toBe(true);
    expect(py_eq([...opts.keys()], ["Quality"])).toBe(true);
    expect(py_eq(opts, new Map([["Quality", 25]]))).toBe(true);
  });

  /** AE 26.3 cannot author this renderer, so we do not let anyone edit it. */
  test("test_ray_traced_is_read_only", () => {
    const comp = parse_aep(COMPOSITION_DIR.div("renderer_ray_traced.aep")).project.compositions[0];
    const opts = comp.renderer_options;

    expect(opts instanceof RayTracedRendererOptions).toBe(true);
    expect(py_eq(dict_of(opts), new Map())).toBe(true);
    raises(KeyError, () => {
      opts.__setitem__("Quality", 1);
    });
    raises(AttributeError, () => {
      (opts as any).quality = 1;
    });
  });
});

/** Values set by hand in After Effects 26.3, on 1920x1080 comps. */
describe("TestRendererOptionsNonDefaults", () => {
  test("test_classic_non_default", () => {
    const comp = parse_aep(COMPOSITION_DIR.div("renderer_options_classic_3d.aep")).project.compositions[0];

    expect(comp.renderer_options.shadow_map_resolution).toBe(ShadowMapResolution.RES_750);
  });

  test("test_cinema_4d_non_default", () => {
    const comp = parse_aep(COMPOSITION_DIR.div("renderer_options_cinema_4d.aep")).project.compositions[0];

    expect(comp.renderer_options.quality).toBe(44);
  });

  test("test_advanced_non_default", () => {
    const comp = parse_aep(COMPOSITION_DIR.div("renderer_options_advanced_3d.aep")).project.compositions[0];

    expect(comp.renderer_options.quality).toBe(61);
    expect(comp.renderer_options.resolution).toBe(EnvironmentLightShadowResolution.DOUBLE);
    expect(comp.renderer_options.smoothness).toBe(6);
    expect(approx(comp.renderer_options.casting_box_size, 600.0)).toBe(true);
    expect(approx(comp.renderer_options.casting_box_center, [400.0, 600.0, -100.0])).toBe(true);
  });
});
