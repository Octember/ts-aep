// The `pathlib.Path` subset py_aep uses, over node:fs / node:path.

import * as fs from "node:fs";
import * as nodepath from "node:path";
import { FileNotFoundError } from "./errors.ts";

export class Path {
  readonly path: string;

  constructor(...parts: (string | Path)[]) {
    this.path = parts.length ? nodepath.join(...parts.map(String)) : ".";
  }

  toString(): string {
    return this.path;
  }

  /** `p / "child"` */
  div(...parts: (string | Path)[]): Path {
    return new Path(this.path, ...parts.map(String));
  }

  get name(): string {
    return nodepath.basename(this.path);
  }

  get stem(): string {
    const n = this.name;
    const i = n.lastIndexOf(".");
    return i > 0 ? n.slice(0, i) : n;
  }

  get suffix(): string {
    const n = this.name;
    const i = n.lastIndexOf(".");
    return i > 0 ? n.slice(i) : "";
  }

  get parent(): Path {
    return new Path(nodepath.dirname(this.path));
  }

  get parts(): string[] {
    return this.path.split(nodepath.sep).filter(Boolean);
  }

  with_suffix(suffix: string): Path {
    return new Path(this.parent.path, this.stem + suffix);
  }

  with_name(name: string): Path {
    return new Path(this.parent.path, name);
  }

  exists(): boolean {
    return fs.existsSync(this.path);
  }

  is_file(): boolean {
    return fs.existsSync(this.path) && fs.statSync(this.path).isFile();
  }

  is_dir(): boolean {
    return fs.existsSync(this.path) && fs.statSync(this.path).isDirectory();
  }

  resolve(): Path {
    return new Path(nodepath.resolve(this.path));
  }

  read_bytes(): Uint8Array {
    try {
      return new Uint8Array(fs.readFileSync(this.path));
    } catch (e: any) {
      if (e?.code === "ENOENT") throw new FileNotFoundError(`[Errno 2] No such file or directory: '${this.path}'`);
      throw e;
    }
  }

  write_bytes(data: Uint8Array): number {
    fs.writeFileSync(this.path, data);
    return data.length;
  }

  read_text(encoding = "utf-8"): string {
    return new TextDecoder(encoding as "utf-8").decode(this.read_bytes());
  }

  write_text(text: string): number {
    fs.writeFileSync(this.path, text, "utf-8");
    return text.length;
  }

  mkdir(opts: { parents?: boolean; exist_ok?: boolean } = {}): void {
    if (opts.exist_ok && this.exists()) return;
    fs.mkdirSync(this.path, { recursive: opts.parents ?? false });
  }

  unlink(opts: { missing_ok?: boolean } = {}): void {
    if (opts.missing_ok && !this.exists()) return;
    fs.unlinkSync(this.path);
  }

  /** `os.replace(self, target)` / `Path.replace` */
  replace(target: string | Path): Path {
    fs.renameSync(this.path, String(target));
    return new Path(String(target));
  }

  iterdir(): Path[] {
    return fs.readdirSync(this.path).sort().map((n) => this.div(n));
  }

  /** `glob` with `*`, `?` and a leading `**` segment. */
  glob(pattern: string): Path[] {
    const recursive = pattern.startsWith("**/");
    const leaf = recursive ? pattern.slice(3) : pattern;
    const re = new RegExp(
      "^" + leaf.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]") + "$",
    );
    const out: Path[] = [];
    const walk = (dir: string): void => {
      if (!fs.existsSync(dir)) return;
      for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const full = nodepath.join(dir, ent.name);
        if (re.test(ent.name)) out.push(new Path(full));
        if (recursive && ent.isDirectory()) walk(full);
      }
    };
    walk(this.path);
    return out;
  }

  rglob(pattern: string): Path[] {
    return this.glob("**/" + pattern);
  }

  stat(): fs.Stats {
    return fs.statSync(this.path);
  }
}

/** Accepts `str | os.PathLike` like Python APIs do. */
export type PathLike = string | Path;

export function fspath(p: PathLike): string {
  return String(p);
}
