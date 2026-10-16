/**
 * AEP File Inspection Tool.
 *
 * Inspect After Effects project files (.aep) structure:
 * - Item summary with children types and counts
 * - Full chunk tree visualization
 * - Detailed item children inspection
 * - Chunk path listing with sizes
 * - Hex dump of specific chunks
 *
 * Modes:
 *     Default:  aep-inspect file.aep              (item summary)
 *     Tree:     aep-inspect file.aep --tree        (full chunk tree)
 *     Item:     aep-inspect file.aep --item 6      (inspect Item[6])
 *     List:     aep-inspect file.aep --list        (chunk paths + sizes)
 *     Dump:     aep-inspect file.aep --dump "path" (hex dump)
 */

// Python's `from ..binary.chunk import ...` runs py_aep/__init__ first, which
// registers every chunk type. Standalone CLI runs need the same registration.
import "../binary/_register.ts";
import { ListChunk, read_aep } from "../binary/chunk.ts";
import type { Chunk } from "../binary/chunk.ts";
import { filter_by_list_type } from "../binary/utils.ts";
import { chunk_label, extract_leaf_chunks, format_hex_dump, walk_chunks } from "./_chunk_helpers.ts";
import {
  BytesIO,
  Path,
  ValueError,
  at,
  format,
  getattr,
  getitem,
  int,
  len,
  py_bool,
  repr,
  sorted,
  str,
} from "../../pyrt/index.ts";

// TODO(pyrt): builtin print(..., file=sys.stderr). console.log/console.error
// match print's trailing newline.
export const sys = { stderr: process.stderr };
export function print(text: string, kw: { file?: unknown } = {}): void {
  if (kw.file === sys.stderr) console.error(text);
  else console.log(text);
}

// ── Tree display ────────────────────────────────────────────────────────────


/** Return size or value detail for a leaf chunk. */
export function _chunk_detail(chunk: Chunk): string {
  const val = getattr(chunk, "value", null);
  if (val != null) {
    let v = repr(val);
    // Python len() and slicing count code points, not UTF-16 units.
    const cps = Array.from(v);
    if (len(cps) > 60) v = cps.slice(0, 57).join("") + "...";
    return `value=${v}`;
  }
  const data = getattr(chunk, "data", null);
  if (data != null) return `${len(data)}B`;
  return "";
}

/**
 * Print a chunk tree with types and sizes.
 *
 * @param chunk Root chunk to print.
 * @param depth Current depth (for indentation).
 * @param max_depth Maximum depth to recurse (-1 for unlimited).
 */
export function print_tree(chunk: Chunk, depth: number = 0, max_depth: number = -1): void {
  if (max_depth >= 0 && depth > max_depth) return;
  const label = chunk_label(chunk);
  if (chunk instanceof ListChunk) {
    const n = len(chunk.chunks);
    print(`${"  ".repeat(depth)}${label} (${n} children)`);
    for (const c of chunk.chunks) print_tree(c, depth + 1, max_depth);
  } else {
    const detail = _chunk_detail(chunk);
    print(`${"  ".repeat(depth)}${label} (${detail})`);
  }
}

// ── Item inspection ─────────────────────────────────────────────────────────

/**
 * Show detailed children of a specific Item by 0-based index.
 *
 * @param path Path to the `.aep` file.
 * @param index 0-based item index within `LIST:Fold`.
 * @returns Exit code (0 on success, 1 on error).
 */
export function _inspect_item(path: Path, index: number): number {
  const fp = new BytesIO(path.read_bytes());
  const [rifx, _] = read_aep(fp);

  let fold: ListChunk | null = null;
  for (const c of rifx.chunks) {
    if (c instanceof ListChunk && c.list_type === "Fold") {
      fold = c;
      break;
    }
  }
  if (fold == null) {
    print("ERROR: No LIST:Fold found", { file: sys.stderr });
    return 1;
  }

  const items = filter_by_list_type(fold.chunks, "Item");
  if (index >= len(items)) {
    print(`ERROR: Item[${index}] out of range (only ${len(items)} items)`, { file: sys.stderr });
    return 1;
  }

  // Python `items[index]` accepts negative indexes; `at` keeps that and raises IndexError.
  const item = at(items, index);
  print(`=== ${path.name} Item[${index}] (${len(item.chunks)} children) ===`);
  for (const [i, c] of item.chunks.entries()) {
    const label = chunk_label(c);
    if (c instanceof ListChunk) {
      print(`  [${format(i, "2d")}] ${label} (${len(c.chunks)} children)`);
      for (const [j, cc] of c.chunks.entries()) {
        const cl = chunk_label(cc);
        if (cc instanceof ListChunk) {
          print(`    [${format(j, "2d")}] ${cl} (${len(cc.chunks)} children)`);
        } else {
          const detail = _chunk_detail(cc);
          print(`    [${format(j, "2d")}] ${cl} (${detail})`);
        }
      }
    } else {
      const detail = _chunk_detail(c);
      print(`  [${format(i, "2d")}] ${label} (${detail})`);
    }
  }
  return 0;
}

// ── Item summary ────────────────────────────────────────────────────────────

/**
 * Show item summary with children types for each item in Fold.
 *
 * @param path Path to the `.aep` file.
 * @returns Exit code.
 */
export function _item_summary(path: Path): number {
  const fp = new BytesIO(path.read_bytes());
  const [rifx, _] = read_aep(fp);

  let fold: ListChunk | null = null;
  for (const c of rifx.chunks) {
    if (c instanceof ListChunk && c.list_type === "Fold") {
      fold = c;
      break;
    }
  }
  if (fold == null) {
    print("No LIST:Fold found", { file: sys.stderr });
    return 1;
  }

  const items = filter_by_list_type(fold.chunks, "Item");
  print(`${path.name}: ${len(items)} items in Fold`);
  for (const [i, item] of items.entries()) {
    const children = item.chunks.map((c) => chunk_label(c));
    print(`  Item[${i}]: ${len(children)} children - ${children.join(", ")}`);
  }
  return 0;
}

// ── Chunk listing ───────────────────────────────────────────────────────────

/**
 * Print a tree of all chunk paths and sizes in an AEP file.
 *
 * @param path Path to the `.aep` file.
 * @returns Exit code.
 */
export function _list_chunks(path: Path): number {
  const fp = new BytesIO(path.read_bytes());
  const [rifx, _xmp] = read_aep(fp);

  print(`\nChunk tree: ${path.name}\n`);
  for (const [_path, identifier, size, depth, is_list] of walk_chunks(rifx.chunks)) {
    const indent = "  ".repeat(depth);
    if (is_list) {
      print(`${indent}${identifier}/`);
    } else {
      print(`${indent}${identifier} (${size}B)`);
    }
  }
  return 0;
}

// ── Hex dump ────────────────────────────────────────────────────────────────

/**
 * Hex-dump a specific chunk from an AEP file.
 *
 * If the path does not match exactly, a partial (substring) match is
 * attempted. Prints available paths on failure.
 *
 * @param path Path to the `.aep` file.
 * @param chunk_path Full or partial chunk path (e.g. `LIST:Fold/ftts`).
 * @returns Exit code.
 */
export function _dump_chunk(path: Path, chunk_path: string): number {
  const chunks = extract_leaf_chunks(path);

  if (!chunks.has(chunk_path)) {
    const matches = sorted(chunks.keys()).filter((p) => p.includes(chunk_path));
    if (!py_bool(matches)) {
      print(`Chunk path not found: ${chunk_path}`, { file: sys.stderr });
      print("\nAvailable leaf chunk paths:", { file: sys.stderr });
      for (const p of sorted(chunks.keys())) {
        print(`  ${p} (${len(getitem(chunks, p))}B)`, { file: sys.stderr });
      }
      return 1;
    }
    if (len(matches) === 1) {
      chunk_path = matches[0];
    } else {
      print(`Ambiguous chunk path '${chunk_path}'. Matches:`, { file: sys.stderr });
      for (const m of matches) {
        print(`  ${m} (${len(getitem(chunks, m))}B)`, { file: sys.stderr });
      }
      return 1;
    }
  }

  const data = getitem(chunks, chunk_path);
  print(`\n[${chunk_path}] (${len(data)} bytes)\n`);
  print(format_hex_dump(data));
  return 0;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

// TODO(pyrt): argparse is not in pyrt. This is the subset main() declares: a
// positional, store_true flags and typed value options, with argparse's
// error exit status 2. Help and usage layout are simplified and not
// byte-identical to argparse (TODO(port)). Value-conversion errors say
// "invalid value" where argparse says "invalid int value" (TODO(port)).
export const NEGATIVE_NUMBER = /^-\d+$|^-\d*\.\d+$/;

export type ArgSpec = {
  dest: string;
  flag: string | null;
  positional: boolean;
  store_true: boolean;
  type_: ((s: string) => any) | null;
  default_: any;
  metavar: string | null;
  help: string;
};

export class ArgumentParser {
  private readonly prog: string;
  private readonly description: string;
  private readonly epilog: string;
  private readonly specs: ArgSpec[] = [];

  constructor(kwargs: Record<string, any> = {}) {
    this.prog = kwargs.prog ?? "";
    this.description = kwargs.description ?? "";
    this.epilog = kwargs.epilog ?? "";
  }

  add_argument(name: string, kwargs: Record<string, any> = {}): void {
    const positional = !name.startsWith("-");
    const store_true = kwargs.action === "store_true";
    this.specs.push({
      dest: positional ? name : name.replace(/^--/, "").replace(/-/g, "_"),
      flag: positional ? null : name,
      positional,
      store_true,
      type_: kwargs.type ?? null,
      default_: kwargs.default ?? (store_true ? false : null),
      metavar: kwargs.metavar ?? null,
      help: kwargs.help ?? "",
    });
  }

  error(message: string): never {
    print(this.format_usage(), { file: sys.stderr });
    print(`${this.prog}: error: ${message}`, { file: sys.stderr });
    process.exit(2);
  }

  format_usage(): string {
    const options = this.specs.filter((s) => !s.positional);
    const positionals = this.specs.filter((s) => s.positional);
    const parts = [
      ...options.map((s) => (s.store_true ? `[${s.flag}]` : `[${s.flag} ${s.metavar ?? s.dest.toUpperCase()}]`)),
      ...positionals.map((s) => s.dest),
    ];
    return `usage: ${this.prog} [-h] ${parts.join(" ")}`;
  }

  format_help(): string {
    const options = this.specs.filter((s) => !s.positional);
    const positionals = this.specs.filter((s) => s.positional);
    const lines = [this.format_usage(), "", this.description, "", "positional arguments:"];
    for (const s of positionals) lines.push(`  ${s.dest}  ${s.help}`);
    lines.push("", "options:", "  -h, --help  show this help message and exit");
    for (const s of options) lines.push(`  ${s.flag}  ${s.help}`);
    return lines.join("\n") + this.epilog.replaceAll("%(prog)s", this.prog);
  }

  parse_args(argv: string[] = process.argv.slice(2)): Record<string, any> {
    const out: Record<string, any> = {};
    for (const s of this.specs) out[s.dest] = s.default_;
    const rest: string[] = [];
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === "-h" || a === "--help") {
        print(this.format_help());
        process.exit(0);
      }
      const eq = a.indexOf("=");
      const name = a.startsWith("--") && eq >= 0 ? a.slice(0, eq) : a;
      const spec = this.specs.find((s) => !s.positional && s.flag === name);
      if (spec == null) {
        if (a.startsWith("-") && a !== "-" && !NEGATIVE_NUMBER.test(a)) this.error(`unrecognized arguments: ${a}`);
        rest.push(a);
        continue;
      }
      if (spec.store_true) {
        if (name !== a) this.error(`argument ${spec.flag}: ignored explicit argument ${repr(a.slice(eq + 1))}`);
        out[spec.dest] = true;
        continue;
      }
      let value: string;
      if (name !== a) {
        value = a.slice(eq + 1);
      } else if (i + 1 < argv.length && (!argv[i + 1].startsWith("-") || NEGATIVE_NUMBER.test(argv[i + 1]))) {
        value = argv[++i];
      } else {
        this.error(`argument ${spec.flag}: expected one argument`);
      }
      if (spec.type_ == null) {
        out[spec.dest] = value;
      } else {
        try {
          out[spec.dest] = spec.type_(value);
        } catch (e) {
          if (!(e instanceof ValueError)) throw e;
          this.error(`argument ${spec.flag}: invalid value: ${repr(value)}`);
        }
      }
    }

    const positionals = this.specs.filter((s) => s.positional);
    if (rest.length < positionals.length) {
      const missing = positionals.slice(rest.length).map((s) => s.dest);
      this.error(`the following arguments are required: ${missing.join(", ")}`);
    }
    if (rest.length > positionals.length) {
      this.error(`unrecognized arguments: ${rest.slice(positionals.length).join(" ")}`);
    }
    for (let k = 0; k < positionals.length; k++) {
      const s = positionals[k];
      out[s.dest] = s.type_ == null ? rest[k] : s.type_(rest[k]);
    }
    return out;
  }
}

export const argparse = { ArgumentParser, RawDescriptionHelpFormatter: "RawDescriptionHelpFormatter" };

/** CLI entry point for aep-inspect command. */
export function main(): number {
  const parser = new argparse.ArgumentParser({
    prog: "aep-inspect",
    description: "Inspect After Effects project file (.aep) structure.",
    formatter_class: argparse.RawDescriptionHelpFormatter,
    epilog: [
      "",
      "Examples:",
      "    %(prog)s file.aep                        (item summary)",
      "    %(prog)s file.aep --tree                 (full chunk tree)",
      "    %(prog)s file.aep --tree --depth 3       (limited depth)",
      "    %(prog)s file.aep --item 6               (inspect Item[6])",
      "    %(prog)s file.aep --list                 (chunk paths + sizes)",
      '    %(prog)s file.aep --dump "LIST:Fold/ftts"(hex dump)',
      "        ",
    ].join("\n"),
  });
  parser.add_argument("file", { type: (s: string) => new Path(s), help: "AEP file to inspect" });
  parser.add_argument("--tree", { action: "store_true", help: "Print full chunk tree" });
  parser.add_argument("--depth", {
    type: (s: string) => int(s),
    default: -1,
    metavar: "N",
    help: "Max tree depth (-1 for unlimited, use with --tree)",
  });
  parser.add_argument("--item", {
    type: (s: string) => int(s),
    default: null,
    metavar: "N",
    help: "Inspect Item[N] (0-based) in LIST:Fold",
  });
  parser.add_argument("--list", { action: "store_true", help: "List all chunk paths and sizes" });
  parser.add_argument("--dump", {
    type: str,
    default: null,
    metavar: "PATH",
    help: 'Hex-dump a specific chunk (e.g. "LIST:Fold/ftts")',
  });

  const args = parser.parse_args();
  const path: Path = args.file;

  if (!path.exists()) {
    print(`Error: File not found: ${path}`, { file: sys.stderr });
    return 1;
  }

  if (args.tree) {
    const fp = new BytesIO(path.read_bytes());
    const [rifx, _] = read_aep(fp);
    print_tree(rifx, undefined, args.depth);
    return 0;
  }

  if (args.item != null) {
    return _inspect_item(path, args.item);
  }

  if (args.list) {
    return _list_chunks(path);
  }

  if (args.dump != null) {
    return _dump_chunk(path, args.dump);
  }

  // Default: item summary
  return _item_summary(path);
}

// Python's `if __name__ == "__main__": sys.exit(main())`.
if (import.meta.main) process.exit(main());
