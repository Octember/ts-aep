// CLEANUP.md pass 3 (mechanical part): doc comments speak TypeScript.
//   `None` / `True` / `False`             -> `null` / `true` / `false`
//   {@link py_aep.models.x.Name.member}   -> {@link Name.member}
// Comments only. usage: bun tools/codemods/pass3_ts_terms.ts [--dry]
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const DRY = process.argv.includes("--dry");
const LITERALS: Record<string, string> = { None: "null", True: "true", False: "false" };
let literals = 0;
let links = 0;
let touched = 0;

for (const rel of fs.readdirSync(path.join(ROOT, "src/py_aep"), { recursive: true }) as string[]) {
  if (!rel.endsWith(".ts")) continue;
  const file = path.join(ROOT, "src/py_aep", rel);
  const text = fs.readFileSync(file, "utf8");
  const next = text.replace(/\/\*\*[\s\S]*?\*\//g, (c) =>
    c
      .replace(/`(None|True|False)`/g, (_m, w: string) => {
        literals++;
        return `\`${LITERALS[w]}\``;
      })
      .replace(/\{@link py_aep(?:\.[a-z_][\w]*)*\.([A-Z][\w.]*)/g, (_m, rest: string) => {
        links++;
        return `{@link ${rest}`;
      }),
  );
  if (next !== text) {
    touched++;
    if (!DRY) fs.writeFileSync(file, next);
  }
}
console.log(JSON.stringify({ files: touched, literals, links }));
