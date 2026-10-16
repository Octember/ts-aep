/**
 * Resolve an SVG `font-family` to an installed font file.
 *
 * SVG text is rendered by outlining glyphs (see `svg.text`), which needs the
 * actual font file. This module discovers installed fonts from the standard OS
 * font directories (lazily, cached) and matches a CSS `font-family` plus
 * weight/style to a file, mirroring the discover-at-use pattern in `color.icc`.
 * Fonts are not bundled.
 */

import * as fontkit from "fontkit";
import { homedir } from "node:os";
import {
  Path,
  dict_get,
  enumerate,
  py_bool,
  py_or,
  setdefault,
  split,
  str,
  strip,
} from "../../pyrt/index.ts";

/** `Path.home()` */
// TODO(pyrt): Path.home() is missing from pyrt/pathlib.ts; local helper until it lands.
export function home(): Path {
  return new Path(homedir());
}

export const _FONT_SUFFIXES: readonly string[] = [".ttf", ".otf", ".ttc"];

/**
 * family (lowercased) -> {subfamily (lowercased): (font file path, face index)}
 * The face index addresses a face within a TrueType Collection (.ttc); it is
 * 0 for a single-face .ttf/.otf.
 */
export let _index: Map<string, Map<string, [Path, number]>> | null = null;

/**
 * CSS generic families mapped to concrete fonts to try, in order. Used when a
 * requested family is not installed (an unknown family falls back to the
 * sans-serif chain, as a user agent would).
 */
export const _GENERIC_FALLBACKS = new Map<string, readonly string[]>([
  [
    "sans-serif",
    [
      "arial",
      "helvetica",
      "helvetica neue",
      "liberation sans",
      "dejavu sans",
      "segoe ui",
      "noto sans",
      "verdana",
      "tahoma",
    ],
  ],
  [
    "serif",
    [
      "times new roman",
      "georgia",
      "liberation serif",
      "dejavu serif",
      "noto serif",
      "cambria",
    ],
  ],
  [
    "monospace",
    [
      "consolas",
      "courier new",
      "liberation mono",
      "dejavu sans mono",
      "noto sans mono",
      "menlo",
    ],
  ],
  ["cursive", ["comic sans ms", "segoe script"]],
  ["fantasy", ["impact"]],
  ["system-ui", ["segoe ui", "arial", "helvetica", "dejavu sans"]],
  ["ui-sans-serif", ["segoe ui", "arial", "helvetica", "dejavu sans"]],
]);

/**
 * NOTE(port): pytest `monkeypatch.setattr(fonts_mod, "_font_dirs"/"_index", ...)`
 * cannot rebind ESM exports; tests use these hooks instead (same effect).
 */
export function _set_font_dirs(fn: (() => Path[]) | null): void {
  _font_dirs_override = fn;
}
export function _set_index(v: Map<string, Map<string, [Path, number]>> | null): void {
  _index = v;
}
export let _font_dirs_override: (() => Path[]) | null = null;

/** The standard OS font directories that exist on this machine. */
export function _font_dirs(): Path[] {
  if (_font_dirs_override != null) {
    return _font_dirs_override();
  }
  const dirs: Path[] = [];
  if (process.platform === "win32") {
    const windir = process.env.WINDIR ?? "C:\\Windows";
    dirs.push(new Path(windir).div("Fonts"));
    const local = process.env.LOCALAPPDATA;
    if (py_bool(local)) {
      dirs.push(new Path(local).div("Microsoft", "Windows", "Fonts"));
    }
  } else if (process.platform === "darwin") {
    dirs.push(
      new Path("/System/Library/Fonts"),
      new Path("/Library/Fonts"),
      home().div("Library", "Fonts"),
    );
  } else {
    dirs.push(
      new Path("/usr/share/fonts"),
      new Path("/usr/local/share/fonts"),
      home().div(".fonts"),
      home().div(".local", "share", "fonts"),
    );
  }
  return dirs.filter((d) => d.is_dir());
}

/** fontTools name IDs -> fontkit `getName` keys. */
export const NAME_KEYS = new Map<number, string>([
  [1, "fontFamily"],
  [2, "fontSubfamily"],
  [5, "version"],
  [6, "postscriptName"],
  [16, "preferredFamily"],
  [17, "preferredSubfamily"],
]);

/**
 * First non-empty name among the given name IDs, or `null`.
 * TODO(port): fontTools `getDebugName` falls back across name records and
 * languages; fontkit `getName(key)` reads the English record only.
 */
export function _name(font: any, ...ids: number[]): string | null {
  // `table = font.get("name"); if table is None: return None`
  let table: any;
  try {
    table = font.name;
  } catch (e) {
    table = null;
  }
  if (table == null) {
    return null;
  }
  for (const nid of ids) {
    const value = font.getName(NAME_KEYS.get(nid));
    if (py_bool(value)) {
      return str(value);
    }
  }
  return null;
}

/** Adobe CoreSync (Creative Cloud) font caches, when present.
 *
 * Activated Adobe fonts live here as suffix-less OpenType files; AE
 * resolves text-layer fonts against them.
 */
export function _adobe_font_dirs(): Path[] {
  const dirs: Path[] = [];
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA;
    if (py_bool(appdata)) {
      dirs.push(
        new Path(appdata).div("Adobe", "CoreSync", "plugins", "livetype", "r"),
      );
    }
  } else if (process.platform === "darwin") {
    dirs.push(
      home().div(
        "Library",
        "Application Support",
        "Adobe",
        "CoreSync",
        "plugins",
        "livetype",
        ".r",
      ),
    );
  }
  return dirs.filter((d) => d.is_dir());
}

/**
 * PostScript name (name ID 6, lowercased) ->
 * (font file path, face index, version string from name ID 5 or None).
 */
export let _ps_index: Map<string, [Path, number, string | null]> | null = null;

/**
 * Yield `(face index, opened font)` for each face in a font file,
 * closing every face afterwards.
 *
 * Corrupt/unsupported files yield nothing rather than fail discovery.
 */
export function* _iter_faces(path: Path): Generator<[number, any]> {
  let fonts: any[];
  try {
    const opened: any = fontkit.openSync(path.toString());
    if (path.suffix.toLowerCase() === ".ttc") {
      fonts = [...opened.fonts];
    } else {
      // NOTE(port): TTFont(fontNumber=0) on a non-.ttc file; fontkit returns a
      // collection (with `.fonts`) only for collection files, so take face 0.
      fonts = [opened.fonts ? opened.fonts[0] : opened];
    }
  } catch (e) {
    return;
  }
  try {
    yield* enumerate(fonts);
  } finally {
    // NOTE(port): fontkit has no close(); it reads the whole file eagerly, so
    // no handle is left open and `font.close()` has nothing to release.
  }
}

export function _index_postscript(
  path: Path,
  idx: Map<string, [Path, number, string | null]>,
): void {
  for (const [face, font] of _iter_faces(path)) {
    const ps_name = _name(font, 6);
    if (!py_bool(ps_name)) {
      continue;
    }
    const key = ps_name.toLowerCase();
    const existing = dict_get(idx, key);
    if (existing == null) {
      idx.set(key, [path, face, _name(font, 5)]);
    } else if (existing[2] == null) {
      // The first-seen face resolves the name, but a later
      // duplicate can still supply the version string it lacked
      // (the pre-index code only ever stored truthy versions).
      const version = _name(font, 5);
      if (py_bool(version)) {
        idx.set(key, [existing[0], existing[1], version]);
      }
    }
  }
}

/**
 * Yield every font file under the OS font directories. Both index
 * builders (`_build_index`, `_postscript_index`) walk the same tree.
 */
export function* _walk_font_files(): Generator<Path> {
  for (const directory of _font_dirs()) {
    // TODO(port): pyrt rglob sorts entries by name; CPython's rglob follows
    // filesystem (scandir) order. The order decides which duplicate font wins.
    for (const path of directory.rglob("*")) {
      if (_FONT_SUFFIXES.includes(path.suffix.toLowerCase())) {
        yield path;
      }
    }
  }
}

/**
 * The lazily built, cached PostScript-name index (one walk over the
 * OS and Adobe CoreSync font directories).
 */
export function _postscript_index(): Map<string, [Path, number, string | null]> {
  if (_ps_index == null) {
    const idx = new Map<string, [Path, number, string | null]>();
    for (const path of _walk_font_files()) {
      _index_postscript(path, idx);
    }
    for (const directory of _adobe_font_dirs()) {
      for (const path of directory.rglob("*")) {
        if (path.is_file()) {
          _index_postscript(path, idx);
        }
      }
    }
    _ps_index = idx;
  }
  return _ps_index;
}

/**
 * Resolve a PostScript name (name ID 6) to an installed font face.
 *
 * Returns `(font file path, face index)` - the index selects a face
 * within a `.ttc` collection - or `None` when no matching font is
 * installed. This mirrors how AE's text engine identifies fonts, so
 * the composed-line resolver uses it for measurement.
 */
export function resolve_postscript(
  post_script_name: string,
): [Path, number] | null {
  const entry = dict_get(
    _postscript_index(),
    strip(post_script_name).toLowerCase(),
  );
  if (entry == null) {
    return null;
  }
  return [entry[0], entry[1]];
}

/**
 * The installed font's version string (name ID 5) for a PostScript
 * name, or `None` when no matching font is installed.
 *
 * AE stamps this host-resolved string on font entries it registers in
 * a text document and on the used-font records (probed via the
 * `W_FONT` write fixture); matching it keeps py-written files
 * byte-identical to AE's output on the same machine.
 */
export function font_version_string(post_script_name: string): string | null {
  const entry = dict_get(
    _postscript_index(),
    strip(post_script_name).toLowerCase(),
  );
  if (entry == null) {
    return null;
  }
  return entry[2];
}

export function _index_file(
  path: Path,
  idx: Map<string, Map<string, [Path, number]>>,
): void {
  // A .ttc bundles several faces (e.g. cambria.ttc -> Cambria + Cambria
  // Math); index each by its own face number so a family that ships only
  // as a secondary face is still resolvable and loads the right face.
  for (const [face, font] of _iter_faces(path)) {
    // Typographic family (16) preferred over the legacy family (1); same
    // for the subfamily (17 over 2).
    const family = _name(font, 16, 1);
    const subfamily = py_or(_name(font, 17, 2), "Regular");
    if (py_bool(family)) {
      setdefault(
        setdefault(idx, family.toLowerCase(), new Map<string, [Path, number]>()),
        subfamily.toLowerCase(),
        [path, face] as [Path, number],
      );
    }
  }
}

export function _build_index(): Map<string, Map<string, [Path, number]>> {
  const idx = new Map<string, Map<string, [Path, number]>>();
  for (const path of _walk_font_files()) {
    _index_file(path, idx);
  }
  return idx;
}

/** Choose the closest available face for the requested weight/style. */
export function _pick(
  styles: Map<string, [Path, number]>,
  bold: boolean,
  italic: boolean,
): [Path, number] {
  let order: string[];
  if (bold && italic) {
    order = ["bold italic", "bolditalic", "bold oblique", "bold", "italic"];
  } else if (bold) {
    order = ["bold", "bold italic"];
  } else if (italic) {
    order = ["italic", "oblique"];
  } else {
    order = ["regular", "book", "roman"];
  }
  for (const key of order) {
    if (styles.has(key)) {
      return styles.get(key)!;
    }
  }
  return styles.values().next().value as [Path, number];
}

/**
 * Resolve a single family name to an installed font face, with NO
 * generic fallback.
 *
 * Unlike `resolve_font`, an uninstalled family returns `None` instead
 * of degrading to the sans-serif chain; used where substituting a
 * different font would be wrong (e.g. reading variable-font axes).
 * Returns `(font file path, face index)`.
 */
export function resolve_font_exact(family: string): [Path, number] | null {
  if (_index == null) {
    _index = _build_index();
  }
  const styles = dict_get(
    _index,
    strip(strip(family), "'\"").toLowerCase(),
  );
  if (!py_bool(styles)) {
    return null;
  }
  return _pick(styles, false, false);
}

/**
 * Resolve a CSS `font-family` value to an installed font face.
 *
 * `family` may be a comma-separated list (quotes stripped); the first
 * installed family wins. Returns `(font file path, face index)` - the index
 * selects a face within a `.ttc` collection (0 for a single-face file) - or
 * `None` when no listed family is found.
 */
export function resolve_font(
  family: string,
  kw: { bold?: boolean; italic?: boolean } = {},
): [Path, number] | null {
  const { bold = false, italic = false } = kw;
  if (_index == null) {
    _index = _build_index();
  }
  let generic: string | null = null;
  for (const raw of split(family, ",")) {
    const name = strip(strip(raw), "'\"").toLowerCase();
    if (!py_bool(name)) {
      continue;
    }
    const styles = dict_get(_index, name);
    if (py_bool(styles)) {
      return _pick(styles, bold, italic);
    }
    if (generic == null && _GENERIC_FALLBACKS.has(name)) {
      generic = name;
    }
  }
  // No requested family is installed: fall back to the generic chain (the
  // requested generic, or sans-serif for an unknown family).
  for (const candidate of dict_get(
    _GENERIC_FALLBACKS,
    py_or(generic, "sans-serif"),
    [] as readonly string[],
  )) {
    const styles = dict_get(_index, candidate);
    if (py_bool(styles)) {
      return _pick(styles, bold, italic);
    }
  }
  return null;
}
