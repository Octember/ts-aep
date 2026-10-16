/** After Effects preferences, mirroring the ExtendScript `app.preferences`. */

import { PREFType } from "../enums/general.ts";
import { AutoKernType, ParagraphJustification } from "../enums/text_document.ts";
import { parse_comp_presets, type CompPreset } from "../parsers/comp_presets.ts";
import { PrefsFile, decode_pref_bool, decode_pref_number, decode_pref_string, find_prefs_file, parse_hex_value, parse_number_text } from "../parsers/prefs.ts";
import { validate_bool, validate_enum, validate_name, validate_number } from "./validators.ts";
import type { TextDocument } from "./text/text_document.ts";
import {
  Path,
  type PathLike,
  KeyError,
  TypeError_,
  ValueError,
  b,
  bytes_,
  decode,
  dict_get,
  float,
  getitem,
  int,
  len,
  py_bool,
  py_or,
  repr,
  round,
  sorted,
  split,
  str,
  strip,
  tkey,
  zip,
} from "../../pyrt/index.ts";

export const _validate_pref_type = validate_enum(PREFType);

// Tombstone marking a key removed by delete_pref (masks the file value).
export const _DELETED: unique symbol = Symbol("_DELETED");

export const _LABEL_INDICES_SECTION = "Label Preference Indices Section 5";

/**
 * Resolve a default label color index from the label preferences.
 *
 * Args:
 *     preferences: The project's [Preferences][].
 *     key: Key in the `Label Preference Indices Section 5` section
 *         (e.g. `Comp Label Index 2`).
 *     default: AE's factory value, used when no preferences directory
 *         was provided or the key is absent.
 */
export function label_index(preferences: Preferences, key: string, default_: number): number {
  const value = preferences.get_pref_as_number(
    _LABEL_INDICES_SECTION,
    key,
    PREFType.PREF_Type_MACHINE_INDEPENDENT,
    { default: default_ },
  );
  return int(value);
}

/**
 * Resolve AE's "Import Options Default Sequence FPS" preference.
 *
 * The frame rate AE assigns to imported image sequences (formats with
 * no native rate). AE's factory value is 30.
 */
export function default_sequence_fps(preferences: Preferences): number {
  const value = preferences.get_pref_as_number(
    "Import Options Preference Section",
    "Import Options Default Sequence FPS",
    PREFType.PREF_Type_MACHINE_INDEPENDENT,
    { default: 30.0 },
  );
  return float(value);
}

export const _CHOOSE_LAYER_SECTION = "Choose Layer Dialog";

// AE's PSD/PSB import-dialog popup indices, probed in AE 2026 by toggling
// each dropdown and re-reading the machine-specific prefs. These are dialog
// positions, NOT the `sspc` c9 byte enum - footage merge/ignore is reversed
// there ({merge:0, ignore:1} here vs the c9 {ignore:0, merge:1}). AE's own
// importFile follows the last sticky choice, so py_aep uses them to fill an
// unset ImportOptions field.
export const _PSD_COMP_LAYER_STYLES: Map<number, string> = new Map<number, string>([
  [0, "editable"],
  [1, "merge"],
]);
export const _PSD_FOOTAGE_LAYER_STYLES: Map<number, string> = new Map<number, string>([
  [0, "merge"],
  [1, "ignore"],
]);
export const _PSD_FOOTAGE_DIMENSIONS: Map<number, string> = new Map<number, string>([
  [0, "layer"],
  [1, "document"],
]);

/**
 * Resolve a `Choose Layer Dialog` popup index to its string value, or
 * `None` when the preference is unset (or holds an unknown index).
 */
export function _choose_layer_pref(preferences: Preferences, key: string, mapping: Map<number, string>): string | null {
  if (!preferences.have_pref(_CHOOSE_LAYER_SECTION, key, PREFType.PREF_Type_MACHINE_SPECIFIC)) {
    return null;
  }
  const idx = int(preferences.get_pref_as_number(_CHOOSE_LAYER_SECTION, key, PREFType.PREF_Type_MACHINE_SPECIFIC));
  return dict_get(mapping, idx);
}

/**
 * The sticky Layer Options choice for a PSD/PSB COMP import (`"editable"`
 * or `"merge"`), or `None` when the preference is unset.
 *
 * Mirrors the "PSD Comp Layer Styles Option v2" import-dialog preference
 * that AE's own `importFile` follows.
 */
export function psd_comp_layer_styles(preferences: Preferences): string | null {
  return _choose_layer_pref(preferences, "PSD Comp Layer Styles Option v2", _PSD_COMP_LAYER_STYLES);
}

/**
 * The sticky Layer Options choice for a single-layer PSD/PSB FOOTAGE
 * import (`"merge"` or `"ignore"`), or `None` when the preference is unset.
 *
 * Mirrors the "PSD Footage Layer Styles Option" import-dialog preference.
 */
export function psd_footage_layer_styles(preferences: Preferences): string | null {
  return _choose_layer_pref(preferences, "PSD Footage Layer Styles Option", _PSD_FOOTAGE_LAYER_STYLES);
}

/**
 * The sticky Footage Dimensions choice for a single-layer PSD/PSB FOOTAGE
 * import (`"document"` or `"layer"`), or `None` when the preference is unset.
 *
 * Mirrors the "PSD Dimensions Popup" import-dialog preference.
 */
export function psd_footage_dimensions(preferences: Preferences): string | null {
  return _choose_layer_pref(preferences, "PSD Dimensions Popup", _PSD_FOOTAGE_DIMENSIONS);
}

export const _TEXT_STYLE_SECTION = "Text Style Sheet";
export const _PARA_SHEET_SECTION = "Text Paragraph Sheet";
export const _TXT = PREFType.PREF_Type_MACHINE_SPECIFIC_TEXT;

// The horizontal/vertical scale preferences are percentages, while the
// document stores (and ExtendScript reports) a fraction.
export const _SCALE_PERCENT = 100.0;

// AE's factory Character/Paragraph panel values, used when the preference
// file is unavailable (a project parsed without an `ae_preferences_dir`).
export const _FACTORY_CHAR_STYLE = {
  font: "MyriadPro-Regular",
  font_size: 36.0,
  faux_bold: false,
  faux_italic: false,
  apply_fill: true,
  apply_stroke: false,
  // The full-precision value AE stores; the preference file mirrors it
  // rounded to six decimals, so a prefs-backed reset lands ~1e-7 away.
  fill_color: [0.92156994342804, 0.92156994342804, 0.92156994342804],
  stroke_color: [0.0, 0.0, 0.0],
  stroke_width: 1.0,
  stroke_over_fill: true,
  tracking: 0.0,
  tsume: 0.0,
  horizontal_scale: 1.0,
  vertical_scale: 1.0,
  baseline_shift: 0.0,
  auto_leading: true,
  auto_kern_type: AutoKernType.METRIC_KERN,
} as const;

// AE names the Character panel's kerning modes in prose.
export const _AUTO_KERN_BY_PREF: Map<string, AutoKernType> = new Map<string, AutoKernType>([
  ["No Auto Kerning", AutoKernType.NO_AUTO_KERN],
  ["Metric Auto Kerning", AutoKernType.METRIC_KERN],
  ["Optical Auto Kerning", AutoKernType.OPTICAL_KERN],
]);
export const _FACTORY_PARA_STYLE = {
  justification: ParagraphJustification.LEFT_JUSTIFY,
  first_line_indent: 0.0,
  start_indent: 0.0,
  end_indent: 0.0,
  space_before: 0.0,
  space_after: 0.0,
  hanging_roman: false,
  every_line_composer: false,
} as const;

// AE writes the horizontal half of "Justification" before a `|`.
export const _JUSTIFICATION_BY_PREF: Map<string, ParagraphJustification> = new Map<string, ParagraphJustification>([
  ["Left", ParagraphJustification.LEFT_JUSTIFY],
  ["Center", ParagraphJustification.CENTER_JUSTIFY],
  ["Right", ParagraphJustification.RIGHT_JUSTIFY],
]);

/** Build `(number, flag)` readers over one machine-specific text sheet. */
export function _sheet_readers(
  preferences: Preferences,
  section: string,
): [(key: string, fallback: number) => number, (key: string, fallback: boolean) => boolean] {
  function number(key: string, fallback: number): number {
    const value = preferences.get_pref_as_number(section, key, _TXT, { default: fallback });
    return float(value);
  }

  function flag(key: string, fallback: boolean): boolean {
    return preferences.get_pref_as_bool(section, key, _TXT, { default: fallback });
  }

  return [number, flag];
}

/**
 * AE's Character-panel defaults - the `["Text Style Sheet"]` section of
 * the machine-specific text preferences.
 *
 * This is the style `TextDocument.reset_char_style()` restores and the
 * style `addText` gives a new layer. Keys map to `TextDocument`
 * attributes. Missing preferences fall back to AE's factory values.
 */
export function default_character_style(preferences: Preferences): Record<string, any> {
  const [number, flag] = _sheet_readers(preferences, _TEXT_STYLE_SECTION);
  const factory = _FACTORY_CHAR_STYLE;
  const fill = [
    number("Fill Red", factory.fill_color[0]),
    number("Fill Green", factory.fill_color[1]),
    number("Fill Blue", factory.fill_color[2]),
  ];
  const stroke = [
    number("Stroke Red", factory.stroke_color[0]),
    number("Stroke Green", factory.stroke_color[1]),
    number("Stroke Blue", factory.stroke_color[2]),
  ];
  return {
    font: preferences.get_pref_as_string(_TEXT_STYLE_SECTION, "Font PostScript Name", PREFType.PREF_Type_MACHINE_SPECIFIC_TEXT, {
      default: factory.font,
    }),
    font_size: number("Size", factory.font_size),
    faux_bold: flag("Synthetic Bold", factory.faux_bold),
    faux_italic: flag("Synthetic Italic", factory.faux_italic),
    apply_fill: flag("Render Fill", factory.apply_fill),
    apply_stroke: flag("Render Stroke", factory.apply_stroke),
    fill_color: fill,
    stroke_color: stroke,
    stroke_width: number("Stroke Width", factory.stroke_width),
    stroke_over_fill: flag("Stroke Over Fill", factory.stroke_over_fill),
    tracking: number("Tracking", factory.tracking),
    tsume: number("Tsume", factory.tsume),
    horizontal_scale: number("Horizontal Scale", factory.horizontal_scale * _SCALE_PERCENT) / _SCALE_PERCENT,
    vertical_scale: number("Vertical Scale", factory.vertical_scale * _SCALE_PERCENT) / _SCALE_PERCENT,
    baseline_shift: number("Baseline Shift", factory.baseline_shift),
    auto_leading: flag("Auto Leading", factory.auto_leading),
    auto_kern_type: dict_get(
      _AUTO_KERN_BY_PREF,
      strip(
        preferences.get_pref_as_string(_TEXT_STYLE_SECTION, "Auto Kerning Type", PREFType.PREF_Type_MACHINE_SPECIFIC_TEXT, {
          default: "Metric Auto Kerning",
        }),
      ),
      factory.auto_kern_type,
    ),
  };
}

/**
 * AE's Paragraph-panel defaults - the `["Text Paragraph Sheet"]`
 * section of the machine-specific text preferences.
 *
 * This is the style `TextDocument.reset_paragraph_style()` restores.
 * Note that hyphenation has no entry in this sheet, which is why After
 * Effects leaves `auto_hyphenate` untouched on a reset.
 */
export function default_paragraph_style(preferences: Preferences): Record<string, any> {
  const [number, flag] = _sheet_readers(preferences, _PARA_SHEET_SECTION);
  const factory = _FACTORY_PARA_STYLE;
  const raw_justification = preferences.get_pref_as_string(_PARA_SHEET_SECTION, "Justification", PREFType.PREF_Type_MACHINE_SPECIFIC_TEXT, {
    default: "Left",
  });
  const justification = dict_get(
    _JUSTIFICATION_BY_PREF,
    strip(split(raw_justification, "|")[0]),
    factory.justification,
  );
  return {
    justification: justification,
    first_line_indent: number("First Line Indent", factory.first_line_indent),
    start_indent: number("Start Indent", factory.start_indent),
    end_indent: number("End Indent", factory.end_indent),
    space_before: number("Space Before", factory.space_before),
    space_after: number("Space After", factory.space_after),
    hanging_roman: flag("Roman Hanging Punctuation", factory.hanging_roman),
    every_line_composer: flag("Every-line Composer", factory.every_line_composer),
  };
}

/**
 * Parse a `"value/scale"` default-out-point preference into seconds.
 *
 * Returns None for the `0/0` factory sentinel (or a missing/malformed
 * value), meaning "composition duration". Semantics probed in AE 2026:
 * `75/25` gives new layers a 3-second span.
 */
export function _default_out_point(preferences: Preferences, key: string): number | null {
  const raw = preferences.get_pref_as_string("Main Pref Section v2", key, PREFType.PREF_Type_MACHINE_INDEPENDENT, {
    default: "0/0",
  });
  const parts = split(raw, "/");
  if (len(parts) !== 2) return null;
  // try/except ValueError around float(): None when either half is malformed.
  const value_scale = (() => {
    try {
      return [float(parts[0]), float(parts[1])] as const;
    } catch (e) {
      if (e instanceof ValueError) return null;
      throw e;
    }
  })();
  if (value_scale == null) return null;
  const [value, scale] = value_scale;
  if (scale === 0 || value <= 0) return null;
  return value / scale;
}

/**
 * Apply the AE "Text Style Sheet" preferences to a new text document.
 *
 * AE reads the machine-specific text style sheet once at startup and
 * applies its character-level fields to every scripted `addText` layer;
 * the paragraph sheet is NOT applied (scripted text is always
 * left-justified). Probed in AE 2026 via disk-edited preferences.
 *
 * Only values that differ from the document's current state are
 * written, so a factory style sheet leaves the baked template bytes
 * untouched. The font is taken from "Font PostScript Name" as written
 * by AE (AE itself validates the family/style/technology tuple and
 * falls back to Myriad Pro when it is incoherent; a sheet written by
 * AE is coherent by construction).
 */
export function apply_text_style_prefs(document: TextDocument, preferences: Preferences): void {
  function number(key: string): number | null {
    if (!preferences.have_pref(_TEXT_STYLE_SECTION, key, _TXT)) return null;
    return preferences.get_pref_as_number(_TEXT_STYLE_SECTION, key, _TXT);
  }

  function differs(current: number | null, new_: number): boolean {
    // Absent COS keys read as None and mean the field's zero default.
    // AE writes the sheet with 6 decimals, so sub-1e-6 deltas are
    // representation rounding (e.g. 235/255 vs "0.921569"), not edits.
    return Math.abs((current != null ? current : 0.0) - new_) > 1e-6;
  }

  const font = preferences.have_pref(_TEXT_STYLE_SECTION, "Font PostScript Name", _TXT)
    ? preferences.get_pref_as_string(_TEXT_STYLE_SECTION, "Font PostScript Name", _TXT)
    : null;
  if (py_bool(font) && document.font !== font) {
    document.font = font;
  }

  const size = number("Size");
  if (size != null && size > 0 && differs(document.font_size, size)) {
    document.font_size = size;
  }

  const fill = [number("Fill Red"), number("Fill Green"), number("Fill Blue")];
  if (!fill.includes(null)) {
    const current_fill = py_or(document.fill_color, [0.0, 0.0, 0.0]);
    if (zip(current_fill, fill).some(([c, n]) => differs(c, float(n)))) {
      document.fill_color = fill.map((n) => float(n));
    }
  }

  const tracking = number("Tracking");
  if (tracking != null && differs(document.tracking, tracking)) {
    // tracking is an integer field, unlike the float Size/Baseline Shift.
    document.tracking = round(tracking);
  }

  const baseline_shift = number("Baseline Shift");
  if (baseline_shift != null && differs(document.baseline_shift, baseline_shift)) {
    document.baseline_shift = baseline_shift;
  }

  if (preferences.have_pref(_TEXT_STYLE_SECTION, "Render Fill", _TXT)) {
    const apply_fill = preferences.get_pref_as_bool(_TEXT_STYLE_SECTION, "Render Fill", _TXT);
    if (py_bool(document.apply_fill) !== apply_fill) {
      document.apply_fill = apply_fill;
    }
  }

  if (preferences.have_pref(_TEXT_STYLE_SECTION, "Render Stroke", _TXT)) {
    const apply_stroke = preferences.get_pref_as_bool(_TEXT_STYLE_SECTION, "Render Stroke", _TXT);
    if (py_bool(document.apply_stroke) !== apply_stroke) {
      document.apply_stroke = apply_stroke;
    }
    // Stroke width/color were probed only with the stroke rendered;
    // leave them untouched when the sheet keeps the stroke off so the
    // factory sheet stays byte-identical to the baked template.
    if (apply_stroke) {
      const stroke_width = number("Stroke Width");
      if (stroke_width != null && differs(document.stroke_width, stroke_width)) {
        document.stroke_width = stroke_width;
      }
      const stroke = [number("Stroke Red"), number("Stroke Green"), number("Stroke Blue")];
      if (!stroke.includes(null)) {
        const current = py_or(document.stroke_color, [0.0, 0.0, 0.0]);
        if (zip(current, stroke).some(([c, n]) => differs(c, float(n)))) {
          document.stroke_color = stroke.map((n) => float(n));
        }
      }
    }
  }
}

/**
 * Default span of new still-footage layers, in seconds.
 *
 * None means "composition duration" (the factory `0/0` sentinel).
 */
export function default_still_out_point(preferences: Preferences): number | null {
  return _default_out_point(preferences, "Pref_DEFAULT_STILL_OUT_POINT v2");
}

/**
 * Default span of new sourceless layers (solid, null, text, shape,
 * camera, light), in seconds.
 *
 * None means "composition duration" (the factory `0/0` sentinel).
 */
export function default_synthetic_out_point(preferences: Preferences): number | null {
  return _default_out_point(preferences, "Pref_DEFAULT_SYNTHETIC_OUT_POINT v2");
}

// TODO(port): Python's `type(x).__name__` has no pyrt shim; this covers the JS shapes the
// setters below can receive. int vs float cannot be told apart for integral JS numbers.
export function py_type_name(x: unknown): string {
  if (x == null) return "NoneType";
  if (typeof x === "boolean") return "bool";
  if (typeof x === "number") return Number.isInteger(x) ? "int" : "float";
  if (typeof x === "string") return "str";
  if (x instanceof Uint8Array) return "bytes";
  if (Array.isArray(x)) return "list";
  if (x instanceof Map) return "dict";
  return (x as any).constructor?.name ?? "object";
}

/**
 * The Preferences object provides an easy way to manage internal AE
 * preferences, such as you find in After Effects' Preferences menu. It
 * is accessed through the `app.preferences` attribute.
 *
 * Preferences are identified by section and key within the file, and
 * each key name is associated with a value.
 *
 * Differences from ExtendScript:
 *
 * - The preference `.txt` files are read-only: `set_pref_as_*` writes
 *   to an in-memory override layer that takes precedence over the
 *   files, and there is no `save_to_disk()`. Overrides last for the
 *   lifetime of this object and never modify the files.
 * - `getPrefAsLong` / `getPrefAsFloat` are merged into a single
 *   [get_pref_as_number][] (Python does not need the distinction).
 * - Getters accept an optional `default` returned when the key is
 *   absent instead of raising `KeyError`.
 *
 * See: https://ae-scripting.docsforadobe.dev/other/preferences/
 *
 * Example:
 *     ```python
 *     import py_aep
 *     from py_aep.enums import PREFType
 *
 *     app = py_aep.parse("project.aep", ae_preferences_dir="...")
 *     fps = app.preferences.get_pref_as_number(
 *         "Import Options Preference Section",
 *         "Import Options Default Sequence FPS",
 *         PREFType.PREF_Type_MACHINE_INDEPENDENT,
 *     )
 *     ```
 */
export class Preferences {
  declare _prefs_dir: Path | null;
  declare _files: Map<PREFType, PrefsFile | null>;
  declare _overrides: Map<string, any>;

  constructor(prefs_dir: PathLike | null = null) {
    this._prefs_dir = prefs_dir != null ? new Path(prefs_dir) : null;
    this._files = new Map();
    this._overrides = new Map();
  }

  /** Lazily parse the preference file for `pref_type` (None if absent). */
  _file(pref_type: PREFType): PrefsFile | null {
    if (!this._files.has(pref_type)) {
      const path = this._prefs_dir != null ? find_prefs_file(this._prefs_dir, pref_type) : null;
      this._files.set(pref_type, path ? PrefsFile.from_path(path) : null);
    }
    return getitem(this._files, pref_type);
  }

  _raw(section_name: string, key_name: string, pref_type: PREFType): string | null {
    const prefs_file = this._file(pref_type);
    if (prefs_file == null) return null;
    return prefs_file.get_raw(section_name, key_name);
  }

  /**
   * Return `(found, value, is_override)`.
   *
   * `value` is a typed Python value when `is_override` is `True`,
   * otherwise the raw pref-file text (AE's mixed hex/ASCII encoding).
   */
  _resolve(section_name: string, key_name: string, pref_type: PREFType): [boolean, any, boolean] {
    validate_name(section_name);
    validate_name(key_name);
    _validate_pref_type(pref_type);
    const key = [PREFType.of(pref_type), section_name, key_name] as const;
    if (this._overrides.has(tkey(...key))) {
      const value = getitem(this._overrides, tkey(...key));
      if (value === _DELETED) return [false, null, false];
      return [true, value, true];
    }
    const raw = this._raw(section_name, key_name, key[0]);
    if (raw == null) return [false, null, false];
    return [true, raw, false];
  }

  _missing(section_name: string, key_name: string, pref_type: PREFType): KeyError {
    return new KeyError(
      `no preference ${repr(key_name)} in section ${repr(section_name)} (${PREFType.name_of(PREFType.of(pref_type))})`,
    );
  }

  /**
   * The value of the given preference as a number.
   *
   * Merges ExtendScript's `getPrefAsLong` and `getPrefAsFloat`:
   * integral values return `int`, others `float`.
   *
   * Args:
   *     section_name: The name of a preferences section.
   *     key_name: The key name of the preference.
   *     pref_type: The preference file the preference is read from.
   *     default: Returned when the key is absent (otherwise a missing
   *         key raises `KeyError`).
   */
  get_pref_as_number(
    section_name: string,
    key_name: string,
    pref_type: PREFType = PREFType.PREF_Type_MACHINE_SPECIFIC,
    kw: { default?: number | null } = {},
  ): number {
    const { default: default_ = null } = kw;
    const [found, value, is_override] = this._resolve(section_name, key_name, pref_type);
    if (!found) {
      if (default_ != null) return default_;
      throw this._missing(section_name, key_name, pref_type);
    }
    if (!is_override) return decode_pref_number(value);
    if (typeof value === "boolean") return int(value);
    if (typeof value === "number") return value;
    return parse_number_text(value);
  }

  /**
   * The value of the given preference as a boolean.
   *
   * Args:
   *     section_name: The name of a preferences section.
   *     key_name: The key name of the preference.
   *     pref_type: The preference file the preference is read from.
   *     default: Returned when the key is absent (otherwise a missing
   *         key raises `KeyError`).
   */
  get_pref_as_bool(
    section_name: string,
    key_name: string,
    pref_type: PREFType = PREFType.PREF_Type_MACHINE_SPECIFIC,
    kw: { default?: boolean | null } = {},
  ): boolean {
    const { default: default_ = null } = kw;
    const [found, value, is_override] = this._resolve(section_name, key_name, pref_type);
    if (!found) {
      if (default_ != null) return default_;
      throw this._missing(section_name, key_name, pref_type);
    }
    if (!is_override) return decode_pref_bool(value);
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    return parse_number_text(value) !== 0;
  }

  /**
   * The value of the given preference as a string.
   *
   * Args:
   *     section_name: The name of a preferences section.
   *     key_name: The key name of the preference.
   *     pref_type: The preference file the preference is read from.
   *     default: Returned when the key is absent (otherwise a missing
   *         key raises `KeyError`).
   */
  get_pref_as_string(
    section_name: string,
    key_name: string,
    pref_type: PREFType = PREFType.PREF_Type_MACHINE_SPECIFIC,
    kw: { default?: string | null } = {},
  ): string {
    const { default: default_ = null } = kw;
    const [found, value, is_override] = this._resolve(section_name, key_name, pref_type);
    if (!found) {
      if (default_ != null) return default_;
      throw this._missing(section_name, key_name, pref_type);
    }
    if (!is_override) return decode_pref_string(value);
    if (typeof value === "boolean") return str(int(value));
    // TODO(port): Python str(float) keeps a trailing ".0" for float overrides; JS cannot tell 30.0 from 30.
    if (typeof value === "number") return str(value);
    return value as string;
  }

  /**
   * Override the given preference with a number value.
   *
   * The override is in-memory only; the preference file on disk is
   * never modified. Merges ExtendScript's `savePrefAsLong` and
   * `savePrefAsFloat`.
   *
   * Args:
   *     section_name: The name of a preferences section.
   *     key_name: The key name of the preference.
   *     value: The new numeric value.
   *     pref_type: The preference file the preference belongs to.
   */
  set_pref_as_number(
    section_name: string,
    key_name: string,
    value: number,
    pref_type: PREFType = PREFType.PREF_Type_MACHINE_SPECIFIC,
  ): void {
    validate_name(section_name);
    validate_name(key_name);
    _validate_pref_type(pref_type);
    // TODO(port): Python's isinstance(value, (int, float)) also admits bool (bool subclasses int).
    if (typeof value !== "number" && typeof value !== "boolean") {
      throw new TypeError_(`expected a number, got ${py_type_name(value)}`);
    }
    validate_number(value); // rejects NaN/inf
    this._overrides.set(tkey(PREFType.of(pref_type), section_name, key_name), value);
  }

  /**
   * Override the given preference with a boolean value.
   *
   * The override is in-memory only; the preference file on disk is
   * never modified.
   *
   * Args:
   *     section_name: The name of a preferences section.
   *     key_name: The key name of the preference.
   *     value: The new boolean value.
   *     pref_type: The preference file the preference belongs to.
   */
  set_pref_as_bool(
    section_name: string,
    key_name: string,
    value: boolean,
    pref_type: PREFType = PREFType.PREF_Type_MACHINE_SPECIFIC,
  ): void {
    validate_name(section_name);
    validate_name(key_name);
    _validate_pref_type(pref_type);
    validate_bool(value);
    this._overrides.set(tkey(PREFType.of(pref_type), section_name, key_name), value);
  }

  /**
   * Override the given preference with a string value.
   *
   * The override is in-memory only; the preference file on disk is
   * never modified.
   *
   * Args:
   *     section_name: The name of a preferences section.
   *     key_name: The key name of the preference.
   *     value: The new string value.
   *     pref_type: The preference file the preference belongs to.
   */
  set_pref_as_string(
    section_name: string,
    key_name: string,
    value: string,
    pref_type: PREFType = PREFType.PREF_Type_MACHINE_SPECIFIC,
  ): void {
    validate_name(section_name);
    validate_name(key_name);
    _validate_pref_type(pref_type);
    if (typeof value !== "string") {
      throw new TypeError_(`expected a string, got ${py_type_name(value)}`);
    }
    this._overrides.set(tkey(PREFType.of(pref_type), section_name, key_name), value);
  }

  /**
   * Whether the given preference exists (override or file value).
   *
   * Args:
   *     section_name: The name of a preferences section.
   *     key_name: The key name of the preference.
   *     pref_type: The preference file the preference is read from.
   */
  have_pref(
    section_name: string,
    key_name: string,
    pref_type: PREFType = PREFType.PREF_Type_MACHINE_SPECIFIC,
  ): boolean {
    const [found] = this._resolve(section_name, key_name, pref_type);
    return found;
  }

  /**
   * Delete the given preference from this object's view.
   *
   * The file value (if any) is masked, not removed from disk:
   * [have_pref][] returns `False` and getters fall back to their
   * `default` afterwards.
   *
   * Args:
   *     section_name: The name of a preferences section.
   *     key_name: The key name of the preference.
   *     pref_type: The preference file the preference belongs to.
   */
  delete_pref(
    section_name: string,
    key_name: string,
    pref_type: PREFType = PREFType.PREF_Type_MACHINE_SPECIFIC,
  ): void {
    validate_name(section_name);
    validate_name(key_name);
    _validate_pref_type(pref_type);
    this._overrides.set(tkey(PREFType.of(pref_type), section_name, key_name), _DELETED);
  }

  /**
   * Decoded bytes of a binary preference value, or None when absent.
   *
   * File layer only - `set_pref_as_*` overrides are not consulted
   * (binary blobs cannot be expressed through the typed setters).
   */
  _get_bytes(section_name: string, key_name: string, pref_type: PREFType): Uint8Array | null {
    const prefs_file = this._file(pref_type);
    const raw = prefs_file ? prefs_file.get_raw(section_name, key_name) : null;
    return raw != null ? parse_hex_value(raw) : null;
  }

  /** Reload preferences from disk, discarding in-memory overrides. */
  reload(): void {
    this._files.clear();
    this._overrides.clear();
  }

  /**
   * The New Composition presets (py_aep extension, not in
   * ExtendScript).
   *
   * Parsed from the "Composition Presets Section v11" of the
   * composition preference file; menu separators are skipped and
   * `set_pref_as_*` overrides are not consulted. Empty when no
   * preferences directory was provided.
   */
  composition_presets(): CompPreset[] {
    const prefs_file = this._file(PREFType.PREF_Type_MACHINE_INDEPENDENT_COMPOSITION);
    if (prefs_file == null) return [];
    return parse_comp_presets(prefs_file);
  }

  /**
   * The "File Name and Location" template presets as a
   * `{name: template}` mapping (py_aep extension, not in ExtendScript).
   *
   * Parsed from the "Output File Name Template Presets Section v6"
   * of the machine-specific preference file (e.g. `Comp Name` ->
   * `[compName].[fileExtension]`); `set_pref_as_*` overrides are not
   * consulted. Empty when no preferences directory was provided.
   */
  output_name_template_presets(): Map<string, string> {
    const prefs_file = this._file(PREFType.PREF_Type_MACHINE_SPECIFIC);
    if (prefs_file == null) return new Map();
    const section = prefs_file.section("Output File Name Template Presets Section v6");
    const presets = new Map<string, string>();
    for (const key of sorted([...section.keys()])) {
      // Each entry is `<name> NUL <template> NUL` in AE's mixed
      // hex/ASCII encoding.
      const parts = bytes_.split(parse_hex_value(getitem(section, key)), b("\x00")).filter((p) => py_bool(p));
      if (len(parts) >= 2) {
        const name = decode(parts[0], "utf-8", "replace");
        presets.set(name, decode(parts[1], "utf-8", "replace"));
      }
    }
    return presets;
  }
}
