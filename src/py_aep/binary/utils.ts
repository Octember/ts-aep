/** Chunk tree navigation helpers for the binary I/O layer. */

import { Chunk, DeferredListChunk, ListChunk } from "./chunk.ts";
import { U4LeChunk, Utf8Chunk } from "./scalar_chunks.ts";
import {
  PyException,
  TypeError_,
  ValueError,
  b,
  float_repr,
  getattr,
  len,
  py_bool,
  sorted,
} from "../../pyrt/index.ts";

export class ChunkNotFoundError extends PyException {
  /** Raised when a required chunk is not found in the AEP chunk tree. */
}

/** Sentinel value indicating an undefined frame number in the binary format. */
export const UNDEFINED_FRAME = 0xFFFFFFFF;

/**
 * Return first chunk matching `chunk_type`.
 *
 * Raises:
 *     ChunkNotFoundError: If no matching chunk is found.
 */
export function find_by_type(chunks: Chunk[], chunk_type: string): Chunk {
  for (const c of chunks) {
    if (c.chunk_type === chunk_type) return c;
  }
  throw new ChunkNotFoundError(`Missing ${chunk_type} chunk`);
}

/**
 * Return first ListChunk with matching `list_type`.
 *
 * Raises:
 *     ChunkNotFoundError: If no matching LIST chunk is found.
 */
export function find_by_list_type(chunks: Chunk[], list_type: string): ListChunk {
  for (const c of chunks) {
    if (c instanceof ListChunk && c.list_type === list_type) return c;
  }
  throw new ChunkNotFoundError(`Missing LIST/${list_type} chunk`);
}

/** Return all chunks matching `chunk_type`. */
export function filter_by_type(chunks: Chunk[], chunk_type: string): Chunk[] {
  return chunks.filter((c) => c.chunk_type === chunk_type);
}

/** Return all ListChunks with matching `list_type`. */
export function filter_by_list_type(chunks: Chunk[], list_type: string): ListChunk[] {
  return chunks.filter(
    (c): c is ListChunk => c instanceof ListChunk && c.list_type === list_type,
  );
}

/**
 * Index of `target` in `chunks` by object identity.
 *
 * attrs `@define` chunks compare structurally, so `list.index()` can
 * match a different, byte-equal chunk; identity avoids that.
 *
 * Raises:
 *     ValueError: If `target` is not found in `chunks`.
 */
export function index_by_identity<_T>(chunks: readonly _T[], target: object): number {
  for (const [i, c] of chunks.entries()) {
    if (c === target) return i;
  }
  throw new ValueError("target chunk not found in chunk list");
}

/**
 * Return `(start, end)` indices of a contiguous block starting at `target`.
 *
 * Scans forward from `target` until a `ListChunk` whose `list_type` is
 * in `boundary_list_types`, or the end of the list.  Uses identity
 * comparison (`is`) to locate `target`.
 *
 * Args:
 *     chunks: The chunk list to search.
 *     target: The chunk that starts the block (matched by identity).
 *     boundary_list_types: `list_type` values that mark the beginning of
 *         the next block.
 *
 * Raises:
 *     ValueError: If `target` is not found in `chunks`.
 */
export function block_slice(
  chunks: Chunk[],
  target: Chunk,
  boundary_list_types: ReadonlySet<string>,
): [number, number] {
  const start = index_by_identity(chunks, target);
  for (let end = start + 1; end < chunks.length; end++) {
    const c = chunks[end];
    if (c instanceof ListChunk && boundary_list_types.has(c.list_type)) {
      return [start, end];
    }
  }
  return [start, chunks.length];
}

/**
 * Return the index of the first chunk matching `anchor_type`.
 *
 * `anchor_type` can be a plain chunk type (e.g. `"opti"`) or a LIST type
 * prefixed with `"LIST:"` (e.g. `"LIST:Als2"`).
 *
 * Raises:
 *     ChunkNotFoundError: If no matching chunk is found.
 */
function _find_anchor_index(chunks: Chunk[], anchor_type: string): number {
  if (anchor_type.startsWith("LIST:")) {
    const lt = anchor_type.slice(5);
    for (const [i, c] of chunks.entries()) {
      if (getattr(c, "list_type", null) === lt) return i;
    }
    throw new ChunkNotFoundError(`Missing LIST/${lt} chunk`);
  }

  for (const [i, c] of chunks.entries()) {
    if (c.chunk_type === anchor_type) return i;
  }
  throw new ChunkNotFoundError(`Missing ${anchor_type} chunk`);
}

/**
 * Return consecutive chunks of `chunk_type` immediately before `before_type`.
 *
 * Scans `chunks` for the first occurrence of `before_type`, then collects the
 * uninterrupted run of `chunk_type` chunks that directly precede it.
 *
 * `before_type` can be a plain chunk type (e.g. `"opti"`) or a LIST type
 * prefixed with `"LIST:"` (e.g. `"LIST:Als2"`).
 *
 * Raises:
 *     ChunkNotFoundError: If no chunk with `before_type` is found.
 */
export function find_chunks_before(
  chunks: Chunk[],
  chunk_type: string,
  before_type: string,
): Chunk[] {
  const anchor = _find_anchor_index(chunks, before_type);
  const result: Chunk[] = [];
  for (let i = anchor - 1; i >= 0; i--) {
    if (chunks[i].chunk_type === chunk_type) {
      result.unshift(chunks[i]);
    } else {
      break;
    }
  }
  return result;
}

/**
 * Return consecutive chunks of `chunk_type` immediately after `after_type`.
 *
 * Scans `chunks` for the first occurrence of `after_type`, then collects the
 * uninterrupted run of `chunk_type` chunks that directly follow it.
 *
 * `after_type` can be a plain chunk type (e.g. `"opti"`) or a LIST type
 * prefixed with `"LIST:"` (e.g. `"LIST:Als2"`).
 *
 * Raises:
 *     ChunkNotFoundError: If no chunk with `after_type` is found.
 */
export function find_chunks_after(
  chunks: Chunk[],
  chunk_type: string,
  after_type: string,
): Chunk[] {
  const anchor = _find_anchor_index(chunks, after_type);
  const result: Chunk[] = [];
  for (let i = anchor + 1; i < chunks.length; i++) {
    if (chunks[i].chunk_type === chunk_type) {
      result.push(chunks[i]);
    } else {
      break;
    }
  }
  return result;
}

/**
 * Split `chunks` into groups bounded by `start_type` ... `end_type` (inclusive).
 *
 * Chunks that fall outside any group are ignored.
 */
export function group_chunks(
  chunks: Chunk[],
  start_type: string,
  end_type: string,
): Chunk[][] {
  const groups: Chunk[][] = [];
  let current: Chunk[] | null = null;
  for (const chunk of chunks) {
    if (chunk.chunk_type === start_type && current == null) {
      current = [chunk];
    } else if (current != null) {
      current.push(chunk);
      if (chunk.chunk_type === end_type) {
        groups.push(current);
        current = null;
      }
    }
  }
  return groups;
}

/**
 * Split `chunks` into groups starting at each occurrence of `chunk_type`.
 *
 * Every time a chunk with `chunk_type` is encountered a new group begins.
 * Chunks that appear before the first occurrence are discarded.
 */
export function split_on_type(chunks: Chunk[], chunk_type: string): Chunk[][] {
  const groups: Chunk[][] = [];
  let current: Chunk[] | null = null;
  for (const chunk of chunks) {
    if (chunk.chunk_type === chunk_type) {
      if (current != null) groups.push(current);
      current = [chunk];
    } else if (current != null) {
      current.push(chunk);
    }
  }
  if (current != null) groups.push(current);
  return groups;
}

/**
 * Parse path information from an Als2/alas chunk structure.
 *
 * Returns:
 *     Dictionary with alas data (fullpath, target_is_folder, etc.),
 *     or empty dict if not found or invalid.
 */
export function parse_alas_data(parent_chunks: Chunk[]): Map<string, any> {
  let als2_chunk: ListChunk;
  try {
    als2_chunk = find_by_list_type(parent_chunks, "Als2");
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    return new Map();
  }
  let alas_chunk: Chunk;
  try {
    alas_chunk = find_by_type(als2_chunk.chunks, "alas");
  } catch (e) {
    if (!(e instanceof ChunkNotFoundError)) throw e;
    return new Map();
  }
  const alas_text = (alas_chunk as Utf8Chunk).value;
  // `value` may be a `_NulTailStr` (String object), which py_bool would call truthy.
  if (alas_text == null || String(alas_text).length === 0) return new Map();
  const result = json_loads(String(alas_text));
  return result instanceof Map ? result : new Map();
}

/**
 * `ascendcount_*` value marking an `alas` path record py_aep wrote: the
 * relative-path counts depend on where the project is saved, so
 * `Project.save` fills them in for the file it writes.
 */
export const PENDING_ASCENDCOUNT = -1;

/**
 * The `alas` `platform` code After Effects stores for a path: 2 for a
 * POSIX path, 1 for a drive-letter or UNC path (it follows the path's
 * style, not the saving machine).
 */
export function alas_platform(fullpath: string): number {
  return fullpath.startsWith("/") ? 2 : 1;
}

/**
 * Serialize an `alas` record the way After Effects writes it: sorted
 * keys, no whitespace.
 */
export function dump_alas(data: Map<string, any>): string {
  return json_dumps_sorted(data);
}

/**
 * Build a `LIST:Als2 -> alas` chunk holding a footage source path.
 *
 * Inverse of `parse_alas_data`. AE locates the file via the absolute
 * `fullpath`, falling back to the relative-path counts
 * (`ascendcount_*`), which are left `PENDING_ASCENDCOUNT` for
 * `Project.save` to compute.
 *
 * Args:
 *     fullpath: Absolute path to the file, or the containing folder for
 *         an image sequence.
 *     target_is_folder: `True` when `fullpath` is a sequence folder.
 */
export function build_als2_list(
  fullpath: string,
  kw: { target_is_folder: boolean },
): ListChunk {
  const { target_is_folder } = kw;
  const data = new Map<string, any>([
    ["ascendcount_base", PENDING_ASCENDCOUNT],
    ["ascendcount_target", PENDING_ASCENDCOUNT],
    ["fullpath", fullpath],
    ["platform", alas_platform(fullpath)],
    ["server_name", ""],
    ["server_volume_name", ""],
    ["target_is_folder", target_is_folder],
  ]);
  const alas = new Utf8Chunk({ chunk_type: "alas", value: dump_alas(data) });
  return new ListChunk({ list_type: "Als2", chunks: [alas] });
}

/**
 * Build the `LIST:StVc` frame list of an alphabetical image sequence:
 * the file count, then one `Utf8` name per frame, in order.
 */
export function build_stvc_list(file_names: string[]): ListChunk {
  const names: Chunk[] = file_names.map((name) => new Utf8Chunk({ value: name }));
  return new ListChunk({
    list_type: "StVc",
    chunks: [
      new U4LeChunk({ chunk_type: "StVS", value: file_names.length }),
      ...names,
    ],
  });
}

/**
 * Return a text tree representation of chunks for debugging.
 *
 * Args:
 *     chunks: List of chunks to visualize.
 *     depth: Max depth to recurse (-1 for unlimited).
 *     indent: Current indentation level (used internally).
 */
export function chunk_tree(chunks: Chunk[], depth = -1, indent = 0): string {
  const lines: string[] = [];
  const prefix = "  ".repeat(indent);
  for (const chunk of chunks) {
    const lt = getattr(chunk, "list_type", null);
    const children = getattr(chunk, "chunks", null);
    const size = len(getattr(chunk, "data", b("")));
    if (lt != null) {
      const label = `LIST:${lt}`;
      lines.push(`${prefix}${label}`);
      if (depth !== 0 && children != null) {
        lines.push(chunk_tree(children, depth - 1, indent + 1));
      }
    } else {
      lines.push(`${prefix}${chunk.chunk_type} (${size} B)`);
    }
  }
  return lines.join("\n");
}

/**
 * Add or remove a flag chunk from a ListChunk container.
 *
 * Flag chunks are tiny (1-byte body `b"\x01"`) presence/absence
 * markers.
 *
 * Some flag chunks are positional: After Effects reads them in a fixed
 * slot and rejects the file ("missing data") when they appear elsewhere.
 * Pass `after_types` to insert the new chunk immediately after the last
 * chunk of one of those types (e.g. `("cpid",)` for `lnrb`); when none of
 * them is present, or `after_types` is empty, the chunk is appended.
 */
export function toggle_flag_chunk(
  container: ListChunk,
  chunk_type: string,
  enable: boolean,
  kw: { after_types?: readonly string[] } = {},
): void {
  const { after_types = [] } = kw;

  const existing = container.chunks.flatMap((c, i) => (c.chunk_type === chunk_type ? [i] : []));
  if (enable && !py_bool(existing)) {
    const new_chunk = new Chunk({ chunk_type, data: b("\x01") });
    const anchors = container.chunks.flatMap((c, i) =>
      after_types.includes(c.chunk_type) ? [i] : [],
    );
    if (py_bool(anchors)) {
      container.chunks.splice(anchors.at(-1)! + 1, 0, new_chunk);
    } else {
      container.chunks.push(new_chunk);
    }
  } else if (!enable && py_bool(existing)) {
    for (const i of [...existing].reverse()) {
      container.chunks.splice(i, 1);
    }
  }
}

/**
 * Recursively search the chunk tree for matching chunks.
 *
 * At least one of `chunk_type` or `list_type` must be given.
 * `skip_unparsed` leaves the children of a `DeferredListChunk` never read
 * unsearched (searching parses it and costs the save its raw-bytes write).
 *
 * Returns:
 *     All matching chunks across the entire tree, in DFS order.
 */
export function recursive_find(
  chunks: Chunk[],
  chunk_type: string | null = null,
  list_type: string | null = null,
  skip_unparsed = false,
): Chunk[] {
  if (chunk_type == null && list_type == null) {
    throw new ValueError("At least one of chunk_type or list_type is required");
  }
  const results: Chunk[] = [];
  for (const chunk of chunks) {
    if (list_type != null) {
      if (getattr(chunk, "list_type", null) === list_type) results.push(chunk);
    } else if (chunk.chunk_type === chunk_type) {
      results.push(chunk);
    }
    if (skip_unparsed && chunk instanceof DeferredListChunk && !chunk.is_parsed) {
      continue;
    }
    const children = getattr(chunk, "chunks", null);
    if (children != null) {
      for (const found of recursive_find(children, chunk_type, list_type, skip_unparsed)) {
        results.push(found);
      }
    }
  }
  return results;
}

// json.loads parity: Python `dict` -> Map at every depth, keys kept in source
// order (JSON.parse reorders integer-like keys), duplicate keys keep the first
// position with the last value, and NaN / Infinity / -Infinity are accepted.
// TODO(port): int/float distinction (`1.0` reads as `1`) and ints beyond 2^53
// lose precision, so such alas records can differ from Python.
function json_loads(text: string): any {
  const ws = " \t\n\r";
  let pos = 0;
  const skip = (): void => {
    while (pos < text.length && ws.includes(text[pos])) pos++;
  };
  const fail = (msg: string): never => {
    throw new ValueError(`${msg}: char ${pos}`);
  };
  const parse_value = (): any => {
    skip();
    const ch = text[pos];
    if (ch === "{") {
      pos++;
      const out = new Map<string, any>();
      skip();
      if (text[pos] === "}") {
        pos++;
        return out;
      }
      for (;;) {
        skip();
        if (text[pos] !== '"') fail("Expecting property name enclosed in double quotes");
        const key = parse_string();
        skip();
        if (text[pos] !== ":") fail("Expecting ':' delimiter");
        pos++;
        out.set(key, parse_value());
        skip();
        if (text[pos] === ",") {
          pos++;
          continue;
        }
        if (text[pos] === "}") {
          pos++;
          return out;
        }
        fail("Expecting ',' delimiter");
      }
    }
    if (ch === "[") {
      pos++;
      const out: any[] = [];
      skip();
      if (text[pos] === "]") {
        pos++;
        return out;
      }
      for (;;) {
        out.push(parse_value());
        skip();
        if (text[pos] === ",") {
          pos++;
          continue;
        }
        if (text[pos] === "]") {
          pos++;
          return out;
        }
        fail("Expecting ',' delimiter");
      }
    }
    if (ch === '"') return parse_string();
    for (const [lit, val] of [
      ["null", null],
      ["true", true],
      ["false", false],
      ["NaN", NaN],
      ["Infinity", Infinity],
      ["-Infinity", -Infinity],
    ] as [string, any][]) {
      if (text.startsWith(lit, pos)) {
        pos += lit.length;
        return val;
      }
    }
    const m = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?/y;
    m.lastIndex = pos;
    const r = m.exec(text);
    if (r === null) return fail("Expecting value");
    pos = m.lastIndex;
    return Number(r[0]);
  };
  const parse_string = (): string => {
    const start = pos;
    pos++;
    while (pos < text.length && text[pos] !== '"') pos += text[pos] === "\\" ? 2 : 1;
    if (pos >= text.length) {
      pos = start;
      fail("Unterminated string starting at");
    }
    pos++;
    try {
      return JSON.parse(text.slice(start, pos));
    } catch {
      pos = start;
      return fail("Invalid string");
    }
  };
  const result = parse_value();
  skip();
  if (pos !== text.length) fail("Extra data");
  return result;
}

// json.dumps parity: `json.dumps(obj, sort_keys=True, separators=(",", ":"))`
// with the default `ensure_ascii=True`. The output is written into the AEP
// file and compared byte-for-byte, so it reproduces Python's spelling exactly.
function json_dumps_sorted(obj: any): string {
  if (obj == null) return "null";
  if (typeof obj === "boolean") return obj ? "true" : "false";
  if (typeof obj === "number") {
    if (Number.isNaN(obj)) return "NaN";
    if (obj === Infinity) return "Infinity";
    if (obj === -Infinity) return "-Infinity";
    // TODO(port): int/float distinction. An integer-valued float prints as an int here.
    return Number.isInteger(obj) ? String(obj) : float_repr(obj);
  }
  if (typeof obj === "string") return json_string(obj);
  if (Array.isArray(obj)) return `[${obj.map(json_dumps_sorted).join(",")}]`;
  if (obj instanceof Map) {
    const parts = sorted([...obj.keys()]).map(
      (k) => `${json_string(k)}:${json_dumps_sorted(obj.get(k))}`,
    );
    return `{${parts.join(",")}}`;
  }
  throw new TypeError_(`Object of type ${obj?.constructor?.name} is not JSON serializable`);
}

// json.dumps parity: string escaping under `ensure_ascii=True`. Escapes are
// lowercase hex and non-BMP code points become surrogate pairs, as in CPython.
function json_string(s: string): string {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (c === 0x0a) out += "\\n";
    else if (c === 0x0d) out += "\\r";
    else if (c === 0x09) out += "\\t";
    else if (c === 0x08) out += "\\b";
    else if (c === 0x0c) out += "\\f";
    else if (c >= 0x20 && c < 0x7f) out += ch;
    else if (c < 0x10000) out += "\\u" + c.toString(16).padStart(4, "0");
    else {
      const v = c - 0x10000;
      out +=
        "\\u" + (0xd800 | (v >> 10)).toString(16) + "\\u" + (0xdc00 | (v & 0x3ff)).toString(16);
    }
  }
  return out + '"';
}
