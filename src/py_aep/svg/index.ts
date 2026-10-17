/**
 * SVG reading for `ImportAsType.COMP_CROPPED_LAYERS`.
 *
 * After Effects converts an imported SVG into a single shape layer whose
 * Contents hold one vector group per leaf drawable, with every ancestor
 * `<g>` transform baked into the geometry and SMIL animation discarded.
 * This package mirrors that: `read_svg()` flattens an SVG document into a
 * list of absolute-coordinate {@link py_aep.svg.types.SvgDrawable | SvgDrawable}
 * objects that the import builder turns into shape groups.
 */

export { UnsupportedSVGError } from "./errors.ts";
export { read_svg } from "./reader.ts";
export {
  GradientPaint,
  GradientStop,
  SolidPaint,
  StrokeStyle,
  Subpath,
  SvgDocument,
  SvgDrawable,
} from "./types.ts";
