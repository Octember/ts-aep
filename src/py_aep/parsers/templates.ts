/**
 * Parse render queue templates from After Effects preferences files.
 *
 * AE stores render settings and output module templates in text-based
 * preference files under the user's AppData directory:
 *
 * - `Adobe After Effects <ver> Prefs-indep-render.txt` - render settings
 * - `Adobe After Effects <ver> Prefs-indep-output.txt` - output module templates
 *
 * The output file also contains the "Output File Info Preference Section" with
 * Rouu chunk data (154 bytes per entry) for each output module template.
 */

import {
  b,
  bytes_,
  concat,
  decode,
  dict_get,
  enumerate,
  floordiv,
  int,
  len,
  py_assert,
  py_bool,
  range,
  rstrip,
  split,
  strip,
} from "../../pyrt/index.ts";
import type { Path } from "../../pyrt/index.ts";
import { OutputModuleSettingsItem, RenderSettingsItem } from "../binary/render_chunks.ts";
import { collapse_continuation_lines, parse_hex_value } from "./prefs.ts";

// Render settings prefs format:
// RenderSettingsItem is 2182 bytes in prefs (2246 in AEP, difference = 64).
const _RS_PREFS_ITEM_SIZE = 2182;
const _RS_AEP_ITEM_SIZE = 2246;
const _RS_ITEM_SIZE_DIFF = _RS_AEP_ITEM_SIZE - _RS_PREFS_ITEM_SIZE;
const _HEADER_SIZE = 32; // bytes before first item

// Output module prefs format:
// OutputModuleSettingsItem is 128 bytes (same in prefs and AEP).
const _OM_PREFS_ITEM_SIZE = 128;

// TODO(pyrt): no `re` shim; local helper standing in for Python's re.escape.
function _re_escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * An output module template parsed from AE preferences.
 *
 * Attributes:
 *     settings: The binary settings for this template.
 *     name: The template name from the prefs spec strings section.
 *     format_info: Raw bytes of the `Rouu` chunk (output format header),
 *         or None if no format info was found.
 *     format_options: Raw bytes of the format-specific `Ropt` chunk (codec
 *         / image-sequence options), from the "Output File Options
 *         Preference Section". None if absent.
 *     format_options_xml: The XML format options string, or None.
 */
export class OutputModuleTemplate {
  settings: OutputModuleSettingsItem;
  name: string;
  format_info: Uint8Array | null;
  format_options: Uint8Array | null;
  format_options_xml: string | null;

  constructor(
    settings: OutputModuleSettingsItem,
    name: string,
    format_info: Uint8Array | null = null,
    format_options: Uint8Array | null = null,
    format_options_xml: string | null = null,
  ) {
    this.settings = settings;
    this.name = name;
    this.format_info = format_info;
    this.format_options = format_options;
    this.format_options_xml = format_options_xml;
  }
}

/** Extract a hex/ASCII value from a preference section. */
function _extract_section_value(lines: string[], key: string): Uint8Array | null {
  for (const [i, line] of enumerate(lines)) {
    if (!line.includes(key)) continue;
    const m = new RegExp('^\\s*"' + _re_escape(key) + '"\\s*=\\s*(.+)').exec(line);
    if (!m) continue;
    const value_parts: string[] = [strip(m[1])];
    for (let j = i + 1; j < lines.length; j++) {
      const next_line = strip(lines[j]);
      if (!py_bool(next_line) || next_line.startsWith("#") || next_line.startsWith("[")) break;
      if (next_line.startsWith('"')) break;
      value_parts.push(next_line);
    }
    return parse_hex_value(value_parts.join(""));
  }
  return null;
}

/**
 * Parse render settings templates from AE preferences.
 *
 * Args:
 *     prefs_dir: Path to the AE version preferences directory
 *         (e.g. `~/AppData/Roaming/Adobe/After Effects/25.6`).
 *
 * Returns:
 *     A tuple of (templates, default_index). Templates is a list of
 *     parsed [RenderSettingsItem][] objects. Default_index is the
 *     index of the default render settings template in the returned
 *     list, or None if not found (or the default entry was filtered
 *     out).
 */
export function parse_render_templates(prefs_dir: Path): [RenderSettingsItem[], number | null] {
  const render_files = prefs_dir.glob("*-indep-render.txt");
  if (!py_bool(render_files)) {
    return [[], null];
  }

  // Python read_text(errors="replace"); pathlib shim has no errors= parameter.
  const text = decode(render_files[0].read_bytes(), "utf-8", "replace");
  const lines = collapse_continuation_lines(text);

  const raw = _extract_section_value(lines, "Render Settings List");
  if (raw == null) {
    return [[], null];
  }

  // The prefs format omits the last 64 bytes (_remaining field).
  // Pad to match the aep format.
  const remaining = len(raw) - _HEADER_SIZE;

  const raw_default_index = _extract_int_value(lines, "Default RS Index");

  const count = floordiv(remaining, _RS_PREFS_ITEM_SIZE);
  const templates: RenderSettingsItem[] = [];
  let default_index: number | null = null;
  for (const idx of range(count)) {
    const offset = _HEADER_SIZE + idx * _RS_PREFS_ITEM_SIZE;
    const item_data = bytes_.slice(raw, offset, offset + _RS_PREFS_ITEM_SIZE);
    const item = RenderSettingsItem.frombytes(
      concat(item_data, bytes_.repeat(b("\x00"), _RS_ITEM_SIZE_DIFF)),
    );
    py_assert(item instanceof RenderSettingsItem);
    if (!py_bool(item.clean_template_name)) {
      continue;
    }
    // The prefs default index counts raw entries; remap it to the
    // filtered list. A filtered-out default yields None (no default).
    if (idx === raw_default_index) {
      default_index = len(templates);
    }
    templates.push(item);
  }

  return [templates, default_index];
}

/** Extract an integer value from a preference line like `"Key" = 42`. */
function _extract_int_value(lines: string[], key: string): number | null {
  for (const line of lines) {
    // TODO(port): Python `\d` matches Unicode decimal digits; JS `\d` is ASCII only.
    const m = new RegExp('^\\s*"' + _re_escape(key) + '"\\s*=\\s*"?(\\d+)"?').exec(line);
    if (m) {
      return int(m[1]);
    }
  }
  return null;
}

/**
 * Parse output module templates from AE preferences.
 *
 * Args:
 *     prefs_dir: Path to the AE version preferences directory
 *         (e.g. `~/AppData/Roaming/Adobe/After Effects/25.6`).
 *
 * Returns:
 *     A tuple of (templates, default_index). Templates is a list of
 *     [OutputModuleTemplate][] objects. Default_index is the index
 *     of the default output module template in the returned list, or
 *     None if not found (or the default entry was filtered out).
 *     Templates whose name starts with `_HIDDEN` are excluded.
 */
export function parse_output_templates(prefs_dir: Path): [OutputModuleTemplate[], number | null] {
  const output_files = prefs_dir.glob("*-indep-output.txt");
  if (!py_bool(output_files)) {
    return [[], null];
  }

  // Python read_text(errors="replace"); pathlib shim has no errors= parameter.
  const text = decode(output_files[0].read_bytes(), "utf-8", "replace");
  const lines = collapse_continuation_lines(text);

  const raw = _extract_section_value(lines, "Output Module List v28");
  if (raw == null) {
    return [[], null];
  }

  const names = _extract_template_names(lines);

  // Rouu header bytes ("Output File Info") and the format-specific Ropt
  // bytes ("Output File Options"), both keyed by the same template index.
  const format_infos = _parse_id_hex_section(
    text,
    "Output File Info Preference Section",
    "Output File Info",
  );
  const format_opts = _parse_id_hex_section(
    text,
    "Output File Options Preference Section",
    "Output File Options",
  );

  const raw_default_index = _extract_int_value(lines, "Default OM Index");

  const remaining = len(raw) - _HEADER_SIZE;
  const count = floordiv(remaining, _OM_PREFS_ITEM_SIZE);
  const templates: OutputModuleTemplate[] = [];
  let default_index: number | null = null;
  for (const idx of range(count)) {
    const offset = _HEADER_SIZE + idx * _OM_PREFS_ITEM_SIZE;
    const item_data = bytes_.slice(raw, offset, offset + _OM_PREFS_ITEM_SIZE);
    const item = OutputModuleSettingsItem.frombytes(item_data);
    py_assert(item instanceof OutputModuleSettingsItem);
    const name = dict_get(names, idx, "");
    if (!py_bool(name) || name.startsWith("_HIDDEN")) {
      continue;
    }
    // The prefs default index counts raw entries; remap it to the
    // filtered list. A filtered-out default yields None (no default).
    if (idx === raw_default_index) {
      default_index = len(templates);
    }
    templates.push(
      new OutputModuleTemplate(
        item,
        name,
        dict_get(format_infos, idx),
        dict_get(format_opts, idx),
      ),
    );
  }

  return [templates, default_index];
}

/**
 * Parse a `"<id_prefix> ID # N" = <hex/ascii>` preferences section.
 *
 * Used for both "Output File Info" (the `Rouu` header) and "Output File
 * Options" (the `Ropt` format options). Values span continuation lines
 * (double-tab indented, trailing backslash) and use AE's mixed hex/ASCII
 * encoding decoded by `parse_hex_value`. Parsing is bounded to the named
 * section so continuation lines never leak across section boundaries.
 *
 * Args:
 *     text: Full preferences file text.
 *     section: Substring identifying the section header line (e.g.
 *         "Output File Info Preference Section").
 *     id_prefix: The per-entry key prefix (e.g. "Output File Info").
 *
 * Returns:
 *     A dict mapping template index to decoded raw bytes.
 */
function _parse_id_hex_section(text: string, section: string, id_prefix: string): Map<number, Uint8Array> {
  const entries = new Map<number, Uint8Array>();
  let current_idx: number | null = null;
  let current_value = "";
  let in_section = false;
  // TODO(port): Python `\d` matches Unicode decimal digits; JS `\d` is ASCII only.
  const entry_re = new RegExp('^\\s*"' + _re_escape(id_prefix) + ' ID #\\s*(\\d+)"\\s*=\\s*(.+)');

  // Python `nonlocal current_idx`: the closure writes the enclosing `let`.
  function _flush(): void {
    if (current_idx != null) {
      entries.set(current_idx, parse_hex_value(current_value));
      current_idx = null;
    }
  }

  for (const line of split(text, "\n")) {
    const stripped = rstrip(line);
    if (!py_bool(stripped)) {
      continue;
    }
    if (stripped.startsWith("[")) {
      // section boundary
      _flush();
      in_section = stripped.includes(section);
      continue;
    }
    if (!in_section) {
      continue;
    }
    const m = entry_re.exec(stripped);
    if (m) {
      _flush();
      current_idx = int(m[1]);
      const value = strip(m[2]);
      current_value = value.endsWith("\\") ? value.slice(0, -1) : value;
      continue;
    }
    if (current_idx != null && stripped.startsWith("\t\t")) {
      const value = strip(stripped);
      current_value += value.endsWith("\\") ? value.slice(0, -1) : value;
    }
  }

  _flush();
  return entries;
}

/** Extract template names from Output Module Spec Strings section. */
function _extract_template_names(lines: string[]): Map<number, string> {
  const names = new Map<number, string>();
  for (const line of lines) {
    const m = /^\s*"Output Module Spec Strings Name #?(\d+)"\s*=\s*"(.*)"/.exec(line);
    if (m) {
      const idx = int(m[1]);
      names.set(idx, m[2]);
    }
  }
  return names;
}
