// Drop `x as T` (and `x as unknown as T`) casts the strict type checker
// already proves: the type of `x` (strictNullChecks on) is assignable to `T`
// and is not `any`/`unknown`. Literals (`null`, `[]`, `{}`, strings, numbers),
// `as const`, and casts to `any`/`unknown` are kept.
//
// Type-only edit, checked as it goes: a cast whose removal changes the file's
// emitted JavaScript is kept, and a file whose rewrite makes `tsc` fail or
// adds a strict-mode error anywhere is restored.
//
// usage: bun tools/codemods/drop_redundant_casts.ts [--dry] [--calls f,g] [files...]
//   --calls f,g  only casts of a call to one of these functions
//   files        limit to these files (default: every file under src)

import ts from "typescript";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const ci = args.indexOf("--calls");
const calls = ci >= 0 ? new Set(args[ci + 1].split(",")) : null;
const only = args.filter((a, i) => !a.startsWith("--") && (ci < 0 || i !== ci + 1)).map((f) => path.resolve(f));

const cfg = ts.getParsedCommandLineOfConfigFile(path.join(ROOT, "tsconfig.json"), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })!;
const STRICT = { ...cfg.options, strict: true, noImplicitAny: true, strictNullChecks: true };
const emit = (f: string, text: string) =>
  ts.transpileModule(text, {
    fileName: f,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true, verbatimModuleSyntax: false },
  }).outputText;
const errors_by_file = (options: ts.CompilerOptions) => {
  const p = ts.createProgram(cfg.fileNames, options);
  const out = new Map<string, number>();
  for (const d of ts.getPreEmitDiagnostics(p)) {
    const f = d.file?.fileName ?? "";
    out.set(f, (out.get(f) ?? 0) + 1);
  }
  return out;
};

const program = ts.createProgram(cfg.fileNames, STRICT);
const checker = program.getTypeChecker();

const LOOSE = ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.Null | ts.TypeFlags.Undefined;
const unparen = (e: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(e) ? unparen(e.expression) : e);
const is_loose_node = (t: ts.TypeNode) => t.kind === ts.SyntaxKind.AnyKeyword || t.kind === ts.SyntaxKind.UnknownKeyword;
const callee = (e: ts.Expression) => (ts.isCallExpression(e) ? e.expression.getText().replace(/^.*\./, "") : null);

type Edit = [number, number, string];
const original = new Map<string, string>();
const planned = new Map<string, Edit[]>();
for (const sf of program.getSourceFiles()) {
  const rel = path.relative(ROOT, sf.fileName);
  if (!rel.startsWith("src/")) continue;
  if (only.length && !only.includes(sf.fileName)) continue;
  const edits: Edit[] = [];
  const visit = (n: ts.Node) => {
    ts.forEachChild(n, visit);
    if (!ts.isAsExpression(n) || ts.isAsExpression(n.parent)) return;
    if (ts.isTypeReferenceNode(n.type) && n.type.typeName.getText(sf) === "const") return;
    if (is_loose_node(n.type)) return;
    // `x as unknown as T`: judge `x` against `T`.
    let src: ts.Expression = n.expression;
    while (ts.isAsExpression(unparen(src)) && is_loose_node((unparen(src) as ts.AsExpression).type)) src = (unparen(src) as ts.AsExpression).expression;
    const inner = unparen(src);
    if (calls && !calls.has(callee(inner) ?? "")) return;
    if (
      ts.isLiteralExpression(inner) || ts.isArrayLiteralExpression(inner) || ts.isObjectLiteralExpression(inner) ||
      inner.kind === ts.SyntaxKind.NullKeyword || ts.isAsExpression(inner) || ts.isSatisfiesExpression(inner)
    ) return;
    const from = checker.getTypeAtLocation(inner);
    if (from.flags & LOOSE) return;
    if (!checker.isTypeAssignableTo(from, checker.getTypeFromTypeNode(n.type))) return;
    // `(f() as T).x` -> `f().x` when the parentheses only served the cast;
    // the emit check below keeps whichever spelling leaves the JS unchanged.
    const outer = ts.isParenthesizedExpression(n.parent) ? n.parent : n;
    const text = src.getText(sf);
    edits.push([outer.getStart(sf), outer.getEnd(), text]);
    if (outer !== n) edits.push([outer.getStart(sf), outer.getEnd(), `(${text})`]);
  };
  visit(sf);
  if (!edits.length) continue;
  // Keep each edit only if the file's emit stays the same with it applied.
  const base_text = sf.getFullText();
  const base_emit = emit(sf.fileName, base_text);
  const apply = (es: Edit[]) => {
    let t = base_text;
    for (const [s, e, r] of [...es].sort((a, b) => b[0] - a[0])) t = t.slice(0, s) + r + t.slice(e);
    return t;
  };
  edits.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const chosen: Edit[] = [];
  for (const e of edits) {
    if (chosen.length && e[0] < chosen.at(-1)![1]) continue;
    if (emit(sf.fileName, apply([...chosen, e])) === base_emit) chosen.push(e);
  }
  if (!chosen.length) continue;
  original.set(sf.fileName, base_text);
  planned.set(sf.fileName, chosen);
  if (!dry) fs.writeFileSync(sf.fileName, apply(chosen));
}

if (!dry && planned.size) {
  // Restore files until tsc is clean and no file gains a strict-mode error.
  const base_strict = new Map<string, number>();
  for (const [f, n] of errors_by_file(STRICT)) base_strict.set(f, n);
  for (const f of original.keys()) fs.writeFileSync(f, original.get(f)!);
  const before_strict = errors_by_file(STRICT);
  for (const f of original.keys()) {
    let t = original.get(f)!;
    for (const [s, e, r] of [...planned.get(f)!].sort((a, b) => b[0] - a[0])) t = t.slice(0, s) + r + t.slice(e);
    fs.writeFileSync(f, t);
  }
  for (let round = 0; round < 10; round++) {
    const loose = errors_by_file(cfg.options);
    const strict = round === 0 ? base_strict : errors_by_file(STRICT);
    const bad = new Set<string>();
    for (const f of loose.keys()) if (planned.has(f)) bad.add(f);
    for (const [f, n] of strict) if (n > (before_strict.get(f) ?? 0)) bad.add(planned.has(f) ? f : "*");
    if (bad.has("*") || (bad.size === 0 && [...loose.keys()].length)) {
      // An error outside the rewritten files: find its cause by restoring them all.
      console.error("errors outside rewritten files; restoring everything");
      for (const f of original.keys()) fs.writeFileSync(f, original.get(f)!);
      planned.clear();
      break;
    }
    if (!bad.size) break;
    for (const f of bad) {
      console.log(`restored ${path.relative(ROOT, f)} (type errors)`);
      fs.writeFileSync(f, original.get(f)!);
      planned.delete(f);
    }
  }
}

let total = 0;
for (const [f, es] of planned) {
  total += es.length;
  console.log(`${path.relative(ROOT, f)}: ${es.length}`);
}
console.log(`${dry ? "would drop" : "dropped"} ${total} casts`);
