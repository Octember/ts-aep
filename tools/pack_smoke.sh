#!/usr/bin/env bash
# Pack the package, install the tarball into a fresh project with npm, and
# check that Node and Bun parse+save a sample byte-identically and that a
# strict TypeScript consumer typechecks against the published declarations.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
bun run --cwd "$root" build >/dev/null
bun pm pack --cwd "$root" --destination "$work" --quiet >/dev/null
tarball=$(ls "$work"/*.tgz)
cd "$work"
cat > package.json <<'JSON'
{ "name": "consumer", "private": true, "type": "module" }
JSON
cat > smoke.mjs <<'JS'
import { parse } from "@bevyl-ai/aep-toolkit";
import { readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
for (const src of process.argv.slice(2)) {
  const out = join(mkdtempSync(join(tmpdir(), "ts-aep-")), "out.aep");
  parse(src).project.save(out);
  if (Buffer.compare(readFileSync(src), readFileSync(out)) !== 0) {
    console.error(`not byte-identical: ${src}`);
    process.exit(1);
  }
}
console.log(`${process.versions.bun ? "bun" : "node"}: ${process.argv.length - 2} samples byte-identical`);
JS
cat > types.ts <<'TS'
import { parse, memfs, type CompItem } from "@bevyl-ai/aep-toolkit";
memfs.write("/x.aep", new Uint8Array());
export const comps: CompItem[] = parse("/x.aep").project.compositions;
TS
cat > tsconfig.json <<'JSON'
{ "compilerOptions": { "module": "nodenext", "moduleResolution": "nodenext", "target": "es2022", "strict": true, "noEmit": true, "types": [] }, "include": ["types.ts"] }
JSON
npm install --silent --no-audit --no-fund "$tarball" typescript@5.9.2 >/dev/null
samples=("$root"/samples/models/text/text_writes.aep "$root"/samples/models/composition/bgColor.aep "$root"/samples/models/layer/autoOrient.aep)
node smoke.mjs "${samples[@]}"
bun smoke.mjs "${samples[@]}"
npx tsc -p .
echo "types: strict consumer typechecks"
