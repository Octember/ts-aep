// Parse -> save every sample .aep with the TS port; report byte-identity.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as py_aep from "../src/py_aep/index.ts";

const files = fs.globSync("samples/**/*.aep").sort();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ts-aep-rt-"));
let identical = 0;
const differ: string[] = [];
const failed: string[] = [];
for (const f of files) {
  try {
    const app = py_aep.parse(f);
    const out = path.join(tmp, `${identical + differ.length + failed.length}.aep`);
    app.project.save(out);
    const a = fs.readFileSync(f);
    const b = fs.readFileSync(out);
    if (a.equals(b)) identical++;
    else differ.push(f);
  } catch (e: any) {
    failed.push(`${f}: ${e?.constructor?.name}: ${String(e?.message).slice(0, 120)}`);
  }
}
console.log(JSON.stringify({ total: files.length, identical, differ: differ.length, failed: failed.length }));
for (const d of differ.slice(0, 20)) console.log("DIFF", d);
for (const d of failed.slice(0, 20)) console.log("FAIL", d);
fs.writeFileSync("../ts-roundtrip-differ.json", JSON.stringify(differ));
