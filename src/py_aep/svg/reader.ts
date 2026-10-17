/**
 * Flatten an SVG file into absolute-coordinate drawables.
 *
 * `read_svg` walks the document depth-first, accumulating transforms and
 * inherited styles, expands `<use>` references, drops SMIL animation and
 * non-rendered content, and emits one {@link SvgDrawable} per leaf shape in
 * document (paint) order - mirroring what After Effects produces for an SVG
 * imported as cropped-comp layers.
 */

import { FLOAT32_MAX } from "../binary/bin_utils.ts";
import { DEFAULT_FONT_SIZE, LengthContext, local_name, parse_length, parse_number, parse_ratio } from "./_util.ts";
import { parse_color } from "./colors.ts";
import { canvas, viewport_transform } from "./document.ts";
import { UnsupportedSVGError } from "./errors.ts";
import { resolve_font as _resolve_font_impl } from "./fonts.ts";
/**
 * `monkeypatch.setattr(reader, "resolve_font", fn)` hook: ESM exports are
 * read-only, so the Python module-global lookup goes through this holder.
 */
export let _resolve_font_override: typeof _resolve_font_impl | null = null;
export function _set_resolve_font(fn: typeof _resolve_font_impl | null): void {
  _resolve_font_override = fn;
}
function resolve_font(...args: Parameters<typeof _resolve_font_impl>): ReturnType<typeof _resolve_font_impl> {
  return (_resolve_font_override ?? _resolve_font_impl)(...args);
}

import { type GradientDef, collect_gradients, resolve_gradient } from "./gradients.ts";
import type { RawSubpath } from "./path_data.ts";
import { cubics_to_subpath, element_subpaths } from "./shapes.ts";
import { type CssRule, parse_css, resolve_properties } from "./style.ts";
import { TextRun, outline_runs, outline_text_path } from "./text.ts";
import { Affine, parse_transform } from "./transform.ts";
import { GradientStop, SolidPaint, StrokeStyle, SvgDocument, SvgDrawable, type GradientPaint, type Subpath } from "./types.ts";
import {
  Path,
  encode,
  fspath,
  int,
  isdigit,
  lstrip,
  max,
  min,
  rstrip,
  strip,
  warn,
  zip,
  type PathLike,
} from "../../pyrt/index.ts";

import { Element, ParseError, fromstring } from "../../pyrt/etree.ts";

export type Bbox = [number, number, number, number];
export type Paint = SolidPaint | GradientPaint | null;

export const _DRAWABLE_TAGS: ReadonlySet<string> = new Set([
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
]);
export const _CONTAINER_TAGS: ReadonlySet<string> = new Set(["g", "a", "svg"]);
// Non-rendered or definition-only elements skipped without recursing into
// them for drawables (gradients/symbols are resolved on demand elsewhere).
export const _SKIP_TAGS: ReadonlySet<string> = new Set([
  "defs",
  "symbol",
  "title",
  "desc",
  "metadata",
  "style",
  "script",
  "linearGradient",
  "radialGradient",
  "pattern",
  "clipPath",
  "mask",
  "filter",
  "marker",
  "animate",
  "animateTransform",
  "animateMotion",
  "animateColor",
  "set",
  "mpath",
  "switch",
  "foreignObject",
]);
// Unsupported as standalone elements: `<tspan>`/`<textPath>` outside a `<text>`
// (invalid SVG); within a `<text>`, _visit_text renders both. Raster `<image>` is
// handled in _visit (skipped with a warning - it is not yet rendered).
export const _UNSUPPORTED_TAGS: ReadonlySet<string> = new Set(["tspan", "textPath"]);

// Bound on container nesting (<g>/<svg>/<use>) so a pathologically deep
// document raises a clean UnsupportedSVGError instead of a RecursionError.
// Each level costs ~2 Python frames (walk -> _visit -> walk), so this stays
// well under the interpreter's ~1000-frame recursion limit; no real SVG nests
// anywhere near this deep.
export const _MAX_SVG_DEPTH = 250;

// Maps are used (not object literals) so lookups of arbitrary attribute values
// such as "constructor" cannot hit Object.prototype.
export const _CAP: Map<string, number> = new Map([
  ["butt", 1],
  ["round", 2],
  ["square", 3],
]);
export const _JOIN: Map<string, number> = new Map([
  ["miter", 1],
  ["round", 2],
  ["bevel", 3],
]);
// Python `re.match` anchors at the start of the string, hence the `^`.
// `\s` is spelled out: CPython's str `\s` matches \x1c-\x1f and \x85 but not \ufeff.
export const _PY_WS = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
export const _URL_RE = new RegExp(`^url\\([${_PY_WS}]*#([^)${_PY_WS}]+)[${_PY_WS}]*\\)`);

/**
 * Parse an SVG file into a flattened {@link SvgDocument}.
 *
 * @param source - Path to an `.svg` file, or its raw bytes/markup.
 * @returns The flattened document (canvas size + drawables).
 * @throws UnsupportedSVGError For SVG features py_aep cannot import, and for
 *   a file that is not well-formed XML.
 */
export function read_svg(source: string | PathLike | Uint8Array): SvgDocument {
  let data: Uint8Array;
  if (source instanceof Uint8Array) {
    data = source.slice();
  } else if (typeof source === "string" && lstrip(source).startsWith("<")) {
    data = encode(source, "utf-8");
  } else {
    data = new Path(fspath(source)).read_bytes();
  }
  let root: Element;
  try {
    root = fromstring(data);
  } catch (exc) {
    if (!(exc instanceof ParseError)) throw exc;
    throw Object.assign(
      new UnsupportedSVGError(`Malformed SVG (not well-formed XML): ${exc.message}`),
      { cause: exc },
    );
  }
  if (local_name(root.tag) !== "svg") {
    throw new UnsupportedSVGError(`Root element is <${local_name(root.tag)}>, not <svg>`);
  }

  let [width, height, root_tf] = canvas(root);
  const reader = new _Reader(root);
  // The root <svg>'s own presentation attributes (e.g. fill="none") form
  // the inherited base for all children.
  const root_style = resolve_properties(new Map(), "svg", root.attrib, reader._css);
  root_tf = root_tf.multiply(parse_transform(root.get("transform", "")));
  reader._root_ctm = root_tf;
  reader._viewport = [width, height];
  const root_opacity = parse_ratio(root_style.get("opacity") ?? null, 1.0);
  const drawables = reader.walk(root, root_tf, root_style, root_opacity);
  return new SvgDocument(width, height, drawables);
}

export class _Reader {
  _gradients: Map<string, GradientDef>;
  _css: CssRule[];
  _by_id: Map<string, Element>;
  _root: Element;
  // Child -> parent map for reconstructing a by-id element's accumulated
  // transform (ElementTree has no parent links). Built lazily on first
  // _element_ctm call - only <textPath> needs it, so the common SVG with
  // no text path never pays for the whole-tree walk. `_root_ctm` is the
  // base (viewBox + root transform), set by read_svg before the walk.
  _parents: Map<Element, Element> | null;
  _root_ctm: Affine;
  _viewport: [number, number];
  _use_stack: string[];

  constructor(root: Element) {
    this._gradients = collect_gradients(root);
    this._css = _Reader._collect_css(root);
    this._by_id = new Map();
    for (const elem of root.iter()) {
      const eid = elem.get("id");
      if (eid) this._by_id.set(eid as string, elem);
    }
    this._root = root;
    this._parents = null;
    this._root_ctm = new Affine();
    this._viewport = [0.0, 0.0];
    this._use_stack = [];
  }

  static _collect_css(root: Element): CssRule[] {
    const rules: CssRule[] = [];
    for (const elem of root.iter()) {
      if (local_name(elem.tag) === "style" && elem.text) {
        rules.push(...parse_css(elem.text as string));
      }
    }
    return rules;
  }

  _element_ctm(elem: Element): Affine {
    /**
     * Accumulated transform of `elem`: the root base (viewBox + root
     * transform) composed with every ancestor's `transform` down to and
     * including `elem`'s own.
     */
    if (this._parents == null) {
      this._parents = new Map();
      for (const parent of this._root.iter()) {
        for (const child of parent) this._parents.set(child, parent);
      }
    }
    const chain: Element[] = [];
    let cur: Element | null = elem;
    while (cur != null && this._parents.has(cur)) {
      chain.push(cur);
      cur = this._parents.get(cur) ?? null;
    }
    let ctm = this._root_ctm;
    for (const node of [...chain].reverse()) {
      ctm = ctm.multiply(parse_transform(node.get("transform", "")));
    }
    return ctm;
  }

  walk(
    elem: Element,
    ctm: Affine,
    parent_style: Map<string, string>,
    opacity: number,
    depth = 0,
  ): SvgDrawable[] {
    if (depth > _MAX_SVG_DEPTH) throw new UnsupportedSVGError("SVG container nesting too deep");
    const out: SvgDrawable[] = [];
    for (const child of elem) {
      this._visit(child, ctm, parent_style, opacity, out, depth);
    }
    return out;
  }

  _visit(
    elem: Element,
    ctm: Affine,
    parent_style: Map<string, string>,
    opacity: number,
    out: SvgDrawable[],
    depth = 0,
  ): void {
    const tag = local_name(elem.tag);
    if (_SKIP_TAGS.has(tag)) return;
    if (tag === "image") {
      // Raster <image> is not rendered (AE drops it too). Unlike the
      // silent _SKIP_TAGS, warn once - it is visible content the author
      // expected to appear.
      warn("SVG <image> elements are not imported (skipped).");
      return;
    }
    if (_UNSUPPORTED_TAGS.has(tag)) throw new UnsupportedSVGError(`Unsupported element: <${tag}>`);

    const style = resolve_properties(parent_style, tag, elem.attrib, this._css);
    if ((style.get("display") ?? null) === "none") return;
    const local_tf = ctm.multiply(parse_transform(elem.get("transform", "")));
    // `opacity` is a non-inherited compositing factor; AE flattens an SVG
    // group/element opacity by multiplying it into the leaf's paint
    // opacity, so accumulate it down the tree and fold it into the leaf.
    const eff_opacity = opacity * parse_ratio(style.get("opacity") ?? null, 1.0);

    if (tag === "svg") {
      this._visit_viewport(elem, local_tf, style, eff_opacity, out, depth);
      return;
    }
    if (_CONTAINER_TAGS.has(tag)) {
      for (const d of this.walk(elem, local_tf, style, eff_opacity, depth + 1)) out.push(d);
      return;
    }
    if (tag === "use") {
      this._visit_use(elem, local_tf, style, eff_opacity, out, depth);
      return;
    }
    if (tag === "text") {
      this._visit_text(elem, local_tf, style, eff_opacity, out);
      return;
    }
    if (_DRAWABLE_TAGS.has(tag)) {
      const drawable = this._build_drawable(tag, elem, local_tf, style, eff_opacity);
      if (drawable != null) out.push(drawable);
      return;
    }
    // Unknown element: ignore (forward-compatible) but recurse in case
    // it wraps drawables.
    for (const d of this.walk(elem, local_tf, style, eff_opacity, depth + 1)) out.push(d);
  }

  _ctx(style: Map<string, string>): LengthContext {
    /**
     * What this element's percentage and `em` lengths resolve against:
     * the nearest viewport and its font size.
     */
    const font_size = parse_length(
      style.get("font-size") ?? null,
      DEFAULT_FONT_SIZE,
      DEFAULT_FONT_SIZE,
      DEFAULT_FONT_SIZE,
    );
    return new LengthContext(this._viewport[0], this._viewport[1], font_size);
  }

  _visit_viewport(
    elem: Element,
    ctm: Affine,
    style: Map<string, string>,
    opacity: number,
    out: SvgDrawable[],
    depth: number,
  ): void {
    /**
     * A nested `<svg>` is a new viewport (SVG 1.1 7.9): `x / y / width / height` place it (100 % of the parent viewport by default)
     * and its viewBox maps onto that box under `preserveAspectRatio`, as
     * AE 2026 imports it. Its content is not clipped (AE clips it).
     */
    const ctx = this._ctx(style);
    const x = parse_length(elem.get("x"), 0.0, ctx.width, ctx.font_size);
    const y = parse_length(elem.get("y"), 0.0, ctx.height, ctx.font_size);
    this._walk_viewport(elem, elem, ctm, style, opacity, out, depth, x, y);
  }

  _walk_viewport(
    viewport: Element,
    sizing: Element,
    ctm: Affine,
    style: Map<string, string>,
    opacity: number,
    out: SvgDrawable[],
    depth: number,
    x: number,
    y: number,
  ): void {
    /**
     * Walk the children of a viewport element (a nested `<svg>`, or the
     * `<symbol>` / `<svg>` a `<use>` instantiates), its viewBox mapped
     * onto the `x, y` box sized by `sizing`'s width / height (falling back
     * to the viewport's own, then 100 %).
     */
    const ctx = this._ctx(style);
    const width = parse_length(
      sizing.get("width") || viewport.get("width"),
      ctx.width,
      ctx.width,
      ctx.font_size,
    );
    const height = parse_length(
      sizing.get("height") || viewport.get("height"),
      ctx.height,
      ctx.height,
      ctx.font_size,
    );
    const [tf, size] = viewport_transform(
      viewport.get("viewBox"),
      viewport.get("preserveAspectRatio"),
      x,
      y,
      width,
      height,
    );
    const parent_viewport = this._viewport;
    this._viewport = size;
    try {
      for (const d of this.walk(viewport, ctm.multiply(tf), style, opacity, depth + 1)) out.push(d);
    } finally {
      this._viewport = parent_viewport;
    }
  }

  _visit_use(
    elem: Element,
    ctm: Affine,
    style: Map<string, string>,
    opacity: number,
    out: SvgDrawable[],
    depth = 0,
  ): void {
    const ref = elem.get("href") || elem.get("{http://www.w3.org/1999/xlink}href");
    if (!ref || !(ref as string).startsWith("#")) return;
    const target_id = (ref as string).slice(1);
    if (this._use_stack.includes(target_id)) {
      throw new UnsupportedSVGError(`Recursive <use> reference: #${target_id}`);
    }
    const target = this._by_id.get(target_id) ?? null;
    if (target == null) return;
    const ctx = this._ctx(style);
    const x = parse_length(elem.get("x"), 0.0, ctx.width, ctx.font_size);
    const y = parse_length(elem.get("y"), 0.0, ctx.height, ctx.font_size);
    const use_tf = ctm.multiply(new Affine(1.0, 0.0, 0.0, 1.0, x, y));
    this._use_stack.push(target_id);
    try {
      const t_tag = local_name(target.tag);
      if (t_tag === "symbol" || t_tag === "svg") {
        // The instance is a viewport sized by the <use> (AE 2026
        // maps a 10 x 10 symbol viewBox onto `width="50"`).
        this._walk_viewport(target, elem, use_tf, style, opacity, out, depth, 0.0, 0.0);
      } else {
        this._visit(target, use_tf, style, opacity, out, depth);
      }
    } finally {
      this._use_stack.pop();
    }
  }

  _visit_text(
    elem: Element,
    ctm: Affine,
    style: Map<string, string>,
    opacity: number,
    out: SvgDrawable[],
  ): void {
    // A <text> is outlined into vector shapes: its direct text and each
    // <tspan> become a run (carrying its own font/fill), laid out
    // left-to-right. <textPath> children are dispatched to _add_text_path;
    // a run with an absolute x starts a new anchor chunk (outline_runs).
    if ((style.get("visibility") ?? null) === "hidden") return;
    const runs: [TextRun, Map<string, string>][] = [];
    if (elem.text && strip(elem.text as string)) {
      const run = this._make_run(elem.text as string, style, null);
      if (run != null) runs.push([run, style]);
    }
    for (const child of elem) {
      const ctag = local_name(child.tag);
      if (ctag === "tspan") {
        const cstyle = resolve_properties(style, "tspan", child.attrib, this._css);
        if (child.text && strip(child.text as string)) {
          const run = this._make_run(child.text as string, cstyle, child);
          if (run != null) runs.push([run, cstyle]);
        }
      } else if (ctag === "textPath") {
        this._add_text_path(elem, child, style, opacity, out);
      }
      // Text after a child element (its `tail`) belongs to the parent.
      const tail = child.tail;
      if (tail && strip(tail as string)) {
        const run = this._make_run(tail as string, style, null);
        if (run != null) runs.push([run, style]);
      } else if (tail && !strip(tail as string) && runs.length > 0) {
        // A whitespace-only tail between two runs (e.g.
        // `<tspan>foo</tspan> <tspan>bar</tspan>`) is a significant SVG
        // space that collapses to one space. Fold it into the preceding
        // run so the pen advances by a space glyph before the next run,
        // rather than laying the runs out flush. A leading whitespace-
        // only tail (no prior run) is document-leading and dropped.
        const last_run = runs[runs.length - 1][0];
        if (!last_run.text.endsWith(" ")) last_run.text += " ";
      }
    }
    if (runs.length === 0) return;
    // Trim the whole sequence's leading/trailing whitespace (each run's
    // internal whitespace was already collapsed in _make_run); a single
    // space between runs stays significant.
    runs[0][0].text = lstrip(runs[0][0].text, " ");
    const last = runs[runs.length - 1][0];
    last.text = rstrip(last.text, " ");
    const origin_x = parse_number(elem.get("x", "0"));
    const origin_y = parse_number(elem.get("y", "0"));
    const anchor = strip(style.get("text-anchor") || "start");
    const per_run = outline_runs(
      runs.map(([r]) => r),
      origin_x,
      origin_y,
      ctm,
      anchor,
    );
    for (const [[, run_style], subpaths] of zip(runs, per_run)) {
      if (!subpaths?.length) continue;
      out.push(this._emit(subpaths, run_style, ctm, elem.get("id"), opacity));
    }
  }

  _make_run(text: string, style: Map<string, string>, elem: Element | null): TextRun | null {
    // Font is resolved from the cascaded/inherited style; position
    // attributes (x/y/dx/dy) come from the run's own element.
    text = _collapse_ws(text);
    const family = style.get("font-family") ?? "sans-serif";
    const weight = strip(style.get("font-weight") || "");
    const font_style = strip(style.get("font-style") || "");
    const bold = ["bold", "bolder"].includes(weight) || (isdigit(weight) && int(weight) >= 600);
    const italic = ["italic", "oblique"].includes(font_style);
    const resolved = resolve_font(family, { bold, italic });
    if (resolved == null) return null;
    const [font_path, font_number] = resolved;
    const abs_x =
      elem != null && elem.get("x") ? parse_number(elem.get("x")) : null;
    const abs_y =
      elem != null && elem.get("y") ? parse_number(elem.get("y")) : null;
    const dx = elem != null && elem.get("dx") ? parse_number(elem.get("dx")) : 0.0;
    const dy = elem != null && elem.get("dy") ? parse_number(elem.get("dy")) : 0.0;
    // TextRun fields in declaration order: text, font_path, font_size,
    // letter_spacing, abs_x, abs_y, dx, dy, anchor, font_number.
    return new TextRun(
      text,
      font_path,
      parse_number(style.get("font-size") || "16"),
      parse_number(style.get("letter-spacing") || "0"),
      abs_x,
      abs_y,
      dx,
      dy,
      strip(style.get("text-anchor") || "") || null,
      font_number,
    );
  }

  _add_text_path(
    text_elem: Element,
    tp_elem: Element,
    parent_style: Map<string, string>,
    opacity: number,
    out: SvgDrawable[],
  ): void {
    // A <textPath> lays its text along a referenced path's geometry, in the
    // path's own coordinate space (its accumulated transform).
    const href = tp_elem.get("href") || tp_elem.get("{http://www.w3.org/1999/xlink}href");
    if (!href || !(href as string).startsWith("#")) return;
    const target = this._by_id.get((href as string).slice(1)) ?? null;
    if (target == null || !(!!tp_elem.text && !!strip(tp_elem.text as string))) {
      return;
    }
    const ctm = this._element_ctm(target);
    const style = resolve_properties(parent_style, "textPath", tp_elem.attrib, this._css);
    const run = this._make_run(tp_elem.text as string, style, null);
    if (run == null) return;
    let path: RawSubpath[];
    try {
      path = element_subpaths(local_name(target.tag), target.attrib, this._ctx(style));
    } catch (e) {
      if (!(e instanceof UnsupportedSVGError)) throw e;
      return; // referenced element is not a path/basic shape
    }
    const raw_off = strip(tp_elem.get("startOffset") || "0");
    let off_abs: number;
    let off_frac: number | null;
    if (raw_off.endsWith("%")) {
      off_abs = 0.0;
      off_frac = parse_number(raw_off) / 100.0;
    } else {
      off_abs = parse_number(raw_off);
      off_frac = null;
    }
    const subpaths = outline_text_path(
      strip(_collapse_ws(tp_elem.text as string)),
      path,
      run.font_path,
      run.font_size,
      ctm,
      {
        font_number: run.font_number,
        start_offset: off_abs,
        start_offset_frac: off_frac,
        letter_spacing: run.letter_spacing,
      },
    );
    if (!subpaths?.length) return;
    out.push(this._emit(subpaths, style, ctm, text_elem.get("id"), opacity));
  }

  _build_drawable(
    tag: string,
    elem: Element,
    ctm: Affine,
    style: Map<string, string>,
    opacity: number,
  ): SvgDrawable | null {
    const raws = element_subpaths(tag, elem.attrib, this._ctx(style));
    const subpaths: Subpath[] = [];
    for (const raw of raws) {
      const sp = cubics_to_subpath(raw, ctm);
      if (sp != null) subpaths.push(sp);
    }
    if (subpaths.length === 0) return null;
    if ((style.get("visibility") ?? null) === "hidden") return null;

    // `opacity` already includes this element's own opacity (folded in by
    // the caller alongside every ancestor's), so use it directly.
    const drawable = this._emit(subpaths, style, ctm, elem.get("id"), opacity);
    if (tag === "line") {
      // A line has no interior, so its fill paints nothing; AE 2026
      // adds only the Stroke.
      drawable.fill = null;
    }
    return drawable;
  }

  _emit(
    subpaths: Subpath[],
    style: Map<string, string>,
    ctm: Affine,
    name: string | null,
    opacity: number,
  ): SvgDrawable {
    if (
      !subpaths.every((sp) =>
        [sp.vertices, sp.in_tangents, sp.out_tangents].every((points) =>
          points.every((point) => point.every((c) => Math.abs(c) <= FLOAT32_MAX)),
        ),
      )
    ) {
      // Shape paths store float32 points; a larger number (or one past
      // the float range, `1e400`, read as infinity) cannot be saved.
      throw new UnsupportedSVGError("SVG coordinate is out of range");
    }
    const bbox = _bbox(subpaths);
    return new SvgDrawable(
      subpaths,
      this._paint(style.get("fill") ?? "black", style.get("fill-opacity") ?? null, bbox, ctm),
      this._stroke(style, bbox, ctm),
      name,
      opacity,
    );
  }

  _paint(value: string | null, opacity: string | null, bbox: Bbox, ctm: Affine): Paint {
    /**
     * A fill or stroke paint, its `fill-opacity` / `stroke-opacity`
     * (`opacity`) folded into its alpha: a color's own, or every gradient
     * stop's. After Effects' own SVG import ignores both attributes
     * (AE 2026: a 0.5 stroke-opacity imports at 100 %).
     */
    if (value == null) return null;
    value = strip(value);
    if (value === "none") return null;
    const alpha = parse_ratio(opacity, 1.0);
    const url = _URL_RE.exec(value);
    if (url) {
      const gd = this._gradients.get(url[1]) ?? null;
      if (gd == null || !gd.stops?.length) {
        // Unknown paint server (pattern, missing gradient): no paint.
        return null;
      }
      const gradient = resolve_gradient(gd, bbox, ctm, this._viewport);
      gradient.stops = gradient.stops.map(
        (s) =>
          new GradientStop(s.offset, [s.color[0], s.color[1], s.color[2], s.color[3] * alpha]),
      );
      return gradient;
    }
    const color = parse_color(value);
    if (color == null) return null;
    return new SolidPaint([color[0], color[1], color[2], color[3] * alpha]);
  }

  _stroke(style: Map<string, string>, bbox: Bbox, ctm: Affine): StrokeStyle | null {
    const paint = this._paint(
      style.get("stroke") ?? "none",
      style.get("stroke-opacity") ?? null,
      bbox,
      ctm,
    );
    if (paint == null) return null;
    const ctx = this._ctx(style);
    // A percentage width refers to the viewport's normalized diagonal
    // (AE 2026: 5 % of a 200 x 100 viewBox is 7.906).
    const width =
      parse_length(style.get("stroke-width") ?? null, 1.0, ctx.diagonal, ctx.font_size) *
      ctm.mean_scale;
    if (width <= 0) return null;
    if (!Number.isFinite(width)) throw new UnsupportedSVGError("SVG stroke-width is out of range");
    const cap = _CAP.get(strip(style.get("stroke-linecap") || "")) ?? 1;
    const join = _JOIN.get(strip(style.get("stroke-linejoin") || "")) ?? 1;
    // SVG requires a miter limit >= 1 (AE's Miter Limit too); AE 2026
    // imports a smaller one clamped to 1.
    const miter = max([1.0, parse_number(style.get("stroke-miterlimit") ?? "4")]);
    const dashes = strip(style.get("stroke-dasharray") || "")
      .split(new RegExp(`[,${_PY_WS}]+`))
      .filter((t) => !!t && t !== "none")
      .map((t) => parse_number(t) * ctm.mean_scale);
    return new StrokeStyle(paint, width, cap, join, miter, dashes);
  }
}

export function _bbox(subpaths: Subpath[]): Bbox {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const sp of subpaths) {
    for (const [vx, vy] of sp.vertices) {
      xs.push(vx);
      ys.push(vy);
    }
  }
  if (xs.length === 0) return [0.0, 0.0, 0.0, 0.0];
  return [min(xs), min(ys), max(xs), max(ys)];
}

export const _WS_RE = new RegExp(`[${_PY_WS}]+`, "g");

/**
 * Collapse internal whitespace runs (incl. newlines/tabs) to one space.
 *
 * SVG default white-space handling renders a run of source whitespace as a
 * single space; without this, the indentation of a pretty-printed `<text>`
 * is laid out as leading glyph advances. Edge spaces are kept here and
 * trimmed once across the whole run sequence by the caller.
 */
export function _collapse_ws(text: string): string {
  return text.replace(_WS_RE, " ");
}
