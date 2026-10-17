/** Font object model for After Effects text layers. */

import { TypeError_, descriptor, is_real, split, str, instance_dict } from "../../../pyrt/index.ts";
import { CosField } from "../../cos/descriptors.ts";

/** Decode the COS design vector (16.16 fixed-point ints) to floats. */
export function _design_vector_from_cos(raw: number[]): number[] {
  if (raw == null || typeof (raw as any)[Symbol.iterator] !== "function") {
    throw new TypeError_("object is not iterable");
  }
  return Array.from(raw, (v: any) => {
    // Python `str / float` raises TypeError (JS would yield NaN)
    if (!is_real(v) && typeof v !== "boolean") {
      throw new TypeError_("unsupported operand type(s) for /");
    }
    return (v as any) / 65536.0;
  });
}

/**
 * Provides information about a specific font.
 *
 * The Font object provides information about a specific font, along with
 * the font technology used, helping disambiguate when multiple fonts
 * sharing the same PostScript name are installed on the system.
 *
 * ```python
 * from py_aep import parse
 *
 * app = parse("project.aep")
 * comp = app.project.compositions[0]
 * font = comp.text_layers[0].text.source_text.value.font_object
 * print(font.post_script_name)
 * ```
 *
 * **Note:** 
 * This functionality was added in After Effects 24.0.
 *
 * @example
 * @see https://ae-scripting.docsforadobe.dev/text/fontobject/
 */
export class FontObject {
  /** The PostScript name of the font. Read-only. */
  declare post_script_name: string;

  /** The version number of the font. Read-only. */
  declare version: string | null;

  /**
   * For variable fonts, an ordered array with a length matching the
   * number of design axes defined by the font. `null` for non-variable
   * fonts. Read-only.
   *
   * Stored in the file as 16.16 fixed-point integers; exposed as floats
   * (e.g. `[700.0, 87.5]`).
   */
  declare design_vector: number[] | null;

  declare _font_data: Map<string, any>;
  declare _font_entry: Map<string, any> | null;

  /** Returns `true` if the font is a variable font. Read-only. */
  get has_design_axes(): boolean {
    return this.design_vector != null;
  }

  /**
   * The family prefix of the variable font. For example, the family
   * of the PostScript name `SFPro-Bold` is `SFPro`. `null` for
   * non-variable fonts. Read-only.
   */
  get family_prefix(): string | null {
    if (!this.has_design_axes) return null;
    return split(this.post_script_name, "-", 1)[0];
  }

  constructor(kw: {
    _font_data: Map<string, any>;
    _font_entry?: Map<string, any> | null;
    post_script_name?: string | null;
    version?: string | null;
  }) {
    const { _font_data, _font_entry = null, post_script_name = null, version = null } = kw;
    this._font_data = _font_data;
    this._font_entry = _font_entry;
    if (post_script_name != null) {
      instance_dict(this).set("post_script_name", post_script_name);
    }
    if (version != null) {
      instance_dict(this).set("version", version);
    }
  }
}

descriptor(
  FontObject,
  "post_script_name",
  new CosField<string>("_font_data", "0", { transform: str, default: "" }),
);
descriptor(
  FontObject,
  "version",
  new CosField<string | null>("_font_data", "5", { transform: str, default: null }),
);
descriptor(
  FontObject,
  "design_vector",
  new CosField<number[] | null>("_font_data", "4", {
    transform: _design_vector_from_cos,
    read_only: true,
  }),
);
