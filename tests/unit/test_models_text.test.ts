/** Tests for TextDocument and FontObject model parsing and roundtrip. */

import { describe, expect, test } from "bun:test";

import "../../src/py_aep/binary/_register.ts";
import { raises } from "../../src/pyrt/pytest.ts";
import { AssertionError_, NotImplementedError, Path, PyException, RuntimeError, b } from "../../src/pyrt/index.ts";
import { PropertyValueType } from "../../src/py_aep/enums/index.ts";
import * as specialized_properties from "../../src/py_aep/parsers/specialized_properties.ts";

const SAMPLES_DIR = new Path(import.meta.path).parent.parent.parent.div("samples", "models", "layer");

// TODO(pyrt): `monkeypatch.setattr` - ESM module bindings are read-only, so
// `find_by_list_type`, `parse_property`, `CosParser` and `parse_btdk_cos` inside
// parsers/specialized_properties.ts cannot be swapped from a test. No shim exists.
const monkeypatch_setattr = (_obj: unknown, _name: string, _value: unknown): void => {
  throw new NotImplementedError("monkeypatch.setattr");
};

// TODO(pyrt): Python's builtin `SyntaxError` has no pyrt shim; a local stand-in
// keeps the fake COS parser's error type distinct from RuntimeError.
class SyntaxError_ extends PyException {}

describe("TestParseTextDocument", () => {
  /** Unit tests for Source Text property parsing fallbacks. */

  test("test_ignores_malformed_cos_payload", () => {
    /** Malformed COS data should keep the property but skip the value. */
    const prop: any = {
      keyframes: [],
      value: null,
      _property_value_type: null,
    };
    const tdbs_chunk: any = { chunks: [] };
    const btdk_chunk: any = { data: b("bad") };
    const root_chunk: any = { chunks: [] };

    // TODO(port): Python fake is keyword-only; the TS port calls find_by_list_type positionally.
    const fake_find_by_list_type = (chunks: any, list_type: string): any => {
      if (list_type === "tdbs") return tdbs_chunk;
      if (list_type === "btdk") return btdk_chunk;
      throw new AssertionError_(`Unexpected list_type: ${list_type}`);
    };

    class BrokenCosParser {
      constructor(..._args: any[]) {}

      parse(): Record<string, any> {
        throw new SyntaxError_("bad COS");
      }
    }

    monkeypatch_setattr(specialized_properties, "find_by_list_type", fake_find_by_list_type);
    monkeypatch_setattr(specialized_properties, "parse_property", (..._kwargs: any[]) => prop);
    monkeypatch_setattr(specialized_properties, "CosParser", BrokenCosParser);

    const result = specialized_properties.parse_text_document(
      root_chunk,
      "ADBE Text Document",
      0,
      {} as any,
      {} as any,
    );

    expect(result).toBe(prop);
    expect(prop._property_value_type).toBe(PropertyValueType.TEXT_DOCUMENT);
    expect(prop.value == null).toBe(true);
  });

  test("test_raises_unexpected_cos_errors", () => {
    /** Unexpected bugs in COS conversion should still surface. */
    const prop: any = {
      keyframes: [],
      value: null,
      _property_value_type: null,
    };
    const tdbs_chunk: any = { chunks: [] };
    const btdk_chunk: any = { data: b("ok") };
    const root_chunk: any = { chunks: [] };

    // TODO(port): Python fake is keyword-only; the TS port calls find_by_list_type positionally.
    const fake_find_by_list_type = (chunks: any, list_type: string): any => {
      if (list_type === "tdbs") return tdbs_chunk;
      if (list_type === "btdk") return btdk_chunk;
      throw new AssertionError_(`Unexpected list_type: ${list_type}`);
    };

    class ValidCosParser {
      constructor(..._args: any[]) {}

      parse(): Record<string, any> {
        return {};
      }
    }

    const raise_runtime_error = (..._args: any[]): any => {
      throw new RuntimeError("boom");
    };

    monkeypatch_setattr(specialized_properties, "find_by_list_type", fake_find_by_list_type);
    monkeypatch_setattr(specialized_properties, "parse_property", (..._kwargs: any[]) => prop);
    monkeypatch_setattr(specialized_properties, "CosParser", ValidCosParser);
    monkeypatch_setattr(specialized_properties, "parse_btdk_cos", raise_runtime_error);

    raises(
      RuntimeError,
      () =>
        specialized_properties.parse_text_document(
          root_chunk,
          "ADBE Text Document",
          0,
          {} as any,
          {} as any,
        ),
      "boom",
    );
  });
});
