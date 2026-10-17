// CLEANUP.md pass 1: replace pyrt helpers with native TS where the type checker
// proves the rewrite exact. Calls it cannot prove stay as they are.
// usage: bun tools/codemods/pass1_native_idioms.ts [--dry] [--report]
import ts from "typescript";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const DRY = process.argv.includes("--dry");
const REPORT = process.argv.includes("--report");
const HELPERS = new Set(["py_bool", "py_or", "dict_get", "py_eq", "contains", "len", "range", "enumerate", "py_slice", "getattr", "getitem"]);

type Cat = "bool" | "str" | "num" | "array" | "bytes" | "map" | "set" | "obj";
interface Edit {
  start: number;
  end: number;
  text: string;
}

function loadProgram(): ts.Program {
  const cfg = ts.getParsedCommandLineOfConfigFile(path.join(ROOT, "tsconfig.json"), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(String(d.messageText));
    },
  })!;
  return ts.createProgram(cfg.fileNames, cfg.options);
}

function run(): { edits: number; kept: Map<string, number> } {
  const program = loadProgram();
  const checker = program.getTypeChecker();
  const isAssignable: (a: ts.Type, b: ts.Type) => boolean = (checker as any).isTypeAssignableTo.bind(checker);
  const files = program.getSourceFiles().filter((f) => f.fileName.startsWith(path.join(ROOT, "src/py_aep/")));

  // Types whose Python truth is not "is not None": anything with __len__ / __bool__, PyFloat, containers.
  const truthProbes: ts.Type[] = [];
  // Proxied classes: a plain read of a missing name throws, where getattr's `in` check returns the default.
  const proxyProbes: ts.Type[] = [];
  for (const f of program.getSourceFiles().filter((f) => f.fileName.startsWith(path.join(ROOT, "src/")))) {
    const visit = (n: ts.Node) => {
      if (ts.isClassDeclaration(n) && n.name) {
        const has = (name: string) => n.members.some((m) => m.name && ts.isIdentifier(m.name) && m.name.text === name);
        const declared = checker.getDeclaredTypeOfSymbol(checker.getSymbolAtLocation(n.name)!);
        if (has("__len__") || has("__bool__") || n.name.text === "PyFloat") truthProbes.push(declared);
        if (has("__getattr__")) proxyProbes.push(declared);
      }
      ts.forEachChild(n, visit);
    };
    visit(f);
  }
  const anyT = checker.getAnyType();
  truthProbes.push((checker as any).createArrayType(anyT));

  function objCat(t: ts.Type): Cat | null {
    if (checker.isArrayType(t) || checker.isTupleType(t)) return "array";
    const name = t.getSymbol()?.getName() ?? t.aliasSymbol?.getName();
    if (name === "Uint8Array") return "bytes";
    if (name === "Map" || name === "ReadonlyMap") return "map";
    if (name === "Set" || name === "ReadonlySet") return "set";
    if (name === "String" || name === "Number" || name === "Boolean" || name === "Object") return null;
    if (t.getProperty("__len__") || t.getProperty("__bool__") || t.getProperty("length") || t.getProperty("size")) return null;
    for (const p of truthProbes) if (isAssignable(p, t)) return null;
    return "obj";
  }

  function cat(t: ts.Type): Cat | null {
    const members = t.isUnion() ? t.types : [t];
    let out: Cat | null = null;
    for (const m of members) {
      const f = m.flags;
      let c: Cat | null;
      if (f & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) continue;
      if (f & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.BigIntLike | ts.TypeFlags.TypeParameter | ts.TypeFlags.Never)) return null;
      else if (f & ts.TypeFlags.BooleanLike) c = "bool";
      else if (f & ts.TypeFlags.StringLike) c = "str";
      else if (f & (ts.TypeFlags.NumberLike | ts.TypeFlags.EnumLike)) c = "num";
      else if (f & ts.TypeFlags.Object) c = objCat(m);
      else return null;
      if (c == null || (out != null && out !== c)) return null;
      out = c;
    }
    return out;
  }

  const typeCat = (e: ts.Expression) => cat(checker.getTypeAtLocation(e));

  function mapValueCat(e: ts.Expression): Cat | null {
    const t = checker.getTypeAtLocation(e);
    const args = checker.getTypeArguments(t as ts.TypeReference);
    return args?.length === 2 ? cat(args[1]) : null;
  }

  function arrayElemCat(e: ts.Expression): Cat | null {
    const t = checker.getTypeAtLocation(e);
    if (!checker.isArrayType(t)) return null;
    const [el] = checker.getTypeArguments(t as ts.TypeReference);
    return el ? cat(el) : null;
  }

  function fromPyrt(callee: ts.Expression): boolean {
    if (!ts.isIdentifier(callee) || !HELPERS.has(callee.text)) return false;
    let sym = checker.getSymbolAtLocation(callee);
    if (!sym) return false;
    if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    return !!sym.declarations?.some((d) => d.getSourceFile().fileName.includes("/src/pyrt/"));
  }

  // An expression that can never evaluate to null/undefined.
  function literalNonNull(e: ts.Expression): boolean {
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) return literalNonNull(e.expression);
    if (ts.isStringLiteralLike(e) || ts.isNumericLiteral(e) || ts.isTemplateExpression(e) || ts.isRegularExpressionLiteral(e)) return true;
    if (e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword) return true;
    if (ts.isArrayLiteralExpression(e) || ts.isObjectLiteralExpression(e) || ts.isNewExpression(e)) return true;
    if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return true;
    if (ts.isPrefixUnaryExpression(e) && ts.isNumericLiteral(e.operand)) return true;
    if (ts.isBinaryExpression(e) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken].includes(e.operatorToken.kind)) {
      return literalNonNull(e.left) && literalNonNull(e.right);
    }
    if (ts.isIdentifier(e)) {
      let s = checker.getSymbolAtLocation(e);
      if (s && s.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s);
      return !!s && !!(s.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Function));
    }
    // `Enum.MEMBER` / `TABLE.KEY` on a module-level const object literal or int_enum.
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) {
      const c = cat(checker.getTypeAtLocation(e));
      if (c !== "num" && c !== "str" && c !== "bool") return false;
      const d = checker.getSymbolAtLocation(e.expression)?.valueDeclaration;
      return !!d && ts.isVariableDeclaration(d) && ts.isVariableDeclarationList(d.parent) && !!(d.parent.flags & ts.NodeFlags.Const) &&
        ts.isSourceFile(d.parent.parent.parent);
    }
    return false;
  }

  const allFiles = program.getSourceFiles().filter((f) => f.fileName.startsWith(ROOT) && !f.fileName.includes("node_modules"));
  const nonNullMaps = new Map<ts.Symbol, boolean>();
  const READS = new Set(["get", "has", "keys", "values", "entries", "size", "forEach"]);
  const READ_HELPERS = new Set(["dict_get", "getitem", "contains", "len", "sorted", "mapping_items", "py_bool", "dict"]);

  /**
   * A Map stored in a const or class property whose initializer and every
   * `.set` store non-null values, and that is never handed elsewhere.
   */
  function mapValuesNonNull(e: ts.Expression): boolean {
    const nameNode = ts.isPropertyAccessExpression(e) ? e.name : ts.isIdentifier(e) ? e : null;
    if (!nameNode) return false;
    const sym = checker.getSymbolAtLocation(nameNode);
    if (!sym) return false;
    const cached = nonNullMaps.get(sym);
    if (cached != null) return cached;
    nonNullMaps.set(sym, false);
    const decls = sym.declarations ?? [];
    if (decls.length !== 1) return false;
    const d = decls[0];
    let init: ts.Expression | undefined;
    if (ts.isVariableDeclaration(d) && ts.isVariableDeclarationList(d.parent) && d.parent.flags & ts.NodeFlags.Const) init = d.initializer;
    else if (ts.isPropertyDeclaration(d)) init = d.initializer;
    if (!init || !ts.isNewExpression(init) || !ts.isIdentifier(init.expression) || init.expression.text !== "Map") return false;
    const arg = init.arguments?.[0];
    if (arg) {
      if (!ts.isArrayLiteralExpression(arg)) return false;
      for (const pair of arg.elements) {
        if (!ts.isArrayLiteralExpression(pair) || pair.elements.length !== 2 || !literalNonNull(pair.elements[1])) return false;
      }
    }
    const name = nameNode.text;
    // A static overridden in a subclass could hold other values.
    if (ts.isPropertyDeclaration(d)) {
      for (const f of allFiles) {
        let clash = false;
        const scan = (n: ts.Node) => {
          if (clash) return;
          if (ts.isPropertyDeclaration(n) && n !== d && n.name && ts.isIdentifier(n.name) && n.name.text === name) clash = true;
          ts.forEachChild(n, scan);
        };
        scan(f);
        if (clash) return false;
      }
    }
    for (const f of allFiles) {
      let ok = true;
      const scan = (n: ts.Node) => {
        if (!ok) return;
        if (ts.isIdentifier(n) && n.text === name && n !== (d as ts.NamedDeclaration).name && checker.getSymbolAtLocation(n) === sym) {
          const ref: ts.Node = ts.isPropertyAccessExpression(n.parent) && n.parent.name === n ? n.parent : n;
          const p = ref.parent;
          if (ts.isPropertyAccessExpression(p) && p.expression === ref) {
            if (READS.has(p.name.text)) return;
            if (p.name.text === "set" && ts.isCallExpression(p.parent) && p.parent.arguments.length === 2 && literalNonNull(p.parent.arguments[1])) return;
            ok = false;
          } else if (ts.isCallExpression(p) && p.arguments[0] === ref && ts.isIdentifier(p.expression) && READ_HELPERS.has(p.expression.text)) {
            return;
          } else if ((ts.isForOfStatement(p) && p.expression === ref) || ts.isSpreadElement(p)) {
            return;
          } else {
            ok = false;
          }
        }
        ts.forEachChild(n, scan);
      };
      scan(f);
      if (!ok) return false;
    }
    nonNullMaps.set(sym, true);
    return true;
  }

  const kept = new Map<string, number>();
  let total = 0;

  for (const sf of files) {
    const src = sf.text;
    const edits: Edit[] = [];
    const text = (n: ts.Node) => src.slice(n.getStart(sf), n.end);
    const PRIMARY = new Set([
      ts.SyntaxKind.Identifier, ts.SyntaxKind.PropertyAccessExpression, ts.SyntaxKind.ElementAccessExpression,
      ts.SyntaxKind.CallExpression, ts.SyntaxKind.ParenthesizedExpression, ts.SyntaxKind.ThisKeyword,
      ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NumericLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral,
      ts.SyntaxKind.TemplateExpression, ts.SyntaxKind.ArrayLiteralExpression, ts.SyntaxKind.NullKeyword,
      ts.SyntaxKind.NonNullExpression,
    ]);
    const atom = (n: ts.Expression) => (PRIMARY.has(n.kind) && !ts.isNewExpression(n) ? text(n) : `(${text(n)})`);
    // Operand of `||` / `??` / `===`: only these need no parentheses.
    const LOOSE = new Set([ts.SyntaxKind.ConditionalExpression, ts.SyntaxKind.ArrowFunction, ts.SyntaxKind.YieldExpression]);
    const operand = (n: ts.Expression) => {
      if (LOOSE.has(n.kind)) return `(${text(n)})`;
      if (ts.isBinaryExpression(n)) {
        const k = n.operatorToken.kind;
        if (k === ts.SyntaxKind.QuestionQuestionToken || k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.AmpersandAmpersandToken ||
          k === ts.SyntaxKind.CommaToken || k === ts.SyntaxKind.AmpersandToken || k === ts.SyntaxKind.BarToken || k === ts.SyntaxKind.CaretToken ||
          (k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment)) return `(${text(n)})`;
      }
      return text(n);
    };
    // Parenthesize a replacement unless its slot takes any expression. A `tight`
    // replacement (comparison or unary) also fits under `&&`, `||`, `??` and `?:`.
    const slot = (node: ts.Node, repl: string, simple = false, tight = false) => {
      if (simple) return repl;
      const p = node.parent;
      if (tight) {
        if (ts.isConditionalExpression(p)) return repl;
        if (ts.isBinaryExpression(p) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(p.operatorToken.kind)) return repl;
      }
      const free =
        ts.isParenthesizedExpression(p) || ts.isVariableDeclaration(p) || ts.isReturnStatement(p) ||
        ts.isIfStatement(p) || ts.isWhileStatement(p) || ts.isDoStatement(p) || ts.isExpressionStatement(p) ||
        ts.isCallExpression(p) && p.expression !== node || ts.isNewExpression(p) && p.expression !== node ||
        ts.isArrayLiteralExpression(p) || ts.isPropertyAssignment(p) || ts.isTemplateSpan(p) ||
        ts.isArrowFunction(p) || ts.isParameter(p) || ts.isPropertyDeclaration(p) || ts.isShorthandPropertyAssignment(p) ||
        (ts.isConditionalExpression(p) && p.condition !== node) || (ts.isForStatement(p) && p.condition === node) ||
        (ts.isBinaryExpression(p) && p.right === node && p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && p.operatorToken.kind <= ts.SyntaxKind.LastAssignment);
      return free ? repl : `(${repl})`;
    };
    const keep = (why: string) => kept.set(why, (kept.get(why) ?? 0) + 1);

    // A value that is never null/undefined: literals, `new`, and consts initialized with one or a fresh array.
    const nonNull = (e: ts.Expression, depth = 0): boolean => {
      if (depth > 3) return false;
      if (ts.isArrayLiteralExpression(e) || ts.isNewExpression(e) || ts.isStringLiteralLike(e) || ts.isObjectLiteralExpression(e) || ts.isTemplateExpression(e)) return true;
      if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) return nonNull(e.expression, depth + 1);
      if (ts.isCallExpression(e)) {
        const c = e.expression;
        if (ts.isPropertyAccessExpression(c)) {
          if (["map", "filter", "slice", "concat", "split", "flat", "flatMap", "keys", "values", "entries", "subarray", "toSorted", "reverse"].includes(c.name.text)) return true;
          if (ts.isIdentifier(c.expression) && c.expression.text === "Array" && c.name.text === "from") return true;
        }
        return false;
      }
      if (ts.isIdentifier(e)) {
        const sym = checker.getSymbolAtLocation(e);
        const d = sym?.valueDeclaration;
        if (d && ts.isVariableDeclaration(d) && d.initializer && ts.isVariableDeclarationList(d.parent) && d.parent.flags & ts.NodeFlags.Const) {
          return nonNull(d.initializer, depth + 1);
        }
      }
      return false;
    };
    // Side-effect free and cheap to evaluate twice.
    const pure = (e: ts.Expression): boolean =>
      ts.isIdentifier(e) || e.kind === ts.SyntaxKind.ThisKeyword || (ts.isPropertyAccessExpression(e) && !e.questionDotToken && pure(e.expression));

    // Truth test of `x` with category `c`; `neg` gives the negated test.
    function truth(x: ts.Expression, c: Cat, neg: boolean): string | null {
      switch (c) {
        case "bool":
        case "str":
          return neg ? `!${atom(x)}` : `!!${atom(x)}`;
        case "obj":
          return `${operand(x)} ${neg ? "==" : "!="} null`;
        case "array":
        case "bytes":
        case "map":
        case "set": {
          const prop = c === "map" || c === "set" ? "size" : "length";
          if (nonNull(x)) return `${atom(x)}.${prop} ${neg ? "===" : ">"} 0`;
          return neg ? `!${atom(x)}?.${prop}` : `${atom(x)}?.${prop} > 0`;
        }
        default:
          return null;
      }
    }

    const unparen = (e: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(e) ? unparen(e.expression) : e);
    // `m.has(k)` / `contains(m, k)`, possibly inside `&&`.
    const isHas = (e: ts.Expression, mT: string, kT: string): boolean => {
      e = unparen(e);
      if (ts.isCallExpression(e) && e.arguments.length >= 1) {
        const c = e.expression;
        if (ts.isPropertyAccessExpression(c) && c.name.text === "has" && text(c.expression) === mT && text(e.arguments[0]) === kT) return true;
        if (ts.isIdentifier(c) && c.text === "contains" && e.arguments.length === 2 && text(e.arguments[0]) === mT && text(e.arguments[1]) === kT) return true;
      }
      if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return isHas(e.left, mT, kT) || isHas(e.right, mT, kT);
      return false;
    };
    // `!m.has(k)`, possibly inside `||`: when false, the key is present.
    const isNotHas = (e: ts.Expression, mT: string, kT: string): boolean => {
      e = unparen(e);
      if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) return isHas(e.operand, mT, kT);
      if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.BarBarToken) return isNotHas(e.left, mT, kT) || isNotHas(e.right, mT, kT);
      return false;
    };
    const exits = (s: ts.Statement): boolean => {
      if (ts.isReturnStatement(s) || ts.isThrowStatement(s) || ts.isContinueStatement(s) || ts.isBreakStatement(s)) return true;
      if (ts.isBlock(s)) return s.statements.length > 0 && exits(s.statements[s.statements.length - 1]);
      return false;
    };
    // Nothing in `region` can remove the key or rebind the names, and no call
    // (which could remove it indirectly) runs before `target`.
    let target: ts.Node;
    const undisturbed = (region: ts.Node, mT: string, kT: string): boolean => {
      let ok = true;
      const scan = (n: ts.Node) => {
        if (!ok) return;
        const mapRead = ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ["get", "has"].includes(n.expression.name.text);
        if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && !mapRead && n.end <= target.getStart(sf)) ok = false;
        if (ts.isCallExpression(n)) {
          const c = n.expression;
          if (ts.isPropertyAccessExpression(c) && ["delete", "clear"].includes(c.name.text) && text(c.expression) === mT) ok = false;
          if (ts.isIdentifier(c) && c.text === "dict_pop" && n.arguments[0] && text(n.arguments[0]) === mT) ok = false;
        }
        if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
          const l = text(n.left);
          if (l === mT || l === kT || mT.startsWith(l + ".") || kT.startsWith(l + ".")) ok = false;
        }
        if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && [kT, mT].includes(text(n.operand))) ok = false;
        ts.forEachChild(n, scan);
      };
      scan(region);
      return ok;
    };
    function keyPresent(call: ts.Node, mT: string, kT: string): boolean {
      target = call;
      let child: ts.Node = call;
      for (let p = call.parent; p && !ts.isFunctionLike(p) && !ts.isSourceFile(p); child = p, p = p.parent) {
        if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && p.right === child && isHas(p.left, mT, kT)) {
          return undisturbed(p.right, mT, kT);
        }
        if (ts.isConditionalExpression(p) && p.whenTrue === child && isHas(p.condition, mT, kT)) return undisturbed(p.whenTrue, mT, kT);
        if (ts.isIfStatement(p)) {
          if (p.thenStatement === child && isHas(p.expression, mT, kT)) return undisturbed(p.thenStatement, mT, kT);
          if (p.elseStatement === child && isNotHas(p.expression, mT, kT)) return undisturbed(p.elseStatement, mT, kT);
        }
        if (ts.isBlock(p)) {
          const idx = p.statements.indexOf(child as ts.Statement);
          for (let i = idx - 1; i >= 0; i--) {
            const s = p.statements[i];
            if (ts.isIfStatement(s) && !s.elseStatement && isNotHas(s.expression, mT, kT) && exits(s.thenStatement)) {
              return p.statements.slice(i + 1, idx + 1).every((t) => undisturbed(t, mT, kT));
            }
          }
        }
        if (ts.isForOfStatement(p) && p.statement === child && ts.isVariableDeclarationList(p.initializer) && p.initializer.flags & ts.NodeFlags.Const) {
          const it = unparen(p.expression);
          const name = p.initializer.declarations[0]?.name;
          const fromKeys = ts.isCallExpression(it) && ts.isPropertyAccessExpression(it.expression) && it.expression.name.text === "keys" &&
            text(it.expression.expression) === mT && name && ts.isIdentifier(name) && name.text === kT;
          const fromEntries = (text(it) === mT || (ts.isCallExpression(it) && ts.isPropertyAccessExpression(it.expression) &&
            it.expression.name.text === "entries" && text(it.expression.expression) === mT)) &&
            name && ts.isArrayBindingPattern(name) && name.elements[0] && ts.isBindingElement(name.elements[0]) &&
            ts.isIdentifier(name.elements[0].name) && name.elements[0].name.text === kT;
          if (fromKeys || fromEntries) return undisturbed(p.statement, mT, kT);
        }
      }
      return false;
    }

    function inCondition(n: ts.Node): boolean {
      const p = n.parent;
      if (ts.isParenthesizedExpression(p)) return inCondition(p);
      if ((ts.isIfStatement(p) || ts.isWhileStatement(p) || ts.isDoStatement(p)) && p.expression === n) return true;
      if (ts.isConditionalExpression(p) && p.condition === n) return true;
      if (ts.isForStatement(p) && p.condition === n) return true;
      if (ts.isBinaryExpression(p) && (p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || p.operatorToken.kind === ts.SyntaxKind.BarBarToken)) return inCondition(p);
      return false;
    }

    function rewrite(call: ts.CallExpression): Edit | null {
      const name = (call.expression as ts.Identifier).text;
      const a = call.arguments;
      const at = (repl: string, node: ts.Node = call): Edit => ({ start: node.getStart(sf), end: node.end, text: repl });
      if (a.some((x) => ts.isSpreadElement(x))) return null;

      if (name === "py_bool" && a.length === 1) {
        const c = typeCat(a[0]);
        if (c == null || c === "num") return keep(`py_bool:${c ?? "untyped"}`), null;
        const p = call.parent;
        if (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) {
          const r = truth(a[0], c, true)!;
          return at(slot(p, r, r.startsWith("!"), true), p);
        }
        let r = truth(a[0], c, false)!;
        if ((c === "bool" || c === "str") && inCondition(call)) r = atom(a[0]);
        return at(slot(call, r, PRIMARY.has(a[0].kind) && (r === atom(a[0]) || r.startsWith("!!")), true));
      }

      if (name === "py_or" && a.length === 2) {
        const c = typeCat(a[0]);
        if (c === "str" || c === "bool" || c === "obj") {
          const r = `${operand(a[0])} || ${operand(a[1])}`;
          const p = call.parent;
          const clash = ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken;
          return at(clash ? `(${r})` : slot(call, r));
        }
        if ((c === "array" || c === "bytes") && pure(a[0])) {
          const test = nonNull(a[0]) ? `${atom(a[0])}.length > 0` : `${atom(a[0])}?.length > 0`;
          return at(slot(call, `${test} ? ${text(a[0])} : ${operand(a[1])}`));
        }
        return keep(`py_or:${c ?? "untyped"}`), null;
      }

      if (name === "dict_get" && (a.length === 2 || a.length === 3)) {
        if (typeCat(a[0]) !== "map") return keep("dict_get:not-map"), null;
        const d = a[2];
        if (d && d.kind !== ts.SyntaxKind.NullKeyword) {
          const vc = mapValueCat(a[0]);
          if (vc !== "num" && vc !== "str" && vc !== "bool" && !mapValuesNonNull(a[0])) return keep("dict_get:default-over-nullable-values"), null;
        }
        const dflt = d ? operand(d) : "null";
        const r = `${atom(a[0])}.get(${text(a[1])}) ?? ${dflt}`;
        const p = call.parent;
        const clash = ts.isBinaryExpression(p) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(p.operatorToken.kind);
        return at(clash ? `(${r})` : slot(call, r));
      }

      if (name === "py_eq" && a.length === 2) {
        const [l, r] = a;
        const p = call.parent;
        const neg = ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken;
        const target = neg ? p : call;
        if (r.kind === ts.SyntaxKind.NullKeyword || l.kind === ts.SyntaxKind.NullKeyword) {
          const x = r.kind === ts.SyntaxKind.NullKeyword ? l : r;
          return at(slot(target, `${operand(x)} ${neg ? "!=" : "=="} null`, false, true), target);
        }
        const cl = typeCat(l), cr = typeCat(r);
        if (cl === cr && (cl === "num" || cl === "bool")) return at(slot(target, `${operand(l)} ${neg ? "!==" : "==="} ${operand(r)}`, false, true), target);
        return keep(`py_eq:${cl ?? "untyped"}/${cr ?? "untyped"}`), null;
      }

      if (name === "contains" && a.length === 2) {
        const c = typeCat(a[0]);
        if (c === "str") return at(`${atom(a[0])}.includes(${text(a[1])})`);
        if (c === "set" || c === "map") return at(`${atom(a[0])}.has(${text(a[1])})`);
        if (c === "array") {
          const ec = arrayElemCat(a[0]);
          if (ec === "str" || ec === "num" || ec === "bool") return at(`${atom(a[0])}.includes(${text(a[1])})`);
        }
        return keep(`contains:${c ?? "untyped"}`), null;
      }

      if (name === "len" && a.length === 1) {
        const c = typeCat(a[0]);
        if (c === "str" || c === "array" || c === "bytes") return at(`${atom(a[0])}.length`);
        if (c === "map" || c === "set") return at(`${atom(a[0])}.size`);
        return keep(`len:${c ?? "untyped"}`), null;
      }

      if (name === "enumerate" && a.length === 1 && typeCat(a[0]) === "array") return at(`${atom(a[0])}.entries()`);

      if (name === "getitem" && a.length === 2) {
        const [m, k] = a;
        if (typeCat(m) !== "map" || !pure(m) || !pure(k)) return keep("getitem:unproven"), null;
        if (!keyPresent(call, text(m), text(k))) return keep("getitem:unproven"), null;
        return at(`${atom(m)}.get(${text(k)})`);
      }

      if (name === "getattr" && a.length === 3 && ts.isStringLiteral(a[1]) && /^[A-Za-z_$][\w$]*$/.test(a[1].text)) {
        const [obj, , d] = a;
        const t = checker.getTypeAtLocation(obj);
        if (t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return keep("getattr:untyped"), null;
        const prop = checker.getPropertyOfType(checker.getNonNullableType(t), a[1].text);
        if (!prop) return keep("getattr:duck-typed"), null;
        const recv = checker.getApparentType(checker.getNonNullableType(t));
        if (proxyProbes.some((p) => isAssignable(p, recv) || isAssignable(recv, p))) return keep("getattr:proxied"), null;
        const access = obj.kind === ts.SyntaxKind.ThisKeyword || nonNull(obj) ? `${atom(obj)}.${a[1].text}` : `${atom(obj)}?.${a[1].text}`;
        if (d.kind === ts.SyntaxKind.NullKeyword) {
          const p = call.parent;
          const clash = ts.isBinaryExpression(p) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(p.operatorToken.kind);
          const r = `${access} ?? null`;
          return at(clash ? `(${r})` : slot(call, r));
        }
        // A falsy default under a truth test: absent and default are both false.
        const falsy = d.kind === ts.SyntaxKind.FalseKeyword || (ts.isStringLiteral(d) && d.text === "") || (ts.isNumericLiteral(d) && d.text === "0");
        const pc = cat(checker.getTypeOfSymbolAtLocation(prop, call));
        const p = call.parent;
        const truthArg = ts.isCallExpression(p) && p.arguments.length === 1 && ts.isIdentifier(p.expression) && p.expression.text === "py_bool";
        if (falsy && (pc === "bool" || pc === "str" || pc === "obj") && (inCondition(call) || truthArg ||
          (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken))) {
          return at(access);
        }
        return keep("getattr:default"), null;
      }

      if (name === "py_slice" && (a.length === 2 || a.length === 3)) {
        const c = typeCat(a[0]);
        const bound = (e?: ts.Expression) =>
          e == null || e.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(e) && e.text === "undefined") ? null
            : ts.isNumericLiteral(e) ? e.text : undefined;
        const s = bound(a[1]), e = bound(a[2]);
        if ((c === "array" || c === "str" || c === "bytes") && s !== undefined && e !== undefined) {
          const args = e != null ? `${s ?? 0}, ${e}` : s != null ? s : "";
          return at(`${atom(a[0])}.slice(${args})`);
        }
        return keep("py_slice:computed"), null;
      }

      if (name === "range") {
        const loop = call.parent;
        if (!ts.isForOfStatement(loop) || loop.expression !== call || loop.awaitModifier) return keep("range:not-for-of"), null;
        const init = loop.initializer;
        if (!ts.isVariableDeclarationList(init) || !(init.flags & ts.NodeFlags.Const) || init.declarations.length !== 1 || !ts.isIdentifier(init.declarations[0].name)) {
          return keep("range:pattern"), null;
        }
        if (a.length === 0 || a.length > 3) return null;
        const step = a.length === 3 ? a[2] : null;
        let stepVal = 1;
        if (step) {
          const neg = ts.isPrefixUnaryExpression(step) && step.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(step.operand);
          if (!ts.isNumericLiteral(step) && !neg) return keep("range:computed-step"), null;
          stepVal = Number(text(step));
          if (!stepVal) return null;
        }
        const startE = a.length === 1 ? null : a[0];
        const stopE = a.length === 1 ? a[0] : a[1];
        // Identifiers used anywhere in the enclosing function, to pick fresh names.
        let fn: ts.Node = loop;
        while (fn.parent && !ts.isFunctionLike(fn) && !ts.isSourceFile(fn)) fn = fn.parent;
        const used = new Set<string>();
        const collect = (n: ts.Node) => {
          if (ts.isIdentifier(n)) used.add(n.text);
          ts.forEachChild(n, collect);
        };
        collect(fn);
        let v = (init.declarations[0].name as ts.Identifier).text;
        let bodyUsesV = false;
        const scanV = (n: ts.Node) => {
          if (ts.isIdentifier(n) && n.text === v) bodyUsesV = true;
          ts.forEachChild(n, scanV);
        };
        scanV(loop.statement);
        if (v === "_" && !bodyUsesV) {
          v = ["i", "j", "k", "_i"].find((x) => !used.has(x)) ?? "_i";
          used.add(v);
        }
        // `range` evaluates its bounds once; a `for` condition re-reads them every iteration.
        const stable = (e: ts.Expression) => {
          if (ts.isNumericLiteral(e)) return true;
          if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(e.operand)) return true;
          if (!ts.isIdentifier(e)) return false;
          const d = checker.getSymbolAtLocation(e)?.valueDeclaration;
          if (!d) return false;
          if (ts.isVariableDeclaration(d) && ts.isVariableDeclarationList(d.parent) && d.parent.flags & ts.NodeFlags.Const) return true;
          let assigned = false;
          const scan = (n: ts.Node) => {
            if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
              ts.isIdentifier(n.left) && n.left.text === e.text) assigned = true;
            if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && ts.isIdentifier(n.operand) && n.operand.text === e.text &&
              (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) assigned = true;
            ts.forEachChild(n, scan);
          };
          scan(loop.statement);
          return !assigned && (ts.isParameter(d) || ts.isVariableDeclaration(d));
        };
        const decls = [`${v} = ${startE ? text(startE) : "0"}`];
        let stop = text(stopE);
        if (!stable(stopE)) {
          const n = ["n", "end", "stop", "_n"].find((x) => !used.has(x)) ?? "_n";
          decls.push(`${n} = ${text(stopE)}`);
          stop = n;
        }
        const cond = stepVal > 0 ? `${v} < ${stop}` : `${v} > ${stop}`;
        const inc = stepVal === 1 ? `${v}++` : stepVal === -1 ? `${v}--` : stepVal > 0 ? `${v} += ${stepVal}` : `${v} -= ${-stepVal}`;
        const head = `for (let ${decls.join(", ")}; ${cond}; ${inc})`;
        const close = loop.getChildren(sf).find((c) => c.kind === ts.SyntaxKind.CloseParenToken)!;
        return { start: loop.getStart(sf), end: close.end, text: head };
      }
      return null;
    }

    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && fromPyrt(n.expression)) {
        const e = rewrite(n);
        if (e) edits.push(e);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (!edits.length) continue;

    // Outermost edits only; nested ones are picked up on the next round.
    edits.sort((x, y) => x.start - y.start || y.end - x.end);
    const chosen: Edit[] = [];
    for (const e of edits) {
      const last = chosen.at(-1);
      if (last && e.start < last.end) continue;
      chosen.push(e);
    }
    let out = src;
    for (const e of [...chosen].reverse()) out = out.slice(0, e.start) + e.text + out.slice(e.end);
    total += chosen.length;
    if (!DRY) fs.writeFileSync(sf.fileName, out);
  }
  return { edits: total, kept };
}

/** Drop pyrt import specifiers a file no longer references. */
function pruneImports() {
  const program = loadProgram();
  for (const sf of program.getSourceFiles()) {
    if (!sf.fileName.startsWith(path.join(ROOT, "src/py_aep/"))) continue;
    const used = new Set<string>();
    const scan = (n: ts.Node) => {
      if (ts.isImportDeclaration(n)) return;
      if (ts.isIdentifier(n)) used.add(n.text);
      ts.forEachChild(n, scan);
    };
    scan(sf);
    let out = sf.text;
    const decls = sf.statements.filter(
      (s): s is ts.ImportDeclaration => ts.isImportDeclaration(s) && /\/pyrt\/index\.ts["']$/.test(s.moduleSpecifier.getText(sf)),
    );
    for (const d of [...decls].reverse()) {
      const nb = d.importClause?.namedBindings;
      if (!nb || !ts.isNamedImports(nb) || d.importClause!.name || d.importClause!.isTypeOnly) continue;
      const keepEls = nb.elements.filter((el) => used.has(el.name.text));
      if (keepEls.length === nb.elements.length) continue;
      const start = d.getStart(sf);
      let end = d.end;
      if (!keepEls.length) {
        if (out[end] === "\n") end++;
        out = out.slice(0, start) + out.slice(end);
        continue;
      }
      const multiline = d.getText(sf).includes("\n");
      const spec = d.moduleSpecifier.getText(sf);
      const names = keepEls.map((el) => el.getText(sf));
      const text = multiline ? `import {\n${names.map((x) => `  ${x},`).join("\n")}\n} from ${spec};` : `import { ${names.join(", ")} } from ${spec};`;
      out = out.slice(0, start) + text + out.slice(end);
    }
    if (out !== sf.text && !DRY) fs.writeFileSync(sf.fileName, out);
  }
}

/**
 * Drop `?? null` after a `Map.get` where every use treats `undefined` like
 * `null`: loose null comparisons, truth tests, and member access / calls.
 */
function dropNullTails(): number {
  const program = loadProgram();
  const checker = program.getTypeChecker();
  let count = 0;
  for (const sf of program.getSourceFiles()) {
    if (!sf.fileName.startsWith(path.join(ROOT, "src/py_aep/"))) continue;
    const drops: ts.BinaryExpression[] = [];
    const looseNullCmp = (n: ts.Node) => {
      const p = n.parent;
      return ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind) &&
        (p.left.kind === ts.SyntaxKind.NullKeyword || p.right.kind === ts.SyntaxKind.NullKeyword);
    };
    const truthUse = (n: ts.Node): boolean => {
      const p = n.parent;
      if (ts.isParenthesizedExpression(p)) return truthUse(p);
      if ((ts.isIfStatement(p) || ts.isWhileStatement(p)) && p.expression === n) return true;
      if (ts.isConditionalExpression(p) && p.condition === n) return true;
      if (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) return true;
      if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && p.left === n) return true;
      return false;
    };
    // `typeof x === "string"` and the like: false for both null and undefined.
    const typeofTest = (n: ts.Node) => {
      const p = n.parent;
      if (!ts.isTypeOfExpression(p)) return false;
      const q = p.parent;
      if (!ts.isBinaryExpression(q) || ![ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(q.operatorToken.kind)) return false;
      const other = q.left === p ? q.right : q.left;
      return ts.isStringLiteral(other) && other.text !== "undefined" && other.text !== "object";
    };
    const safeUse = (n: ts.Node) => {
      const p = n.parent;
      if (looseNullCmp(n) || truthUse(n) || typeofTest(n)) return true;
      if ((ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) && p.expression === n) return true;
      if (ts.isCallExpression(p) && p.expression === n) return true;
      if (ts.isNonNullExpression(p)) return true;
      return false;
    };
    const visit = (n: ts.Node) => {
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken && n.right.kind === ts.SyntaxKind.NullKeyword &&
        ts.isCallExpression(n.left) && ts.isPropertyAccessExpression(n.left.expression) && n.left.expression.name.text === "get") {
        let outer: ts.Node = n;
        while (ts.isParenthesizedExpression(outer.parent)) outer = outer.parent;
        // First argument of a Python-truth helper, or left of `||` / `??`: undefined acts as null.
        const op = outer.parent;
        const truthArg = ts.isCallExpression(op) && op.arguments[0] === outer && ts.isIdentifier(op.expression) &&
          ["py_bool", "py_or"].includes(op.expression.text);
        const leftOfOr = ts.isBinaryExpression(op) && op.left === outer &&
          [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(op.operatorToken.kind);
        let ok = looseNullCmp(outer) || truthUse(outer) || typeofTest(outer) || truthArg || leftOfOr;
        const d = outer.parent;
        if (!ok && ts.isVariableDeclaration(d) && d.initializer === outer && ts.isIdentifier(d.name) &&
          ts.isVariableDeclarationList(d.parent) && d.parent.flags & ts.NodeFlags.Const) {
          const name = d.name;
          const sym = checker.getSymbolAtLocation(name);
          let scope: ts.Node = d.parent;
          while (!ts.isBlock(scope) && !ts.isSourceFile(scope) && !ts.isFunctionLike(scope)) scope = scope.parent;
          let all = true;
          let refs = 0;
          const scan = (m: ts.Node) => {
            if (ts.isIdentifier(m) && m !== name && m.text === name.text && checker.getSymbolAtLocation(m) === sym) {
              refs++;
              if (!safeUse(m)) all = false;
            }
            ts.forEachChild(m, scan);
          };
          scan(scope);
          ok = all && refs > 0;
        }
        if (ok) drops.push(n);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (!drops.length) continue;
    let out = sf.text;
    for (const b of drops.sort((x, y) => y.getStart(sf) - x.getStart(sf))) {
      let start = b.getStart(sf), end = b.end;
      let node: ts.Node = b;
      // `(m.get(k) ?? null)` -> `m.get(k)`
      if (ts.isParenthesizedExpression(node.parent)) {
        node = node.parent;
        start = node.getStart(sf);
        end = node.end;
      }
      out = out.slice(0, start) + b.left.getText(sf) + out.slice(end);
    }
    count += drops.length;
    if (!DRY) fs.writeFileSync(sf.fileName, out);
  }
  return count;
}

let round = 0;
const keptTotal = new Map<string, number>();
for (;;) {
  const { edits, kept } = run();
  round++;
  console.log(`round ${round}: ${edits} edits`);
  if (round === 1 || edits === 0) for (const [k, v] of kept) keptTotal.set(k, v);
  if (!edits || DRY) break;
}
if (!DRY) {
  console.log(`dropped ${dropNullTails()} \`?? null\` tails`);
  pruneImports();
}
if (REPORT) for (const [k, v] of [...keptTotal].sort((a, b) => b[1] - a[1])) console.log(`kept ${k}: ${v}`);
