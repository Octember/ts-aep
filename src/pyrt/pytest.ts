// pytest idioms for the translated suite (bun:test underneath).
//
//   pytest                                  bun:test + this module
//   def test_x(): ...                       test("test_x", () => { ... })
//   class TestFoo: def test_x(self)         describe("TestFoo", () => { test("test_x", ...) })
//   @pytest.mark.parametrize("a,b", rows)   test.each(rows)("test_x[%#]", (a, b) => ...)
//   @pytest.mark.skipif(cond, reason=...)   test.skipIf(cond)("test_x", ...)
//   pytest.skip("why") inside a test        return skip("why")
//   pytest.fail("why")                      fail("why")
//   pytest.importorskip("mod")              if (!importorskip("npm-mod")) return
//   with pytest.raises(E, match="re"):      raises(E, () => { ... }, "re")
//   with pytest.warns(UserWarning, match=)  warns(() => { ... }, "re")
//   x == pytest.approx(y, abs=..., rel=...) expect(approx(x, y, { abs, rel })).toBe(true)
//   tmp_path fixture                        const tmp_path = make_tmp_path()
//   assert a == b                           expect(py_eq(a, b)).toBe(true)  or  expect(a).toBe(b) for primitives

import * as fs from "node:fs";
import * as os from "node:os";
import * as nodepath from "node:path";
import { createRequire } from "node:module";
import { py_eq } from "./builtins.ts";
import { warnings } from "./errors.ts";
import { Path } from "./pathlib.ts";

export function raises<E extends Error>(cls: abstract new (...a: any[]) => E, fn: () => unknown, match?: string | RegExp): E {
  try {
    fn();
  } catch (e) {
    if (!(e instanceof cls)) throw e;
    if (match !== undefined && !new RegExp(match).test(e.message)) {
      throw new Error(`Regex pattern did not match.\n Regex: ${String(match)}\n Input: ${e.message}`);
    }
    return e;
  }
  throw new Error(`DID NOT RAISE ${cls.name}`);
}

export function warns(fn: () => unknown, match?: string | RegExp): string[] {
  const start = warnings.length;
  fn();
  const caught = warnings.slice(start);
  if (!caught.length) throw new Error("DID NOT WARN");
  if (match !== undefined && !caught.some((m) => new RegExp(match).test(m))) {
    throw new Error(`No warning matched ${String(match)}: ${caught.join(" | ")}`);
  }
  return caught;
}

/** `actual == pytest.approx(expected, rel=1e-6, abs=1e-12)` over numbers or (nested) sequences. */
export function approx(actual: any, expected: any, opts: { rel?: number; abs?: number } = {}): boolean {
  if (Array.isArray(expected) || ArrayBuffer.isView(expected)) {
    const a = Array.from(actual as ArrayLike<any>);
    const e = Array.from(expected as ArrayLike<any>);
    return a.length === e.length && a.every((x, i) => approx(x, e[i], opts));
  }
  if (typeof expected !== "number" || typeof actual !== "number") return py_eq(actual, expected);
  if (actual === expected) return true;
  if (Number.isNaN(actual) || Number.isNaN(expected)) return false;
  const rel = opts.rel ?? (opts.abs === undefined ? 1e-6 : 0);
  const abs = opts.abs ?? 1e-12;
  return Math.abs(actual - expected) <= Math.max(rel * Math.abs(expected), abs);
}

export class Skipped extends Error {}

/** `pytest.skip(reason)` - throw-free: `return skip("why")` from the test body. */
export function skip(reason = ""): void {
  console.log(`skipped: ${reason}`);
}

/** `pytest.fail.Exception` */
export class Failed extends Error {
  constructor(message = "") {
    super(message);
    this.name = "Failed";
  }
}

/** `pytest.fail(reason)`: fail the running test. */
export function fail(reason = ""): never {
  throw new Failed(reason);
}

const _require = createRequire(import.meta.url);

/**
 * `pytest.importorskip(name)`: whether the (npm) module resolves; when it
 * does not, reports the skip like `skip()` and the caller returns early.
 */
export function importorskip(name: string): boolean {
  try {
    _require.resolve(name);
    return true;
  } catch {
    skip(`could not import '${name}'`);
    return false;
  }
}

export function make_tmp_path(): Path {
  return new Path(fs.mkdtempSync(nodepath.join(os.tmpdir(), "py_aep-")));
}
