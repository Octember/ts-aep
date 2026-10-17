// The slice of `attrs` py_aep uses: `@define` classes with ordered,
// inherited fields, defaults / `Factory`, `metadata`, `init=False`, the
// leading-underscore init-name rule, and converters that also run on
// assignment (attrs' default `on_setattr`).
//
//   export class U1Chunk extends Chunk {
//     declare value: number;            // `declare`: no JS initializer
//   }
//   define(U1Chunk, { value: u1_field() });
//   register("efdc")(U1Chunk);          // decorators apply bottom-up
//
// Construction is keyword-only: `new U1Chunk({ chunk_type: "efdc", value: 1 })`.

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

/**
 * `@define`: record `cls`'s own fields after its base's. A field redefined
 * here replaces the inherited one and moves to its new position, as attrs
 * orders them.
 */
export function define<C extends Function>(cls: C, own: Record<string, FieldSpec> = {}): C {
  const base = Object.getPrototypeOf(cls);
  const inherited = (base && FIELDS.get(base)) || [];
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

/** Pass as the constructor argument to skip attrs' `__init__` (a hand-written `__init__` sets fields itself). */
export const NO_INIT: unique symbol = Symbol("NO_INIT");

function default_of(a: Attribute): any {
  const d = a.default;
  if (d === NOTHING) return NOTHING;
  if (d && typeof d === "object" && "__factory__" in d) return d.__factory__();
  return d;
}

/** `fields(cls)` flattened into parallel arrays, built on a class's first construction. */
type Plan = { names: string[]; aliases: string[]; init: boolean[]; defs: any[]; factory: boolean[] };
const PLANS = new WeakMap<Function, Plan>();

function plan_of(cls: Function): Plan {
  let p = PLANS.get(cls);
  if (p) return p;
  const attrs = fields(cls);
  const is_factory = (d: any) => !!d && typeof d === "object" && "__factory__" in d;
  p = {
    names: attrs.map((a) => a.name),
    aliases: attrs.map((a) => a.alias),
    init: attrs.map((a) => a.init),
    defs: attrs.map((a) => (is_factory(a.default) ? a.default.__factory__ : a.default)),
    factory: attrs.map((a) => is_factory(a.default)),
  };
  PLANS.set(cls, p);
  return p;
}

/**
 * The generated `__init__`. Keyword names are only counted here; when the
 * count shows an unexpected one, `attrs_init_slow` reruns to raise attrs' error.
 */
export function attrs_init(self: any, cls: Function, kw: Record<string, any>): void {
  const { names, aliases, init, defs, factory } = plan_of(cls);
  let matched = 0;
  for (let i = 0; i < names.length; i++) {
    let v: any;
    if (init[i]) {
      const alias = aliases[i];
      if (alias in kw) {
        matched++;
        v = kw[alias];
      }
    }
    if (v === undefined) {
      v = factory[i] ? defs[i]() : defs[i];
      if (v === NOTHING) {
        if (!init[i]) continue;
        throw new TypeError_(`${cls.name}.__init__() missing 1 required argument: '${aliases[i]}'`);
      }
    }
    self[names[i]] = v;
  }
  let n = 0;
  for (const _ in kw) n++;
  if (n !== matched) attrs_init_slow(self, cls, kw);
}

function attrs_init_slow(self: any, cls: Function, kw: Record<string, any>): void {
  const attrs = fields(cls);
  const seen = new Set<string>();
  for (const a of attrs) {
    if (!a.init) {
      const d = default_of(a);
      if (d !== NOTHING) self[a.name] = d;
      continue;
    }
    let v: any;
    if (Object.prototype.hasOwnProperty.call(kw, a.alias) && kw[a.alias] !== undefined) {
      v = kw[a.alias];
      seen.add(a.alias);
    } else {
      v = default_of(a);
      if (Object.prototype.hasOwnProperty.call(kw, a.alias)) seen.add(a.alias);
      if (v === NOTHING) {
        throw new TypeError_(`${cls.name}.__init__() missing 1 required argument: '${a.alias}'`);
      }
    }
    self[a.name] = v;
  }
  for (const k of Object.keys(kw)) {
    if (!seen.has(k)) throw new TypeError_(`${cls.name}.__init__() got an unexpected keyword argument '${k}'`);
  }
}

/** Base for attrs classes; subclasses must declare fields with `declare` and register them via `define`. */
export class AttrsBase {
  constructor(kw: Record<string, any> | typeof NO_INIT = {}) {
    if (kw !== NO_INIT) attrs_init(this, new.target, kw);
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
