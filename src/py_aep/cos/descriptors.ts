/**
 * Descriptors for COS-dict-backed model fields.
 *
 * Each descriptor reads from / writes to a COS dict stored on the model
 * instance, so that accessing a model attribute lazily extracts the value
 * from the underlying COS data.  After every `__set__`, the model's
 * `_propagate_cos()` hook is called to re-serialize the COS dict back
 * to the btdk chunk's `binary_data`.
 *
 * This module mirrors the role of
 * `models.descriptors.ChunkField` but operates on nested Python dicts
 * (COS parsed data) instead of binary chunk fields.
 */

import {
  AttributeError,
  IndexError,
  KeyError,
  TypeError_,
  ValueError,
  dict_get,
  float,
  getattr,
  int,
  is_real,
  py_bool,
  pyfloat,
  repr,
  round,
  instance_dict,
  type_name,
} from "../../pyrt/index.ts";
import { get_ae_version_major } from "../ae_version.ts";

export const _SENTINEL: unique symbol = Symbol("_SENTINEL");

/**
 * Read `key` from a COS dict with the descriptors' fault-tolerant
 * fallback: a missing key, or a `transform` that raises, yields
 * `default`. Shared by `CosField.__get__` and the range models'
 * mixed-value resolution.
 */
export function _extract(
  d: Map<string, unknown>,
  key: string,
  transform: ((x: unknown) => unknown) | null,
  default_: any,
): any {
  const raw = dict_get(d, key, _SENTINEL);
  if (raw === _SENTINEL) return default_;
  if (transform != null) {
    try {
      return transform(raw);
    } catch (e) {
      // TODO(port): JS cannot distinguish a native TypeError from property access on null/undefined (Python AttributeError, which would propagate) from a Python-style TypeError, so a transform dereferencing null yields default here instead of raising; only affects transforms fed unexpected None/non-container COS values.
      if (
        !(
          e instanceof TypeError_ ||
          e instanceof TypeError ||
          e instanceof ValueError ||
          e instanceof KeyError ||
          e instanceof IndexError
        )
      ) {
        throw e;
      }
      return default_;
    }
  }
  return raw;
}

// NOTE(port): pyrt int()/float() do not raise TypeError for None/containers like CPython; this guard supplies it so `_extract` returns the default.
export function _int_float_guard(fn: (x: unknown) => number): (x: unknown) => number {
  return (x: unknown) => {
    if (!is_real(x) && typeof x !== "string" && typeof x !== "boolean" && typeof x !== "bigint") {
      throw new TypeError_(`argument must be a string or a real number, not '${type_name(x)}'`);
    }
    return fn(x);
  };
}

/**
 * Descriptor that proxies a single key on a COS dict.
 *
 * The dict is retrieved from the model instance via `getattr(obj, dict_attr)`.  When the dict is `null` the descriptor returns
 * `default` (which defaults to `null`).
 *
 * Unlike `ChunkField`, this descriptor is scalar-only: `reverse`
 * always returns a single value written to one dict key.
 *
 * @param dict_attr - Name of the model attribute holding the COS sub-dict (e.g. `"_char_style"`).
 * @param key - String key into that dict (e.g. `"1"` for font_size).
 * @param transform - Optional callable applied when *getting* (COS value -\> user-facing value).
 * @param reverse - 1-arg callable applied when *setting* (user-facing -\> COS value). Always returns
 *   a scalar.
 * @param read_only - When `true`, the field cannot be set.
 * @param validate - Optional callable called with the user-facing value before any `reverse`
 *   transform.
 * @param default - Value returned when the dict is `null` or the key is absent. Defaults to `null`.
 * @param min_version - Minimum AE major version required to *set* this field. Writes to an older
 *   file raise `AttributeError`; reads are always allowed. Mirrors `models.descriptors.ChunkField`.
 */
export interface CosFieldOptions {
  transform?: ((x: any) => any) | null;
  reverse?: ((x: any) => any) | null;
  read_only?: boolean;
  validate?: ((value: any, obj: any) => void) | null;
  default?: any;
  min_version?: number | null;
}

export class CosField<T> {
  declare dict_attr: string;
  declare key: string;
  declare transform: ((x: any) => any) | null;
  declare reverse: ((x: any) => any) | null;
  declare read_only: boolean;
  declare validate: ((value: any, obj: any) => void) | null;
  declare default: any;
  declare min_version: number | null;
  declare public_name: string;

  constructor(
    dict_attr: string,
    key: string,
    kw: CosFieldOptions = {},
  ) {
    const {
      transform = null,
      reverse = null,
      read_only = false,
      validate = null,
      default: default_ = null,
      min_version = null,
    } = kw;
    this.dict_attr = dict_attr;
    this.key = key;
    this.transform = transform;
    this.reverse = reverse;
    this.read_only = read_only;
    this.validate = validate;
    this.default = default_;
    this.min_version = min_version;
  }

  __set_name__(owner: Function, name: string): void {
    this.public_name = name;
  }

  __get__(obj: unknown, objtype?: Function): any {
    if (obj == null) return this;
    // Instance-dict overrides (set by parser or user when no dict)
    const idict = instance_dict(obj);
    if (idict.has(this.public_name)) return idict.get(this.public_name);
    const d: Map<string, unknown> | null = getattr(obj, this.dict_attr);
    if (d == null) return this.default;
    return _extract(d, this.key, this.transform, this.default);
  }

  /**
   * Raise if this field cannot be written to `obj` - read-only, or
   * the file predates the field's `min_version`.
   */
  _check_writable(obj: unknown): void {
    if (this.read_only) {
      throw new AttributeError(`${repr(this.public_name)} is read-only.`);
    }
    if (this.min_version != null) {
      if (get_ae_version_major(obj) < this.min_version) {
        throw new AttributeError(
          `${repr(this.public_name)} requires AE ${this.min_version}+ file format.`,
        );
      }
    }
  }

  /**
   * Validate a non-`null` user value and reverse-transform it to
   * the form stored in the COS dict.
   */
  _coerce(obj: unknown, value: unknown): unknown {
    if (this.validate != null) this.validate(value, obj);
    if (this.reverse != null) return this.reverse(value);
    return value;
  }

  __set__(obj: unknown, value: unknown): void {
    this._check_writable(obj);
    // Clear any instance-dict override
    instance_dict(obj).delete(this.public_name);
    const d: Map<string, unknown> | null = getattr(obj, this.dict_attr);
    if (d == null) {
      // No backing dict - store as instance override
      instance_dict(obj).set(this.public_name, value);
      return;
    }
    // `None` clears the key (an optional field is being unset); there is
    // no value to validate in that case.
    if (value == null) {
      d.delete(this.key);
    } else {
      d.set(this.key, this._coerce(obj, value));
    }
    const propagate = getattr(obj, "_propagate_cos", null);
    if (propagate != null) propagate.call(obj);
  }

  /**
   * Create a CosField for boolean flags.
   *
   * Bakes in `transform=bool` and `reverse=bool` so call sites only
   * need the dict attribute and key.
   */
  // NOTE(port): Python raises TypeError on a repeated transform/reverse keyword; no call site repeats them, so the kwargs-win spread is never observable.
  static bool(dict_attr: string, key: string, kwargs: CosFieldOptions = {}): CosField<boolean | null> {
    return new this(dict_attr, key, { transform: py_bool, reverse: py_bool, ...kwargs });
  }

  /**
   * Create a CosField for IntEnum-backed fields.
   *
   * Auto-detects `from_binary`/`to_binary` on the enum class,
   * mirroring `ChunkField.enum`. If the enum has a `from_binary`
   * classmethod it is used as `transform`; otherwise the class
   * itself is used. If the enum has a `to_binary` method it is used
   * as `reverse`; otherwise `int` is used.
   */
  static enum<T>(enum_cls: any, dict_attr: string, key: string, kwargs: CosFieldOptions = {}): CosField<T> {
    // NOTE(port): py_aep enums are not classes; Python's fallback `enum_cls(v)` is `enum_cls.of(v)`.
    kwargs = { ...kwargs };
    if (!("transform" in kwargs)) {
      kwargs.transform = "from_binary" in enum_cls ? enum_cls.from_binary.bind(enum_cls) : enum_cls.of;
    }
    if (!("reverse" in kwargs)) {
      kwargs.reverse = "to_binary" in enum_cls ? enum_cls.to_binary.bind(enum_cls) : int;
    }
    return new this(dict_attr, key, kwargs);
  }

  /**
   * Create a CosField that coerces to float in both directions.
   *
   * The write-side coercion matters for byte fidelity: AE stores
   * these keys as floats, and an `int` passed by a caller would
   * serialize without the decimal marker.
   */
  static float<T>(dict_attr: string, key: string, kwargs: CosFieldOptions = {}): CosField<number | null> {
    kwargs = { ...kwargs };
    // The stored value is a Python float, so box it to keep `1.0` from serializing as `1`.
    if (!("reverse" in kwargs)) kwargs.reverse = (x: number | string | boolean) => pyfloat(float(x));
    // NOTE(port): a repeated transform keyword raises TypeError in Python; no call site passes one. _int_float_guard supplies float(None)'s TypeError.
    return new this(dict_attr, key, { transform: _int_float_guard(float), ...kwargs });
  }

  /**
   * Create a CosField for integer-stored keys.
   *
   * Coerces to `int` on read and rounds to the nearest integer on
   * write. AE stores these keys as integers; a real-typed value is
   * misread at 16.16 scale (stored `50.0` read back as `3276800`,
   * probed AE 2026), so the write-side coercion matters for fidelity.
   */
  static int<T>(dict_attr: string, key: string, kwargs: CosFieldOptions = {}): CosField<number | null> {
    kwargs = { ...kwargs };
    if (!("reverse" in kwargs)) kwargs.reverse = round;
    // NOTE(port): a repeated transform keyword raises TypeError in Python; no call site passes one.
    return new this(dict_attr, key, { transform: _int_float_guard(int), ...kwargs });
  }
}
