/**
 * Descriptors for chunk-backed model fields.
 *
 * Each descriptor reads from / writes to a binary chunk attribute,
 * so that modifying a model field directly mutates the underlying binary
 * data and `Project.save()` persists the change.
 */

import {
  AttributeError,
  ContextVar,
  RuntimeError,
  TypeError_,
  ValueError,
  getattr,
  int,
  py_bool,
  repr,
  instance_dict,
} from "../../pyrt/index.ts";
import type { EnumHelpers, EnumValue } from "../../pyrt/enum.ts";
import { get_ae_version_major } from "../ae_version.ts";
import { validate_bool, validate_enum } from "./validators.ts";

/** Callable applied to a chunk value on read (`transform`) or write (`reverse`). */
export type ChunkTransform = (...args: any[]) => any;

export const _SENTINEL: unique symbol = Symbol("_SENTINEL");

// While a parser runs this is set to False so that `ChunkField.__set__`
// rejects writes: parsers must not mutate chunk data through descriptors
// (round-trip idempotency). Parsers cache values via `__dict__` overrides
// or the private `_cache_value` helpers instead. Outside parsing the
// default (True) lets end-user writes through.
export const _materialization_allowed = new ContextVar<boolean>("_materialization_allowed", {
  default: true,
});

/** Run `body` with descriptor writes forbidden; restores the previous state after. */
export function _run_suppressed<R>(body: () => R): R {
  const token = _materialization_allowed.set(false);
  try {
    return body();
  } finally {
    _materialization_allowed.reset(token);
  }
}

/**
 * Forbid descriptor writes for the current context.
 *
 * Parser entry points are decorated with this so any descriptor
 * write during parsing raises `RuntimeError` instead of silently
 * mutating chunk data. Usable as a decorator
 * (`@_suppress_materialization()`) or a `with` block.
 *
 * Call sites: `with _suppress_materialization(): body` becomes
 * `_suppress_materialization().run(() => body)`, and
 * `@_suppress_materialization()` becomes `.decorate(fn)`.
 */
export function _suppress_materialization() {
  function decorate<F extends (...args: never[]) => unknown>(fn: F): F {
    return function (this: unknown, ...args: unknown[]) {
      return _run_suppressed(() => fn.apply(this, args));
    } as unknown as F;
  }
  // Callable (`@_suppress_materialization()` applied as `_suppress_materialization()(fn)`),
  // and also exposes `.decorate(fn)` / `.run(body)`.
  return Object.assign(decorate, { run: _run_suppressed, decorate });
}

/**
 * Python `isinstance(x, IntEnum)` for a py_enum object (pyrt/enum.ts).
 */
// NOTE(port): int_enum === py_enum in pyrt, so this also admits non-int enums; the only non-IntEnum enum in py_aep (cos.TokenType) never reaches a descriptor, so the IntEnum check matches Python.
export function is_enum(x: any): boolean {
  return x != null && typeof x === "object" && "__members__" in x && typeof x.has === "function";
}

/**
 * Return the IntEnum class behind `transform`, if any.
 *
 * Detects a `from_binary` classmethod (via `__self__`) or a direct
 * enum class reference.
 */
export function _enum_class(transform: ChunkTransform | null | undefined): any {
  if (transform == null) return null;
  let enum_cls = getattr(transform, "__self__", null);
  if (enum_cls == null && is_enum(transform)) enum_cls = transform;
  if (is_enum(enum_cls)) return enum_cls;
  return null;
}

/**
 * `getattr(enum_cls, name, dflt)`. Python returns a classmethod already
 * bound to the enum (its `__self__`); a py_enum method needs `this` bound
 * the same way, and `_enum_class` finds the enum through `__self__`.
 */
export function bound_enum_method(enum_cls: any, name: string, dflt: any): any {
  const m = getattr(enum_cls, name, dflt);
  // Python's default is the enum class itself, which is callable (`E(v)`); a
  // py_enum object is not, so use `E.of` and keep `__self__` for `_enum_class`.
  if (m === dflt && is_enum(m)) return Object.assign((v: unknown) => m.of(v), { __self__: m });
  if (m === dflt || typeof m !== "function") return m;
  return Object.assign(m.bind(enum_cls), { __self__: enum_cls });
}

/**
 * Wrap a get-transform so out-of-enum stored values read back raw.
 *
 * Real `.aep` files can hold values outside our enums (e.g. an output
 * depth AE keeps but has no label for, -16, or a format id from a
 * third-party output plugin); the binary is trusted, so reads must not
 * raise. Mirrors the fallback
 * `_try_enum_or_int` uses for XML params.
 *
 * For a chunk-backed field prefer
 * `ChunkField.enum(..., allow_out_of_enum_values=True)`, which applies
 * this wrapper and restores write-side strictness for you. This helper
 * is for the read paths that are not `ChunkField`s (e.g. a `@property`
 * over decoded JSON).
 */
export function enum_or_raw(convert: (value: any) => any): (value: any) => any {
  function _transform(value: any): any {
    try {
      return convert(value);
    } catch (e) {
      if (!(e instanceof ValueError || e instanceof TypeError_)) throw e;
      // TypeError: a `convert` that coerces first (e.g. `int(v)` over
      // decoded JSON) raises it, not ValueError, for a non-scalar.
      return value;
    }
  }
  return _transform;
}

/**
 * Raise `ValueError` if `value` is not a valid member of `enum_cls`.
 *
 * Raw ints must appear in the enum's value map; any other type must
 * already be an instance of the enum.
 */
export function _validate_enum_member(enum_cls: any, value: unknown, public_name: string): void {
  if (enum_cls.has(value)) return;
  // NOTE(port): int/float — integral values are plain numbers by design (RULEBOOK §4); an integer-valued float such as 2.0 takes the int branch and gets the "Invalid value" message instead of "is not a valid".
  // A Python bool is an int that hashes like 0/1, so it is checked as its int value.
  if (typeof value === "boolean" || (typeof value === "number" && Number.isInteger(value))) {
    const key = typeof value === "boolean" ? Number(value) : value;
    if (!enum_cls.has(key)) {
      const members = enum_cls
        .members()
        .map((m: unknown) => `${enum_cls.name_of(m)} (${m})`)
        .join(", ");
      throw new ValueError(
        `Invalid value ${repr(value)} for ${repr(public_name)}. ` +
          `Valid ${enum_cls.__name__} values: ${members}`,
      );
    }
  } else {
    throw new ValueError(`${repr(value)} is not a valid ${enum_cls.__name__}`);
  }
}

/**
 * Descriptor that proxies a single field on a chunk body.
 *
 * @param chunk_attr - Name of the model attribute holding the chunk body reference (e.g.
 *   `"_cdta"`).
 * @param field - Name of the field on the chunk body (e.g. `"width"`).
 * @param transform - Optional callable applied when *getting* (binary -\> user-facing value).
 * @param reverse - 1-arg callable applied when *setting* (user-facing -\> binary value). Returns a
 *   scalar written to `field`.
 * @param read_only - When `true`, the field cannot be set. Defaults to `false`.
 * @param validate - Optional callable called with the user-facing value before any reverse
 *   transform. Must raise `ValueError` or `TypeError` if the value is invalid.
 * @param default - Optional default value returned when the chunk body is `null`. If not given,
 *   accessing the field when the body is `null` raises `AttributeError`.
 * @param pre_set - Optional method name on the model instance, invoked after validation and before
 *   the value is written.
 * @param post_set - Optional method name on the model instance, or a callable receiving the model
 *   instance, invoked after the value has been written.
 */
export class ChunkField<T> {
  declare chunk_attr: string;
  declare field: string;
  declare transform: ChunkTransform | null;
  declare reverse: ChunkTransform | null;
  declare read_only: boolean;
  declare validate: ((value: T, obj: any) => void) | null;
  declare default: T | typeof _SENTINEL;
  declare pre_set: string | null;
  declare post_set: ((obj: any) => void) | string | null;
  declare min_version: number | null;
  declare _enum_cls: any;
  declare public_name: string;

  constructor(
    chunk_attr: string,
    field: string,
    kw: {
      transform?: ((value: any) => T) | null;
      reverse?: ((value: NoInfer<T>) => unknown) | null;
      read_only?: boolean;
      validate?: ((value: NoInfer<T>, obj: any) => void) | null;
      default?: NoInfer<T>;
      pre_set?: string | null;
      post_set?: ((obj: any) => void) | string | null;
      min_version?: number | null;
    } = {},
  ) {
    const {
      transform = null,
      reverse = null,
      read_only = false,
      validate = null,
      default: default_ = _SENTINEL,
      pre_set = null,
      post_set = null,
      min_version = null,
    } = kw;
    this.chunk_attr = chunk_attr;
    this.field = field;
    this.transform = transform;
    this.reverse = reverse;
    this.read_only = read_only;
    this.validate = validate;
    this.default = default_;
    this.pre_set = pre_set;
    this.post_set = post_set;
    this.min_version = min_version;
    // Derived once so __set__ validates membership without
    // re-inspecting the transform on every write.
    this._enum_cls = _enum_class(transform);
  }

  __set_name__(owner: Function, name: string): void {
    this.public_name = name;
  }

  __get__(obj: any, objtype?: Function | null): T | ChunkField<T> {
    if (obj == null) return this;
    // Parse-time overrides (e.g. ExtendScript-compatible values that
    // differ from the binary) are stored in __dict__ and take priority
    // over the chunk body.
    const overrides = instance_dict(obj);
    if (overrides.has(this.public_name)) return overrides.get(this.public_name) as T;
    const body = getattr(obj, this.chunk_attr);
    if (body == null) {
      if (this.default !== _SENTINEL) return this.default as T;
      throw new AttributeError(`chunk body ${repr(this.chunk_attr)} is None`);
    }
    const value = getattr(body, this.field);
    return (this.transform ? this.transform(value) : value) as T;
  }

  __set__(obj: any, value: T): void {
    if (this.read_only) throw new AttributeError(`${repr(this.public_name)} is read-only.`);
    if (this.min_version != null) {
      let major: number | null;
      try {
        major = get_ae_version_major(obj);
      } catch (e) {
        if (!(e instanceof TypeError_)) throw e;
        // Version undeterminable (e.g. a ViewOptions whose viewer
        // has no AVItem); skip the gate and allow the write.
        major = null;
      }
      if (major != null && major < this.min_version) {
        throw new AttributeError(
          `${repr(this.public_name)} requires AE ${this.min_version}+ file format.`,
        );
      }
    }
    if (!_materialization_allowed.get()) {
      throw new RuntimeError(
        `Cannot write ${repr(this.public_name)} via descriptor during ` +
          `parsing. Use obj.__dict__[${repr(this.public_name)}] for ` +
          `parse-time overrides.`,
      );
    }
    // Validate BEFORE touching anything. `_ensure_materialized` flips
    // synthetic chunks to real, so a rejected write that reached it
    // would mutate the tree and break the byte-identical round-trip
    // (`parse()` -> `save()`). A field with no backing chunk body must
    // validate too, or its `__dict__` fallback below would accept a
    // value the chunk-backed path rejects.
    if (this.validate) this.validate(value, obj);
    if (this._enum_cls != null) _validate_enum_member(this._enum_cls, value, this.public_name);
    if (this.pre_set != null) getattr(obj, this.pre_set).call(obj);
    instance_dict(obj).delete(this.public_name);
    let body = getattr(obj, this.chunk_attr);
    if (body == null) {
      instance_dict(obj).set(this.public_name, value);
      return;
    }
    if (py_bool(getattr(body, "synthetic", false))) {
      obj._ensure_materialized();
      body = getattr(obj, this.chunk_attr);
    }
    if (this.reverse != null) body[this.field] = this.reverse(value);
    else body[this.field] = value;
    if (this.post_set != null) {
      if (typeof this.post_set === "string") {
        getattr(obj, this.post_set).call(obj);
      } else {
        const post = this.post_set;
        post(obj);
      }
    }
  }

  // NOTE: the Python source shadows the builtin `bool` inside the class
  // body, so annotations there spell it `builtins.bool`; in TS the static
  // method below is simply `boolean`-typed.
  /**
   * Create a ChunkField for a boolean field.
   *
   * Bakes in `validate=validate_bool` so a writable bool field cannot
   * silently accept a non-bool: the binary layer packs the value
   * straight into a 1-byte field, so `= 2` would write a byte AE never
   * writes and `= "no"` would only blow up later, at `save()`.
   *
   * Pass `validate=` to override (compose by calling `validate_bool`
   * first). For a bool backed by a generic integer chunk field (e.g.
   * `U1Chunk.value`) add `transform=bool, reverse=int`.
   */
  static bool(chunk_attr: string, field: string, kwargs: Record<string, any> = {}): ChunkField<boolean> {
    kwargs = { ...kwargs };
    if (!("validate" in kwargs)) kwargs.validate = validate_bool;
    return new this(chunk_attr, field, kwargs);
  }

  /**
   * Create a ChunkField for IntEnum-backed fields.
   *
   * Auto-detects `from_binary`/`to_binary` on the enum class. If
   * the enum has a `from_binary` classmethod it is used as
   * `transform`; otherwise the class itself is used. If the enum
   * has a `to_binary` method it is used as `reverse`; otherwise
   * `int` is used.
   *
   * @param kw - Keyword arguments:
   * - `allow_out_of_enum_values`: When `true`, a stored value outside the enum reads back raw
   *     instead of raising - real `.aep` files hold them (an unlabelled output depth, a format id
   *     from a third-party output plugin) and the binary is trusted. Wrapping the transform hides
   *     the enum class from `_enum_class`, so write-side membership strictness is restored via
   *     `validate=validate_enum(enum_cls)` unless the caller passes its own `validate` (which must
   *     then check membership itself).
   *   The field then reads as `EnumValue<E> | Raw`, `Raw` being the rest of the
   *   declared field type (`declare depth: OutputColorDepth | number`).
   */
  static enum<E extends EnumHelpers<unknown>, Raw = never>(
    enum_cls: E,
    chunk_attr: string,
    field: string,
    kw: { allow_out_of_enum_values: true; [key: string]: any },
  ): ChunkField<EnumValue<E> | Raw>;
  static enum<E extends EnumHelpers<unknown>>(
    enum_cls: E,
    chunk_attr: string,
    field: string,
    kw?: { allow_out_of_enum_values?: false; [key: string]: any },
  ): ChunkField<EnumValue<E>>;
  static enum(
    enum_cls: any,
    chunk_attr: string,
    field: string,
    kw: { allow_out_of_enum_values?: boolean; [key: string]: any } = {},
  ): ChunkField<unknown> {
    const { allow_out_of_enum_values = false, ...kwargs } = kw;
    if (!("transform" in kwargs)) kwargs.transform = bound_enum_method(enum_cls, "from_binary", enum_cls);
    if (!("reverse" in kwargs)) kwargs.reverse = bound_enum_method(enum_cls, "to_binary", int);
    if (allow_out_of_enum_values) {
      kwargs.transform = enum_or_raw(kwargs.transform);
      if (!kwargs.read_only) {
        if (!("validate" in kwargs)) kwargs.validate = validate_enum(enum_cls);
      }
    }
    return new this(chunk_attr, field, kwargs);
  }
}
