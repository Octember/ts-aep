// Give every `define(Cls, {...})` class an explicit constructor that assigns
// its own fields, replacing pyrt's generic `attrs_init`. Defaults come from
// the spec's `default:` source when written, else from the runtime value
// `fmt_field` computed. Classes extending `AttrsBase` become roots that check
// keyword names. `tools/check_attrs_defaults.ts` verifies the result.
// usage: bun tools/codemods/attrs_constructors.ts [--dry]
import ts from "typescript";
import * as fs from "node:fs";
import * as path from "node:path";
import { fields, type Attribute } from "../../src/pyrt/attrs.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const DRY = process.argv.includes("--dry");
const files = fs.globSync("src/py_aep/**/*.ts", { cwd: ROOT }).sort();
const RESERVED = new Set(["default", "class", "function", "new", "delete", "in", "of", "for", "if", "do", "var", "let", "const", "this", "super", "return", "switch", "case", "typeof", "void", "with", "yield", "enum", "export", "import", "kw"]);
const problems: string[] = [];

function lit(v: any): string | null {
  if (v === null) return "null";
  if (typeof v === "boolean") return String(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "bigint") return `${v}n`;
  if (typeof v === "number") return Object.is(v, -0) ? "-0" : Number.isNaN(v) ? "NaN" : String(v);
  if (v instanceof Uint8Array && v.constructor === Uint8Array) {
    return v.every((x) => x === 0) ? `new Uint8Array(${v.length})` : `new Uint8Array([${[...v].join(", ")}])`;
  }
  if (v && typeof v === "object" && "__factory__" in v) {
    const r = v.__factory__();
    if (Array.isArray(r) && r.length === 0) return "[]";
  }
  return null;
}

/** A base class has a getter without setter for `name` (shadowed at runtime, but TS calls it read-only). */
function getterOnly(cls: Function, name: string): boolean {
  for (let p = Object.getPrototypeOf(cls.prototype); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    const d = Object.getOwnPropertyDescriptor(p, name);
    if (d) return !!d.get && !d.set;
  }
  return false;
}

let generated = 0;
for (const rel of files) {
  const file = path.join(ROOT, rel);
  const src = fs.readFileSync(file, "utf8");
  if (!/^define\(/m.test(src)) continue;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true);
  const mod = await import(file);
  const classes = new Map<string, ts.ClassDeclaration>();
  for (const s of sf.statements) if (ts.isClassDeclaration(s) && s.name) classes.set(s.name.text, s);

  type Edit = { start: number; end: number; text: string };
  const edits: Edit[] = [];
  let needsCheck = false;
  for (const s of sf.statements) {
    if (!ts.isExpressionStatement(s) || !ts.isCallExpression(s.expression)) continue;
    const call = s.expression;
    if (!ts.isIdentifier(call.expression) || call.expression.text !== "define") continue;
    const nameNode = call.arguments[0];
    if (!nameNode || !ts.isIdentifier(nameNode)) continue;
    const cname = nameNode.text;
    const decl = classes.get(cname);
    const cls = mod[cname];
    if (!decl || typeof cls !== "function") {
      problems.push(`${rel}: ${cname} not a local exported class`);
      continue;
    }
    if (decl.members.some((m) => ts.isConstructorDeclaration(m))) {
      problems.push(`${rel}: ${cname} already has a constructor`);
      continue;
    }
    for (const m of decl.members) {
      if (ts.isPropertyDeclaration(m) && m.initializer && !m.modifiers?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword)) {
        problems.push(`${rel}: ${cname}.${m.name.getText(sf)} has an initializer`);
      }
    }
    const heritage = decl.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
    const root = heritage?.expression.getText(sf) === "AttrsBase";
    const spec = call.arguments[1];
    const specProps = new Map<string, ts.Expression>();
    if (spec && ts.isObjectLiteralExpression(spec)) {
      for (const p of spec.properties) {
        if (ts.isPropertyAssignment(p)) specProps.set(p.name.getText(sf).replace(/^["']|["']$/g, ""), p.initializer);
      }
    } else if (spec) {
      problems.push(`${rel}: ${cname} spec is not an object literal`);
      continue;
    }

    const all: readonly Attribute[] = fields(cls);
    const own = all.filter((a) => specProps.has(a.name));
    const lines: string[] = [];
    const locals: [string, string, string][] = []; // alias, field name, default source
    const noInit: [string, string][] = [];
    for (const a of own) {
      const init = specProps.get(a.name)!;
      let dsrc: string | null = null;
      const obj = ts.isObjectLiteralExpression(init)
        ? init
        : ts.isCallExpression(init)
          ? [...init.arguments].reverse().find((x) => ts.isObjectLiteralExpression(x)) as ts.ObjectLiteralExpression | undefined
          : undefined;
      const dprop = obj?.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === "default") as ts.PropertyAssignment | undefined;
      if (dprop) {
        const d = dprop.initializer;
        if (ts.isCallExpression(d) && ts.isIdentifier(d.expression) && d.expression.text === "Factory") {
          const fn = d.arguments[0];
          dsrc = ts.isArrowFunction(fn) && !ts.isBlock(fn.body) ? fn.body.getText(sf) : `(${fn.getText(sf)})()`;
          if (/^\{/.test(dsrc)) dsrc = `(${dsrc})`;
        } else {
          dsrc = d.getText(sf);
        }
      } else {
        dsrc = lit(a.default);
      }
      if (dsrc == null) {
        problems.push(`${rel}: ${cname}.${a.name} default not expressible`);
        continue;
      }
      if (a.init) locals.push([a.alias, a.name, dsrc]);
      else noInit.push([a.name, dsrc]);
    }
    const idents = new Set(locals.flatMap(([, , d]) => d.match(/[A-Za-z_$][\w$]*/g) ?? []));
    for (const [alias] of locals) {
      if (RESERVED.has(alias) || idents.has(alias)) problems.push(`${rel}: ${cname} local '${alias}' collides`);
    }

    lines.push(`  constructor(kw: Record<string, any> = {}) {`);
    if (root) {
      lines.push(`    check_init_kwargs(new.target, kw);`);
      needsCheck = true;
      const hc = decl.heritageClauses!.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)!;
      edits.push({ start: hc.getFullStart(), end: hc.end, text: "" });
    } else {
      lines.push(`    super(kw);`);
    }
    if (locals.length) {
      const destr = locals.map(([alias, , d]) => `${alias} = ${d}`);
      const one = `    const { ${destr.join(", ")} } = kw;`;
      if (one.length <= 100) lines.push(one);
      else lines.push(`    const {`, ...destr.map((x) => `      ${x},`), `    } = kw;`);
      for (const [alias, name] of locals) lines.push(`    ${getterOnly(cls, name) ? "(this as any)" : "this"}.${name} = ${alias};`);
    }
    for (const [name, d] of noInit) lines.push(`    this.${name} = ${d};`);
    if (root) lines.push(`    init_generic_fields(this, new.target, kw);`);
    lines.push(`  }`);

    const props = decl.members.filter((m) => ts.isPropertyDeclaration(m));
    const after = props.length ? props[props.length - 1] : null;
    const at = after ? after.end : decl.members.pos;
    const prefix = after ? "\n\n" : "\n";
    const suffix = after ? "" : decl.members.length ? "\n" : "";
    edits.push({ start: at, end: at, text: prefix + lines.join("\n") + suffix });
    const close = call.end - 1;
    edits.push({ start: close, end: close, text: spec ? ", { init: false }" : ", {}, { init: false }" });
    generated++;
  }

  if (!edits.length) continue;
  let out = src;
  for (const e of edits.sort((x, y) => y.start - x.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  if (needsCheck) {
    out = out.replace(/import \{([^}]*)\} from "(\.\.\/)+pyrt\/index\.ts";/, (m, names: string) => {
      const list = names.split(",").map((x) => x.trim()).filter((x) => x && x !== "AttrsBase");
      list.push("check_init_kwargs", "init_generic_fields");
      const multi = names.includes("\n");
      return multi ? `import {\n${list.map((x) => `  ${x},`).join("\n")}\n} from "${m.match(/"([^"]+)"/)![1]}";` : `import { ${list.join(", ")} } from "${m.match(/"([^"]+)"/)![1]}";`;
    });
  }
  if (!DRY) fs.writeFileSync(file, out);
}
console.log({ generated, problems: problems.length });
for (const p of problems) console.log("  " + p);
