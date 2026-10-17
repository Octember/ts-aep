/** Variable-font design-axis reading via fontTools. */

import * as fontkit from "fontkit";
import * as host from "../../pyrt/host.ts";

import { ValueError, float, str } from "../../pyrt/index.ts";
import type { PathLike } from "../../pyrt/index.ts";

export type _PathLike = PathLike;

/** One design axis of a variable font (an `fvar` table entry). */
export class FontDesignAxis {
  /** The 4-character axis tag (e.g. `wght`). */
  readonly tag: string;

  /** The axis display name from the font's name table (e.g. `Weight`). */
  readonly name: string;

  readonly min_value: number;
  readonly default_value: number;
  readonly max_value: number;

  constructor(tag: string, name: string, min_value: number, default_value: number, max_value: number) {
    this.tag = tag;
    this.name = name;
    this.min_value = min_value;
    this.default_value = default_value;
    this.max_value = max_value;
  }

  *[Symbol.iterator](): Generator<string | number> {
    yield this.tag;
    yield this.name;
    yield this.min_value;
    yield this.default_value;
    yield this.max_value;
  }
}

interface FvarAxisInfo {
  name?: string | null;
  min: number;
  default: number;
  max: number;
}

interface OpenedFont {
  fonts?: OpenedFont[] | null;
  directory: { tables: Record<string, unknown> };
  name?: unknown;
  variationAxes: Record<string, FvarAxisInfo>;
}

/**
 * Read the design axes of a variable font file.
 *
 * @param font_file - Path to the variable font file (`.ttf` / `.otf` / `.ttc`).
 * @param font_number - Face index within a TrueType Collection (0 for
 *   single-face files).
 *
 * @throws ValueError If the font has no `fvar` table (not a variable font).
 */
export function read_design_axes(font_file: _PathLike, font_number: number = 0): FontDesignAxis[] {
  // NOTE(port): fontTools lazy=True defers table reads; fontkit reads eagerly. Results are identical, only I/O cost differs.
  const opened = fontkit.create(host.fs.readFileSync(str(font_file)) as never) as unknown as OpenedFont;
  // TODO(port): fontTools raises on an out-of-range fontNumber; here an
  // out-of-range index yields undefined and fails later on property access.
  const font: OpenedFont | undefined = opened.fonts != null ? opened.fonts[font_number] : opened;
  if (font == null) {
    throw new Error(
      `specify a font number between 0 and ${opened.fonts!.length - 1} (inclusive)`,
    );
  }
  try {
    if (!("fvar" in font.directory.tables)) {
      throw new ValueError(`${str(font_file)} is not a variable font (it has no fvar table).`);
    }
    const name_table = "name" in font.directory.tables ? font.name : null;
    const axes: FontDesignAxis[] = [];
    // TODO(port): fontkit exposes variationAxes as an object keyed by tag, so
    // order follows JS key order; only a font whose fvar tag is an integer-like
    // string (e.g. "1234") would be reordered vs fvar table order.
    for (const [axis_tag, info] of Object.entries(font.variationAxes)) {
      let axis_name: string | null | undefined = null;
      if (name_table != null) {
        // TODO(port): fontTools getDebugName(axis.axisNameID) falls back across
        // name records and languages; fontkit's variationAxes name reads the
        // English record only. Differs for fonts lacking an English name record
        // for the axis (Python picks another language, fontkit gives no name).
        axis_name = info.name;
      }
      axes.push(
        new FontDesignAxis(
          axis_tag,
          (axis_name || axis_tag),
          float(info.min),
          float(info.default),
          float(info.max),
        ),
      );
    }
    return axes;
  } finally {
    // NOTE(port): font.close() has no twin; fontkit.openSync reads the whole file and holds no handle.
  }
}
