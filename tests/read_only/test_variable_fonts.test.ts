/** Read-only tests for variable-font support (AE 2026 fixtures). */

// `from __future__ import annotations` is dropped: no annotation here is
// evaluated at runtime. Python test classes become `describe` blocks; the
// module-level helpers stay module-level functions.

import { describe, expect, test } from "bun:test";
import { Path, py_eq } from "../../src/pyrt/index.ts";
import { VariableFontSpacing } from "../../src/py_aep/enums/index.ts";
import "../../src/py_aep/binary/_register.ts";
import { get_comp, parse_project } from "../helpers.ts";

// Path(__file__).parent x3 is the TS root (this file lives in tests/read_only).
const SAMPLES_DIR = new Path(import.meta.path).parent.parent.parent.div("samples", "models", "layer");

function _vf_layer(name: string): any {
  const project: any = parse_project(SAMPLES_DIR.div(name));
  return get_comp(project, "vf").layers[0];
}

function _animator_props(layer: any): any {
  const animators = layer.__getitem__("ADBE Text Properties").__getitem__("ADBE Text Animators");
  return animators.properties[0].__getitem__("ADBE Text Animator Properties");
}

describe("TestFontObjectVariable", () => {
  test("test_design_vector_default_instance", () => {
    const font = _vf_layer("variable_font_static.aep").text.source_text.value.font_object;
    expect(py_eq(font.design_vector, [400.0, 100.0])).toBe(true);
    expect(font.has_design_axes).toBe(true);
    expect(font.family_prefix).toBe("Bahnschrift");
  });

  test("test_design_vector_named_instance", () => {
    const font = _vf_layer("variable_font_instance.aep").text.source_text.value.font_object;
    expect(font.post_script_name).toBe("Bahnschrift-BoldSemiCondensed");
    expect(py_eq(font.design_vector, [700.0, 87.5])).toBe(true);
    expect(font.family_prefix).toBe("Bahnschrift");
  });

  test("test_non_variable_font", () => {
    const project: any = parse_project(SAMPLES_DIR.div("threeDPerChar_on.aep"));
    const font = project.compositions[0].layers[0].text.source_text.value.font_object;
    expect(font.design_vector).toBe(null);
    expect(font.has_design_axes).toBe(false);
    expect(font.family_prefix).toBe(null);
  });
});

describe("TestVariableFontAxisProperty", () => {
  test("test_static_axis", () => {
    const props = _animator_props(_vf_layer("variable_font_axis_static.aep"));
    const axis = props.__getitem__("ADBE Text VF Axis 1");
    expect(axis.value).toBe(700.0);
    expect(axis.axis_tag).toBe("wght");
    expect(axis.name).toBe("Font Axis Weight");
    expect(axis.min_value).toBe(300.0);
    expect(axis.max_value).toBe(700.0);
  });

  test("test_animated_axis_scalar_keyframes", () => {
    const props = _animator_props(_vf_layer("variable_font_axis_animated.aep"));
    const wght = props.__getitem__("ADBE Text VF Axis 1");
    expect(py_eq(wght.keyframes.map((kf: any) => kf.value), [300.0, 700.0])).toBe(true);
    expect(wght.axis_tag).toBe("wght");
    const wdth = props.__getitem__("ADBE Text VF Axis 2");
    expect(wdth.value).toBe(80.0);
    expect(wdth.axis_tag).toBe("wdth");
    expect(wdth.name).toBe("Font Axis Width");
  });

  test("test_unused_slot", () => {
    const props = _animator_props(_vf_layer("variable_font_axis_animated.aep"));
    const slot = props.__getitem__("ADBE Text VF Axis 3");
    expect(slot.axis_tag).toBe(null);
    expect(slot.name).toBe("");
  });

  test("test_axis_tag_none_for_regular_property", () => {
    const layer = _vf_layer("variable_font_axis_static.aep");
    const opacity = layer.transform.property("ADBE Opacity");
    expect(opacity.axis_tag).toBe(null);
  });
});

describe("TestVariableFontSpacing", () => {
  test("test_spacing_value_enum", () => {
    const layer = _vf_layer("variable_font_spacing.aep");
    const prop = layer
      .__getitem__("ADBE Text Properties")
      .__getitem__("ADBE Text More Options")
      .__getitem__("ADBE Text Variable Font Spacing");
    expect(prop.name).toBe("Variable Font Spacing");
    expect(VariableFontSpacing.of(prop.value)).toBe(VariableFontSpacing.PER_CHARACTER);
  });

  test("test_spacing_default", () => {
    const layer = _vf_layer("variable_font_axis_static.aep");
    const prop = layer
      .__getitem__("ADBE Text Properties")
      .__getitem__("ADBE Text More Options")
      .__getitem__("ADBE Text Variable Font Spacing");
    expect(VariableFontSpacing.of(prop.value)).toBe(VariableFontSpacing.ADAPTIVE);
  });
});

describe("TestValueText", () => {
  test("test_value_text_none_without_dropdown_parameters", () => {
    const layer = _vf_layer("variable_font_axis_static.aep");
    const opacity = layer.transform.property("ADBE Opacity");
    expect(opacity.value_text).toBe(null);
  });
});
