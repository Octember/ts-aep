/**
 * Auto-bezier derivation rules, measured on AE 2018 and AE 2026.
 *
 * After Effects recomputes an auto-bezier keyframe's tangents and ease from the
 * flag and ignores whatever is stored, so its own files legitimately carry stale
 * or zero values on those keyframes. Every expectation here is an AE measurement,
 * not a restatement of the implementation - see
 * `.claude/plans/write-path-companion-state.md`.
 */

import { describe, expect, test } from "bun:test";

import { py_eq } from "../../src/pyrt/index.ts";
import { approx } from "../../src/pyrt/pytest.ts";
// TODO(port): `_DEFAULT_INFLUENCE` is module-private in resolvers/interpolation.ts
// today; the Python test imports it by name, so it needs an export there.
import { _DEFAULT_INFLUENCE, auto_spatial_tangents, auto_temporal_speeds } from "../../src/py_aep/resolvers/interpolation.ts";

/** Tangent is +/- one sixth of the chord between the neighbours. */
describe("TestAutoSpatialTangents", () => {
  /**
   * The discriminating case: neighbours that are NOT equidistant in
   * time. AE gives +/-(600-0)/6; the time-weighted rule this replaced
   * would give in=[-50] out=[150].
   */
  test("test_interior_uses_chord_not_time_weighting", () => {
    const values = [[0.0, 0.0], [100.0, 0.0], [600.0, 0.0]];
    const [out_tangent, in_tangent] = auto_spatial_tangents(values, 1);
    expect(approx(out_tangent, [100.0, 0.0])).toBe(true);
    expect(approx(in_tangent, [-100.0, 0.0])).toBe(true);
  });

  /**
   * AE writes BOTH tangents at an endpoint, from the chord to its one
   * neighbour: k0 gets +/-(100-0)/6, k2 gets +/-(600-100)/6.
   */
  test("test_endpoints_use_the_single_neighbour_chord", () => {
    const values = [[0.0, 0.0], [100.0, 0.0], [600.0, 0.0]];
    const [first_out, first_in] = auto_spatial_tangents(values, 0);
    expect(approx(first_out, [100.0 / 6.0, 0.0])).toBe(true);
    expect(approx(first_in, [-100.0 / 6.0, 0.0])).toBe(true);

    const [last_out, last_in] = auto_spatial_tangents(values, 2);
    expect(approx(last_out, [500.0 / 6.0, 0.0])).toBe(true);
    expect(approx(last_in, [-500.0 / 6.0, 0.0])).toBe(true);
  });

  test("test_two_keyframes_share_the_same_chord", () => {
    const values = [[0.0, 0.0], [300.0, 0.0]];
    for (const index of [0, 1]) {
      const [out_tangent, in_tangent] = auto_spatial_tangents(values, index);
      expect(approx(out_tangent, [50.0, 0.0])).toBe(true);
      expect(approx(in_tangent, [-50.0, 0.0])).toBe(true);
    }
  });

  test("test_three_dimensional", () => {
    const values = [[0.0, 0.0, 0.0], [100.0, 50.0, 20.0], [600.0, 300.0, 90.0]];
    const [out_tangent, in_tangent] = auto_spatial_tangents(values, 1);
    expect(approx(out_tangent, [100.0, 50.0, 15.0])).toBe(true);
    expect(approx(in_tangent, [-100.0, -50.0, -15.0])).toBe(true);
  });

  test("test_single_keyframe_has_no_tangents", () => {
    const [out_tangent, in_tangent] = auto_spatial_tangents([[10.0, 20.0]], 0);
    expect(py_eq(out_tangent, [0.0, 0.0])).toBe(true);
    expect(py_eq(in_tangent, [0.0, 0.0])).toBe(true);
  });

  /**
   * The five-key diamond in samples/versions/ae2018. Every tangent AE
   * reports for it is chord/6, including both endpoints.
   */
  test("test_ae2018_diamond", () => {
    const values = [
      [100.0, 540.0, 0.0],
      [960.0, 100.0, 0.0],
      [1820.0, 540.0, 0.0],
      [960.0, 980.0, 0.0],
      [100.0, 540.0, 0.0],
    ];
    const expected_out = [
      [143.333, -73.333, 0.0],
      [286.667, 0.0, 0.0],
      [0.0, 146.667, 0.0],
      [-286.667, 0.0, 0.0],
      [-143.333, -73.333, 0.0],
    ];
    for (const [index, expected] of expected_out.entries()) {
      const [out_tangent, in_tangent] = auto_spatial_tangents(values, index);
      expect(approx(out_tangent, expected, { abs: 0.001 })).toBe(true);
      expect(approx(in_tangent, expected.map((c) => -c), { abs: 0.001 })).toBe(true);
    }
  });
});

/** Speed is the through-slope across the neighbours, per dimension. */
describe("TestAutoTemporalSpeeds", () => {
  /** AE 2018 Rotate Z, 0 -> 180 -> 360 at t = 0 / 2 / 4: speed 90. */
  test("test_interior_through_slope", () => {
    const values = [[0.0], [180.0], [360.0]];
    const times = [0.0, 2.0, 4.0];
    const [in_speeds, out_speeds] = auto_temporal_speeds(values, times, 1);
    expect(approx(in_speeds, [90.0])).toBe(true);
    expect(approx(out_speeds, [90.0])).toBe(true);
  });

  test("test_endpoints_zero_on_the_outward_side", () => {
    const values = [[0.0], [180.0], [360.0]];
    const times = [0.0, 2.0, 4.0];
    const [first_in, first_out] = auto_temporal_speeds(values, times, 0);
    expect(approx(first_in, [0.0])).toBe(true);
    expect(approx(first_out, [90.0])).toBe(true);

    const [last_in, last_out] = auto_temporal_speeds(values, times, 2);
    expect(approx(last_in, [90.0])).toBe(true);
    expect(approx(last_out, [0.0])).toBe(true);
  });

  /**
   * AE 2026, 2-D Scale 100->200->400 and 100->120->150 over 2 s:
   * speeds 150 and 25, NOT one shared scalar.
   */
  test("test_per_dimension_slope", () => {
    const values = [[100.0, 100.0], [200.0, 120.0], [400.0, 150.0]];
    const times = [0.0, 1.0, 2.0];
    const [in_speeds, out_speeds] = auto_temporal_speeds(values, times, 1);
    expect(approx(in_speeds, [150.0, 25.0])).toBe(true);
    expect(approx(out_speeds, [150.0, 25.0])).toBe(true);
  });

  test("test_three_dimensional_scale", () => {
    const values = [[100.0, 100.0, 100.0], [200.0, 120.0, 110.0], [400.0, 150.0, 300.0]];
    const times = [0.0, 1.0, 2.0];
    const [in_speeds, _] = auto_temporal_speeds(values, times, 1);
    expect(approx(in_speeds, [150.0, 25.0, 100.0])).toBe(true);
  });

  /** AE 2026, opacity 0 -> 100 over 4 s: slope 25 on the inward side. */
  test("test_two_keyframes", () => {
    const values = [[0.0], [100.0]];
    const times = [0.0, 4.0];
    const [first_in, first_out] = auto_temporal_speeds(values, times, 0);
    expect(approx(first_in, [0.0])).toBe(true);
    expect(approx(first_out, [25.0])).toBe(true);
  });

  test("test_single_keyframe_has_no_speed", () => {
    const [in_speeds, out_speeds] = auto_temporal_speeds([[42.0]], [1.0], 0);
    expect(py_eq(in_speeds, [0.0])).toBe(true);
    expect(py_eq(out_speeds, [0.0])).toBe(true);
  });

  test("test_zero_span_does_not_divide_by_zero", () => {
    const values = [[0.0], [10.0], [20.0]];
    const times = [1.0, 1.0, 1.0];
    const [in_speeds, out_speeds] = auto_temporal_speeds(values, times, 1);
    expect(py_eq(in_speeds, [0.0])).toBe(true);
    expect(py_eq(out_speeds, [0.0])).toBe(true);
  });

  test("test_default_influence_is_one_sixth", () => {
    expect(approx(_DEFAULT_INFLUENCE, 100.0 / 6.0)).toBe(true);
  });
});
