// Replace `deferred(...)` cycle breakers with static imports wherever the
// target module cannot reach the importing module through value imports, so
// the static import adds no cycle. Then run `bun tools/gen_deferred_modules.ts`.
// usage: bun tools/codemods/acyclic_deferred.ts [--dry]
import ts from "typescript";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const DRY = process.argv.includes("--dry");
const files = fs.globSync("src/py_aep/**/*.ts", { cwd: ROOT }).map((f) => path.join(ROOT, f)).sort();
const parse = (f: string) => ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.ES2022, true);

/** Value-level module edges (type-only imports are erased and do not count). */
function edges(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  for (const s of sf.statements) {
    let spec: ts.Expression | undefined;
    if (ts.isImportDeclaration(s)) {
      const c = s.importClause;
      if (c?.isTypeOnly) continue;
      const nb = c?.namedBindings;
      if (c && !c.name && nb && ts.isNamedImports(nb) && nb.elements.length > 0 && nb.elements.every((e) => e.isTypeOnly)) continue;
      spec = s.moduleSpecifier;
    } else if (ts.isExportDeclaration(s) && s.moduleSpecifier && !s.isTypeOnly) {
      spec = s.moduleSpecifier;
    }
    if (spec && ts.isStringLiteral(spec) && spec.text.startsWith(".")) out.push(path.resolve(path.dirname(sf.fileName), spec.text));
  }
  return out;
}

const graph = new Map<string, Set<string>>();
for (const f of files) graph.set(f, new Set(edges(parse(f))));
const reaches = (from: string, to: string): boolean => {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const x = stack.pop()!;
    if (x === to) return true;
    if (seen.has(x)) continue;
    seen.add(x);
    for (const y of graph.get(x) ?? []) stack.push(y);
  }
  return false;
};

let converted = 0;
let kept = 0;
for (const f of files) {
  const sf = parse(f);
  const src = sf.text;
  type Def = { stmt: ts.VariableStatement; local: string; spec: string; target: string };
  const defs: Def[] = [];
  for (const s of sf.statements) {
    if (!ts.isVariableStatement(s) || s.declarationList.declarations.length !== 1) continue;
    const d = s.declarationList.declarations[0];
    const init = d.initializer;
    if (!ts.isIdentifier(d.name) || !init || !ts.isCallExpression(init) || !ts.isIdentifier(init.expression) || init.expression.text !== "deferred") continue;
    const ta = init.typeArguments?.[0];
    if (!ta || !ts.isImportTypeNode(ta) || !ts.isLiteralTypeNode(ta.argument) || !ts.isStringLiteral(ta.argument.literal)) continue;
    const spec = ta.argument.literal.text;
    defs.push({ stmt: s, local: d.name.text, spec, target: path.resolve(path.dirname(f), spec) });
  }
  if (!defs.length) continue;

  type Edit = { start: number; end: number; text: string };
  const edits: Edit[] = [];
  const newImports: string[] = [];
  let firstRemoval: Edit | null = null;
  // Every identifier in the file, to detect name clashes.
  const idents = new Map<string, ts.Identifier[]>();
  const collect = (n: ts.Node) => {
    if (ts.isIdentifier(n)) idents.set(n.text, [...(idents.get(n.text) ?? []), n]);
    ts.forEachChild(n, collect);
  };
  collect(sf);

  for (const def of defs) {
    if (reaches(def.target, f)) {
      kept++;
      continue;
    }
    const isMemberName = (id: ts.Identifier) => {
      const p = id.parent;
      return (ts.isPropertyAccessExpression(p) && p.name === id) ||
        ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p)) && p.name === id);
    };
    const uses = (idents.get(def.local) ?? []).filter((n) => n.parent !== def.stmt.declarationList.declarations[0] && !isMemberName(n));
    const names = new Set<string>();
    let simple = true;
    for (const u of uses) {
      const call = u.parent;
      const pa = call?.parent;
      if (ts.isCallExpression(call) && call.expression === u && call.arguments.length === 0 && pa && ts.isPropertyAccessExpression(pa) && pa.expression === call) {
        names.add(pa.name.text);
      } else simple = false;
    }
    // Type-only imports of the same names from the same module get upgraded.
    const typeImports: ts.ImportDeclaration[] = sf.statements.filter(
      (s): s is ts.ImportDeclaration => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) &&
        path.resolve(path.dirname(f), s.moduleSpecifier.text) === def.target && !!s.importClause?.isTypeOnly,
    );
    const typeNames = new Set<string>();
    for (const ti of typeImports) {
      const nb = ti.importClause!.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) typeNames.add(e.name.text);
    }
    const clash = [...names].some((n) =>
      (idents.get(n) ?? []).some((id) => {
        const p = id.parent;
        if (isMemberName(id)) return false;
        if (typeNames.has(n) && ts.isImportSpecifier(p) && typeImports.some((ti) => ti.importClause!.namedBindings === p.parent)) return false;
        if (typeNames.has(n) && (ts.isTypeReferenceNode(p) || ts.isTypeQueryNode(p) || ts.isExpressionWithTypeArguments(p))) return false;
        return true;
      }),
    );
    let ns: string | null = null;
    if (!simple || clash) {
      ns = def.local.replace(/^_+/, "");
      if (idents.has(ns)) ns = `${ns}_mod`;
      if (idents.has(ns)) {
        kept++;
        continue;
      }
    }

    // Drop the `const _x = deferred(...)` line; the first one becomes the new imports.
    const lead = src.slice(def.stmt.getFullStart(), def.stmt.getStart(sf));
    const removal = { start: /^\s*$/.test(lead) ? def.stmt.getFullStart() : def.stmt.getStart(sf), end: def.stmt.end, text: "" };
    edits.push(removal);
    firstRemoval ??= removal;
    for (const u of uses) {
      const call = u.parent as ts.CallExpression;
      if (ns) edits.push({ start: call.getStart(sf), end: call.end, text: ns });
      else {
        const pa = call.parent as ts.PropertyAccessExpression;
        const outer = ts.isParenthesizedExpression(pa.parent) ? pa.parent : pa;
        edits.push({ start: outer.getStart(sf), end: outer.end, text: pa.name.text });
      }
    }
    if (ns) newImports.push(`import * as ${ns} from "${def.spec}";`);
    else {
      newImports.push(`import { ${[...names].sort().join(", ")} } from "${def.spec}";`);
      for (const ti of typeImports) {
        const nb = ti.importClause!.namedBindings as ts.NamedImports;
        const rest = nb.elements.filter((e) => !names.has(e.name.text));
        if (rest.length === nb.elements.length) continue;
        let tend = ti.end;
        if (src[tend] === "\n") tend++;
        edits.push({
          start: ti.getStart(sf),
          end: rest.length ? ti.end : tend,
          text: rest.length ? `import type { ${rest.map((e) => e.getText(sf)).join(", ")} } from "${(ti.moduleSpecifier as ts.StringLiteral).text}";` : "",
        });
      }
    }
    graph.get(f)!.add(def.target);
    converted++;
  }
  if (!newImports.length) continue;

  firstRemoval!.text = (firstRemoval!.start > 0 ? "\n" : "") + newImports.join("\n");
  let out = src;
  for (const e of edits.sort((a, b) => b.start - a.start || b.end - a.end)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  if (!DRY) fs.writeFileSync(f, out);
}
console.log({ converted, kept });
