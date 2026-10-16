/**
 * File paths in the `alas` records After Effects stores, per platform.
 *
 * After Effects locates footage and render output by an absolute path written
 * in its own platform's style (POSIX on macOS, drive letter or UNC on Windows),
 * and falls back to a path relative to the project file when that is gone (a
 * moved project folder, another machine). The fallback is stored as two
 * counts: `ascendcount_base`, the path components from the common folder down
 * to the project file, and `ascendcount_target`, the same down to the target.
 */

import { py_eq } from "../../pyrt/index.ts";

export const _DRIVE = /^([A-Za-z]):[\\\/]?(.*)$/s;
export const _UNC = /^(?:\\\\|\/\/)[^\\\/]+[\\\/]([^\\\/]+)[\\\/]?(.*)$/s;

// TODO(pyrt): pathlib.PurePath / PurePosixPath / PureWindowsPath are not in pyrt. These are
// local stand-ins covering only what this module uses: `.parts`, `/ "_"`, isinstance and type
// identity. Parsing follows CPython's posixpath/ntpath for the inputs `_pure_path` admits.
export class PurePath {
  parts: string[];

  constructor(parts: string[]) {
    this.parts = parts;
  }

  /** `p / "child"` keeps the same class, as in pathlib. */
  div(name: string): PurePath {
    return new (this.constructor as any)([...this.parts, name]);
  }
}

export class PurePosixPath extends PurePath {}

export class PureWindowsPath extends PurePath {}

export function _is_posix(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//");
}

/** `path` in the style of After Effects on the target platform.
 *
 * After Effects on Windows opens a macOS path `/Users/x/a.png` as
 * `C:\Users\x\a.png` (and `/Volumes/v/a.png` as
 * `C:\Volumes\v\a.png`), measured on AE 2026; the reverse is the
 * inverse of that. A Windows path on another drive or on a UNC share has no
 * such counterpart, so it maps to a macOS mount point - `D:\x` to
 * `/Volumes/D/x`, `\\server\share\x` to `/Volumes/share/x` (the
 * usual macOS mount of a share, not measured). A path already in the target
 * style, or a relative one, is returned unchanged.
 *
 * Args:
 *     path: An absolute path in either style.
 *     windows: `true` for After Effects on Windows, `false` for macOS.
 */
export function platform_path(path: string, kw: { windows: boolean }): string {
  const { windows } = kw;
  if (windows) {
    if (_is_posix(path)) {
      return "C:" + path.replace(/\//g, "\\");
    }
    return path;
  }
  if (_is_posix(path)) {
    return path;
  }
  const drive = _DRIVE.exec(path);
  const unc = drive ? null : _UNC.exec(path);
  let root: string;
  let rest: string;
  if (drive) {
    const letter = drive[1].toUpperCase();
    root = letter === "C" ? "" : "/Volumes/" + letter;
    rest = drive[2];
  } else if (unc) {
    root = "/Volumes/" + unc[1];
    rest = unc[2];
  } else {
    return path;
  }
  rest = rest.replace(/\\/g, "/");
  // `f"{root}/{rest}" if rest or not root else root`
  return rest !== "" || root === "" ? `${root}/${rest}` : root;
}

export function _posix_parts(path: string): string[] {
  // CPython's PurePosixPath: a single leading root, then components with
  // empty and "." segments dropped.
  return ["/", ...path.split("/").filter((c) => c !== "" && c !== ".")];
}

export function _windows_parts(path: string): string[] {
  // CPython 3.12 ntpath.splitroot + pathlib: separators normalised to `\`, the
  // drive and root form one leading part, empty and "." components dropped.
  const normp = path.replace(/\//g, "\\");
  let drv_root: string;
  let tail: string;
  if (normp.slice(0, 2) === "\\\\") {
    // UNC drives, e.g. \\server\share or \\?\UNC\server\share; device drives
    const start = normp.slice(0, 8).toUpperCase() === "\\\\?\\UNC\\" ? 8 : 2;
    const index = normp.indexOf("\\", start);
    const index2 = index === -1 ? -1 : normp.indexOf("\\", index + 1);
    if (index2 === -1) {
      drv_root = normp;
      tail = "";
    } else {
      drv_root = normp.slice(0, index2 + 1);
      tail = normp.slice(index2 + 1);
    }
  } else if (normp.slice(1, 2) === ":") {
    if (normp.slice(2, 3) === "\\") {
      drv_root = normp.slice(0, 3);
      tail = normp.slice(3);
    } else {
      drv_root = normp.slice(0, 2);
      tail = normp.slice(2);
    }
  } else {
    drv_root = "";
    tail = normp;
  }
  const comps = tail.split("\\").filter((c) => c !== "" && c !== ".");
  return drv_root !== "" ? [drv_root, ...comps] : comps;
}

export function _pure_path(path: string): PurePath | null {
  if (_is_posix(path)) {
    return new PurePosixPath(_posix_parts(path));
  }
  if (_DRIVE.test(path) || _UNC.test(path)) {
    return new PureWindowsPath(_windows_parts(path));
  }
  return null;
}

/** How many leading parts name the volume: the drive or UNC share, or
 * on macOS `/Volumes/<name>` (else the root). */
export function _volume_parts(path: PurePath): number {
  if (path instanceof PurePosixPath) {
    return path.parts.length > 2 && path.parts[1] === "Volumes" ? 3 : 1;
  }
  return 1;
}

/** The `(ascendcount_base, ascendcount_target)` pair After Effects stores.
 *
 * Each count is the number of path components below the deepest folder
 * the project file and the target share. A folder target (an image
 * sequence's folder, a render output folder) counts one component more, as
 * for a file inside it. Paths on different volumes or in different path
 * styles have no relative path: `(0, 0)`.
 *
 * Matches the counts After Effects writes on Windows - AE 2026 saves on a
 * local drive, and production projects saved on a UNC share - for footage
 * files, sequence folders and render output folders. On macOS a
 * `/Volumes/<name>` mount is taken as its own volume, like a drive or share
 * (not measured).
 *
 * Args:
 *     project_file: Absolute path of the saved `.aep` file, in the same
 *         style as `target` (see `platform_path`).
 *     target: The record's absolute `fullpath`.
 *     target_is_folder: The record's `target_is_folder`.
 */
export function relative_path_counts(
  project_file: string,
  target: string,
  kw: { target_is_folder: boolean },
): [number, number] {
  const { target_is_folder } = kw;
  const base = _pure_path(project_file);
  let goal = _pure_path(target);
  // `type(base) is type(goal)`
  if (base == null || goal == null || base.constructor !== goal.constructor) {
    return [0, 0];
  }
  if (target_is_folder) {
    goal = goal.div("_");
  }
  // Windows paths compare case-insensitively.
  const fold = base instanceof PureWindowsPath;
  const a = base.parts.map((p) => (fold ? p.toLowerCase() : p));
  const b = goal.parts.map((p) => (fold ? p.toLowerCase() : p));
  const volume = _volume_parts(base);
  if (!py_eq(a.slice(0, volume), b.slice(0, _volume_parts(goal)))) {
    return [0, 0];
  }
  let common = 0;
  while (common < Math.min(a.length, b.length) && a[common] === b[common]) {
    common += 1;
  }
  return [a.length - common, b.length - common];
}
