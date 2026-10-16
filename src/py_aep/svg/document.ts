/** SVG root parsing: canvas size and the viewBox origin transform. */

import { dict_get, float, min, max, py_bool, py_eq, py_or, split } from "../../pyrt/index.ts";
import { NUMBER_RE, parse_length } from "./_util.ts";
import { Affine } from "./transform.ts";

// TODO(port): xml.etree.ElementTree.Element has no pyrt shim yet; typed as any.
type Element = any;

// Python `NUMBER_RE.findall(value)`: the unanchored, global form of the (`^`-anchored) `NUMBER_RE` in _util.ts.
// TODO(port): CPython's `\d` also matches non-ASCII decimal digits; this uses ASCII `\d`.
const NUMBER_FINDALL_RE = new RegExp(NUMBER_RE.source.slice(1), "g");

// TYPE_CHECKING-only alias in Python.
type ViewBox = readonly [number, number, number, number];

/**
 * The `(min_x, min_y, width, height)` of a viewBox attribute, or `null`
 * when it is absent or invalid (not four finite numbers, or a size that is
 * not positive: SVG treats those as an error / no viewBox).
 */
function _view_box(value: string | null): ViewBox | null {
  if (!py_bool(value)) return null;
  const nums = [...value!.matchAll(NUMBER_FINDALL_RE)].map((m) => float(m[0]));
  if (nums.length !== 4 || !nums.every((n) => Number.isFinite(n))) return null;
  if (nums[2] <= 0 || nums[3] <= 0) return null;
  return [nums[0], nums[1], nums[2], nums[3]];
}

/**
 * Return `(width, height, root_transform)` for the SVG root.
 *
 * After Effects sizes the comp from the viewBox dimensions (falling
 * back to the `width`/`height` attributes). The root transform shifts
 * a non-zero viewBox origin to `(0, 0)` so geometry lands in comp
 * space.
 */
export function canvas(root: Element): [number, number, Affine] {
  const view_box = _view_box(root.get("viewBox"));
  if (view_box != null) {
    const [min_x, min_y, vb_w, vb_h] = view_box;
    // AE 2026 sizes the comp from the viewBox dimensions and only
    // shifts geometry by the viewBox origin (verified on the sample
    // SVG). Where width/height differ from the viewBox, AE also scales
    // the geometry by them while keeping the viewBox-sized comp;
    // py_aep keeps the drawing in viewBox units, so it fills the comp.
    return [vb_w, vb_h, new Affine(undefined, undefined, undefined, undefined, -min_x, -min_y)];
  }
  const width = parse_length(root.get("width"));
  const height = parse_length(root.get("height"));
  if (!(Number.isFinite(width) && Number.isFinite(height))) {
    return [0.0, 0.0, new Affine()];
  }
  return [width, height, new Affine()];
}

/**
 * Map a nested viewport's content onto its `x / y / width / height`
 * box (SVG 1.1 7.7-7.9).
 *
 * Returns the transform from the viewport's user space to its parent's
 * and the viewport size its percentages resolve against (the viewBox
 * size when there is one).
 */
export function viewport_transform(
  view_box: string | null,
  preserve_aspect_ratio: string | null,
  x: number,
  y: number,
  width: number,
  height: number,
): [Affine, [number, number]] {
  const vb = _view_box(view_box);
  if (vb == null) {
    return [new Affine(undefined, undefined, undefined, undefined, x, y), [width, height]];
  }
  const [min_x, min_y, vb_w, vb_h] = vb;
  let sx = width / vb_w;
  let sy = height / vb_h;
  const tokens = split(py_or(preserve_aspect_ratio, "")).filter((t) => t !== "defer");
  const align = py_bool(tokens) ? tokens[0] : "xMidYMid";
  if (align !== "none") {
    const s = py_eq(tokens.slice(1, 2), ["slice"]) ? max([sx, sy]) : min([sx, sy]);
    sx = sy = s;
    const ax = dict_get(new Map<string, number>([["xMin", 0.0], ["xMid", 0.5], ["xMax", 1.0]]), align.slice(0, 4), 0.5);
    const ay = dict_get(new Map<string, number>([["YMin", 0.0], ["YMid", 0.5], ["YMax", 1.0]]), align.slice(4), 0.5);
    x += (width - vb_w * s) * ax;
    y += (height - vb_h * s) * ay;
  }
  return [new Affine(sx, undefined, undefined, sy, x - min_x * sx, y - min_y * sy), [vb_w, vb_h]];
}
