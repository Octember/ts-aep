/** Variable-font design-axis reading via fontTools. */

import * as fontkit from "fontkit";

import { ValueError, float, py_or, str } from "../../pyrt/index.ts";
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

/**
 * Read the design axes of a variable font file.
 *
 * @param font_file Path to the variable font file (`.ttf` / `.otf` / `.ttc`).
 * @param font_number Face index within a TrueType Collection (0 for
 *   single-face files).
 *
 * @throws ValueError If the font has no `fvar` table (not a variable font).
 */
export function read_design_axes(font_file: _PathLike, font_number: number = 0): FontDesignAxis[] {
  // TODO(port): fontTools TTFont(lazy=True) reads tables on demand; fontkit reads
  // the whole file eagerly. Parity holds for results, not for I/O cost.
  const opened: any = fontkit.openSync(str(font_file));
  // TODO(port): fontTools raises on an out-of-range fontNumber; here an
  // out-of-range index yields undefined and fails later on property access.
  const font: any = opened.fonts != null ? opened.fonts[font_number] : opened;
  try {
    if (!("fvar" in font.directory.tables)) {
      throw new ValueError(`${str(font_file)} is not a variable font (it has no fvar table).`);
    }
    const name_table = "name" in font.directory.tables ? font.name : null;
    const axes: FontDesignAxis[] = [];
    // TODO(port): fontkit's variationAxes is an object keyed by tag, so axis
    // order follows JS key order (integer-like tags would reorder). fvar tags are
    // 4-character registered names, so this does not occur in practice.
    for (const [axis_tag, info] of Object.entries<any>(font.variationAxes)) {
      let axis_name: string | null = null;
      if (name_table != null) {
        // TODO(port): fontTools getDebugName(axis.axisNameID) falls back across
        // name records and languages; fontkit's variationAxes name reads the
        // English record only.
        axis_name = info.name;
      }
      axes.push(
        new FontDesignAxis(
          axis_tag,
          py_or(axis_name, axis_tag) as string,
          float(info.min),
          float(info.default),
          float(info.max),
        ),
      );
    }
    return axes;
  } finally {
    // TODO(port): fontkit has no close(); the file is fully read at openSync, so no
    // handle is held. Python closes the fontTools reader here.
  }
}
