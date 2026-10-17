// Build the published package: dist/index.js (one ESM bundle, dependencies
// external) + dist/types (declarations from tsc, `.ts` specifiers -> `.js`).
import * as fs from "node:fs";
import * as path from "node:path";

fs.rmSync("dist", { recursive: true, force: true });

const out = await Bun.build({
  entrypoints: ["src/py_aep/index.ts"],
  outdir: "dist",
  format: "esm",
  target: "browser",
  packages: "external",
  sourcemap: "linked",
});
if (!out.success) {
  for (const log of out.logs) console.error(log);
  process.exit(1);
}

const tsc = Bun.spawnSync(["bunx", "tsc", "-p", "tsconfig.build.json"], { stdout: "inherit", stderr: "inherit" });
if (tsc.exitCode !== 0) process.exit(tsc.exitCode ?? 1);

let rewritten = 0;
for (const file of fs.readdirSync("dist/types", { recursive: true }) as string[]) {
  if (!file.endsWith(".d.ts")) continue;
  const p = path.join("dist/types", file);
  const src = fs.readFileSync(p, "utf8");
  const next = src.replace(/(from\s+|import\s+|import\(\s*)(["'])(\.{1,2}\/[^"']+)\.ts\2/g, (_, pre, q, spec) => `${pre}${q}${spec}.js${q}`);
  if (next !== src) {
    fs.writeFileSync(p, next);
    rewritten++;
  }
}
console.log(`dist/index.js + dist/types (${rewritten} declaration files rewritten to .js specifiers)`);
