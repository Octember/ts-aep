// Drop `x as T` casts that the strict type checker already proves: the type of
// `x` (strictNullChecks on) is assignable to `T`, and is not `any`/`unknown`.
// Literals (`null`, `[]`, `{}`, strings, numbers) and `as const` are kept.
// Type-only edit: the emitted JavaScript does not change (check with
// bun tools/js_equal.ts).
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
const program = ts.createProgram(cfg.fileNames, { ...cfg.options, strict: true, noImplicitAny: true, strictNullChecks: true });
const checker = program.getTypeChecker();

const LOOSE = ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.Null | ts.TypeFlags.Undefined;
const unparen = (e: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(e) ? unparen(e.expression) : e);
const callee = (e: ts.Expression) => (ts.isCallExpression(e) ? e.expression.getText().replace(/^.*\./, "") : null);

let total = 0;
for (const sf of program.getSourceFiles()) {
  const rel = path.relative(ROOT, sf.fileName);
  if (!rel.startsWith("src/")) continue;
  if (only.length && !only.includes(sf.fileName)) continue;
  const edits: [number, number, string][] = [];
  const visit = (n: ts.Node) => {
    ts.forEachChild(n, visit);
    if (!ts.isAsExpression(n)) return;
    if (ts.isTypeReferenceNode(n.type) && n.type.typeName.getText(sf) === "const") return;
    const inner = unparen(n.expression);
    if (calls && !calls.has(callee(inner) ?? "")) return;
    if (
      ts.isLiteralExpression(inner) || ts.isArrayLiteralExpression(inner) || ts.isObjectLiteralExpression(inner) ||
      inner.kind === ts.SyntaxKind.NullKeyword || ts.isAsExpression(inner) || ts.isSatisfiesExpression(inner)
    ) return;
    const from = checker.getTypeAtLocation(inner);
    if (from.flags & LOOSE) return;
    const to = checker.getTypeFromTypeNode(n.type);
    if (!checker.isTypeAssignableTo(from, to)) return;
    // `(f() as T).x` -> `f().x`: drop the parentheses the cast needed.
    const outer = ts.isParenthesizedExpression(n.parent) ? n.parent : n;
    const keep_parens = outer !== n && !(ts.isCallExpression(inner) || ts.isIdentifier(inner) || ts.isPropertyAccessExpression(inner) || ts.isElementAccessExpression(inner));
    const text = inner.getText(sf);
    edits.push([outer.getStart(sf), outer.getEnd(), keep_parens ? `(${text})` : text]);
  };
  visit(sf);
  if (!edits.length) continue;
  // Nested casts: keep only outermost-first non-overlapping edits, applied from the end.
  edits.sort((a, b) => a[0] - b[0]);
  const chosen: typeof edits = [];
  for (const e of edits) if (!chosen.length || e[0] >= chosen.at(-1)![1]) chosen.push(e);
  total += chosen.length;
  console.log(`${rel}: ${chosen.length}`);
  if (dry) continue;
  let text = sf.getFullText();
  for (const [s, e, r] of chosen.reverse()) text = text.slice(0, s) + r + text.slice(e);
  fs.writeFileSync(sf.fileName, text);
}
console.log(`${dry ? "would drop" : "dropped"} ${total} casts`);
