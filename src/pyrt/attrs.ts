// The slice of `attrs` py_aep uses: `@define` classes with ordered,
// inherited fields, defaults / `Factory`, `metadata`, `init=False`, the
// leading-underscore init-name rule, and converters that also run on
// assignment (attrs' default `on_setattr`).
//
//   export class U1Chunk extends Chunk {
//     declare value: number;            // `declare`: no JS initializer
//
//     constructor(kw: Record<string, any> = {}) {
//       super(kw);                      // the root calls `check_init_kwargs`
//       const { value = 0 } = kw;       // `undefined` means "not passed"
//       this.value = value;
//     }
//   }
//   define(U1Chunk, { value: u1_field() });
//   register("efdc")(U1Chunk);          // decorators apply bottom-up
//
// Construction is keyword-only: `new U1Chunk({ chunk_type: "efdc", value: 1 })`.
// The constructor's defaults must match the spec's; `tools/check_attrs_defaults.ts`
// enforces that.

import { TypeError_ } from "./errors.ts";

export type Factory<T = any> = { readonly __factory__: () => T };

export function Factory<T>(fn: () => T): Factory<T> {
  return { __factory__: fn };
}

const NOTHING: unique symbol = Symbol("NOTHING");

export type FieldSpec = {
  default?: any;
  converter?: ((value: any) => any) | null;
  metadata?: Record<string, any>;
  init?: boolean;
  eq?: boolean;
  repr?: boolean;
};

/** `attrs.Attribute` as `attrs.fields(cls)` returns it. */
export type Attribute = {
  readonly name: string;
  readonly default: any;
  readonly converter: ((value: any) => any) | null;
  readonly metadata: Readonly<Record<string, any>>;
  readonly init: boolean;
  readonly eq: boolean;
  readonly repr: boolean;
  readonly alias: string;
};

/** `attrs.field(...)` */
export function field(spec: FieldSpec = {}): FieldSpec {
  return spec;
}

const FIELDS = new WeakMap<Function, readonly Attribute[]>();

/** attrs strips one leading underscore for the `__init__` parameter: `_trailing` -> `trailing`. */
export function init_name(name: string): string {
  return name.startsWith("_") ? name.replace(/^_+/, "") : name;
}

/** For classes defined without `init: false`: the fields no constructor assigns, filled in by `init_generic_fields`. */
const GENERIC = new WeakMap<Function, readonly Attribute[]>();

function nearest_defined(cls: Function): Function | null {
  for (let c: any = cls; c && c !== Function.prototype; c = Object.getPrototypeOf(c)) {
    if (FIELDS.has(c)) return c;
  }
  return null;
}

/**
 * `@define`: record `cls`'s own fields after its base's. A field redefined
 * here replaces the inherited one and moves to its new position, as attrs
 * orders them.
 *
 * `init: false` (attrs' `@define(init=False)`) says `cls` has a constructor
 * that assigns its own fields. Without it, the root class's constructor
 * assigns them via `init_generic_fields`, after its own.
 */
export function define<C extends Function>(cls: C, own: Record<string, FieldSpec> = {}, opts: { init?: boolean } = {}): C {
  const base = Object.getPrototypeOf(cls);
  const base_defined = base && FIELDS.has(base) ? base : null;
  const inherited = (base_defined && FIELDS.get(base_defined)) || [];
  const own_attrs: Attribute[] = Object.entries(own).map(([name, spec]) => ({
    name,
    default: "default" in spec ? spec.default : NOTHING,
    converter: spec.converter ?? null,
    metadata: Object.freeze({ ...(spec.metadata ?? {}) }),
    init: spec.init ?? true,
    eq: spec.eq ?? true,
    repr: spec.repr ?? true,
    alias: init_name(name),
  }));
  const own_names = new Set(own_attrs.map((a) => a.name));
  const all = [...inherited.filter((a) => !own_names.has(a.name)), ...own_attrs];
  FIELDS.set(cls, Object.freeze(all));
  if (opts.init !== false) {
    const parent_pending = (base_defined && GENERIC.get(base_defined)) || [];
    // A constructor between `cls` and the root would run after the root and
    // overwrite a redefined field's default.
    const owner = base_defined && !GENERIC.has(base_defined) ? base_defined : null;
    const owner_is_root = owner == null || nearest_defined(Object.getPrototypeOf(owner)) == null;
    if (!owner_is_root && inherited.some((a) => own_names.has(a.name) && !parent_pending.includes(a))) {
      throw new TypeError_(`${cls.name} redefines a field of ${owner!.name}; give it a constructor and define it with init: false`);
    }
    GENERIC.set(cls, Object.freeze([...parent_pending.filter((a) => !own_names.has(a.name)), ...own_attrs]));
  }
  for (const a of own_attrs) {
    if (!a.converter) continue;
    const slot = `__attrs_${a.name}`;
    const convert = a.converter;
    Object.defineProperty(cls.prototype, a.name, {
      configurable: true,
      enumerable: true,
      get(this: any) {
        return this[slot];
      },
      set(this: any, value: any) {
        this[slot] = convert(value);
      },
    });
  }
  return cls;
}

/** `attrs.fields(cls)` */
export function fields(cls: Function): readonly Attribute[] {
  // An undecorated subclass inherits its base's `__attrs_attrs__`.
  for (let c: any = cls; c && c !== Function.prototype; c = Object.getPrototypeOf(c)) {
    const f = FIELDS.get(c);
    if (f) return f;
  }
  throw new TypeError_(`${cls.name} is not an attrs-decorated class.`);
}

/** `attrs.has(cls)` */
export function has(cls: Function): boolean {
  try {
    fields(cls);
    return true;
  } catch {
    return false;
  }
}

function default_of(a: Attribute): any {
  const d = a.default;
  if (d === NOTHING) return NOTHING;
  if (d && typeof d === "object" && "__factory__" in d) return d.__factory__();
  return d;
}

/**
 * Assign the fields of `cls` that no constructor handles (classes defined
 * without `init: false`), as attrs' generated `__init__` would. Root
 * constructors call this last.
 */
export function init_generic_fields(self: any, cls: Function, kw: Record<string, any>): void {
  const defined = nearest_defined(cls);
  const pending = defined && GENERIC.get(defined);
  if (!pending) return;
  for (const a of pending) {
    if (!a.init) {
      const d = default_of(a);
      if (d !== NOTHING) self[a.name] = d;
      continue;
    }
    let v = kw[a.alias];
    if (v === undefined) {
      v = default_of(a);
      if (v === NOTHING) throw new TypeError_(`${cls.name}.__init__() missing 1 required argument: '${a.alias}'`);
    }
    self[a.name] = v;
  }
}

const INIT_NAMES = new WeakMap<Function, ReadonlySet<string>>();

/**
 * Reject keyword arguments that are not init names of `cls`, with attrs'
 * `__init__` error. Root constructors call this; each class's constructor
 * then assigns its own fields.
 */
export function check_init_kwargs(cls: Function, kw: object): void {
  let names = INIT_NAMES.get(cls);
  if (names == null) {
    names = new Set(fields(cls).filter((a) => a.init).map((a) => a.alias));
    INIT_NAMES.set(cls, names);
  }
  for (const k in kw) {
    if (!names.has(k)) throw new TypeError_(`${cls.name}.__init__() got an unexpected keyword argument '${k}'`);
  }
}

/** The generated `__eq__`: same class and equal `eq=True` fields. */
export function attrs_eq(a: any, b: any, eq: (x: any, y: any) => boolean): boolean {
  if (a === b) return true;
  if (!a || !b || a.constructor !== b.constructor) return false;
  for (const f of fields(a.constructor)) {
    if (f.eq && !eq(a[f.name], b[f.name])) return false;
  }
  return true;
}
