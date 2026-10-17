// Every attrs class's constructor must produce the defaults its `define`
// spec declares (after converters), and accept exactly the spec's init names.
// usage: bun tools/check_attrs_defaults.ts   (exit 1 on any mismatch)
import * as fs from "node:fs";
import * as path from "node:path";
import { fields } from "../src/pyrt/attrs.ts";
import { py_eq, TypeError_ } from "../src/pyrt/index.ts";

const ROOT = path.resolve(import.meta.dir, "..");
const errors: string[] = [];
const seen = new Set<Function>();
let checked = 0;
for (const rel of fs.globSync("src/py_aep/**/*.ts", { cwd: ROOT }).sort()) {
  if (!/^define\(/m.test(fs.readFileSync(path.join(ROOT, rel), "utf8"))) continue;
  const mod = await import(path.join(ROOT, rel));
  for (const [name, cls] of Object.entries(mod)) {
    if (typeof cls !== "function" || seen.has(cls)) continue;
    let attrs;
    try {
      attrs = fields(cls);
    } catch {
      continue;
    }
    seen.add(cls);
    // Hand-written `__init__` upstream with its own keyword contract.
    if (name === "DeferredListChunk") continue;
    checked++;
    const inst: any = new (cls as any)();
    for (const a of attrs) {
      const d = a.default;
      let want = d && typeof d === "object" && "__factory__" in d ? d.__factory__() : d;
      if (a.converter) want = a.converter(want);
      if (!py_eq(inst[a.name], want)) errors.push(`${rel}: ${name}.${a.name}: constructor gives ${String(inst[a.name])}, spec says ${String(want)}`);
    }
    for (const a of attrs.filter((x) => x.init)) {
      const probe = Symbol("probe");
      const got: any = new (cls as any)({ [a.alias]: probe });
      const stored = got[a.name];
      if (!a.converter && stored !== probe) errors.push(`${rel}: ${name}: kw '${a.alias}' does not reach field ${a.name}`);
    }
    try {
      new (cls as any)({ __not_a_field__: 1 });
      errors.push(`${rel}: ${name}: unexpected keyword accepted`);
    } catch (e) {
      if (!(e instanceof TypeError_)) throw e;
    }
  }
}
console.log({ checked, errors: errors.length });
for (const e of errors) console.log("  " + e);
process.exit(errors.length ? 1 : 0);
