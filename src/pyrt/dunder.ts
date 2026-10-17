// Python attribute protocol: descriptors (`__get__`/`__set__`/
// `__set_name__`), `__getattr__` fallbacks and `__setattr__` hooks.
//
// Descriptor in a class body:
//   class Layer:                         class Layer {
//       enabled = ChunkField(...)            declare enabled: boolean;
//                                        }
//                                        descriptor(Layer, "enabled", new ChunkField(...));
//
// `__getattr__` / `__setattr__`: end the constructor with
//   `return py_object(this);`
// and define `__getattr__(name)` / `__setattr__(name, value)` methods. Inside
// `__setattr__`, `object.__setattr__(self, name, value)` is
// `object_setattr(this, name, value)`.

import { AttributeError } from "./errors.ts";

export interface Descriptor {
  __set_name__?(owner: Function, name: string): void;
  __get__(obj: any, owner: Function): any;
  __set__?(obj: any, value: any): void;
  __delete__?(obj: any): void;
}

/**
 * Python `type(self)`: the class attributes (statics) of `C` without its
 * construct signature, so a subclass whose constructor takes other arguments
 * can still narrow it. Declare it on a class that reads its own statics:
 * `declare ["constructor"]: ClassAttributes<typeof Layer>;`
 */
export type ClassAttributes<C> = Function & Omit<C, "prototype">;

const DESCRIPTORS = new WeakMap<Function, Map<string, Descriptor>>();

/** A descriptor whose instance reads produce a `T` (class reads produce the descriptor). */
export interface TypedDescriptor<T> extends Descriptor {
  __get__(obj: object | null, owner: Function): T | Descriptor;
}

/**
 * Install `d` as class attribute `name` of `cls` (runs `__set_name__`).
 * `name` must be declared on the instance type, and `d` must read as the
 * declared type, which a generic descriptor such as `new ChunkField(...)`
 * then infers. `P` is read from `prototype` so a generic class infers its
 * erased instance type (a generic construct signature infers nothing).
 */
export function descriptor<P extends object, K extends string & keyof P>(
  cls: (abstract new (...args: never[]) => object) & { prototype: P },
  name: K,
  d: TypedDescriptor<P[K]>,
): TypedDescriptor<P[K]>;
export function descriptor<D extends Descriptor>(cls: Function, name: string, d: D): D {
  d.__set_name__?.(cls, name);
  let own = DESCRIPTORS.get(cls);
  if (!own) DESCRIPTORS.set(cls, (own = new Map()));
  own.set(name, d);
  Object.defineProperty(cls.prototype, name, {
    configurable: true,
    enumerable: false,
    get(this: { constructor: Function }) {
      return d.__get__(this, this.constructor);
    },
    set(this: object, value: unknown) {
      if (!d.__set__) throw new AttributeError(`can't set attribute '${name}'`);
      d.__set__(this, value);
    },
  });
  return d;
}

/** `type(obj).__dict__[name]` / `getattr(Cls, name)` for a descriptor (walks the MRO). */
export function get_descriptor(cls: Function, name: string): Descriptor | undefined {
  for (let c: Function | null = cls; c && c !== Function.prototype; c = Object.getPrototypeOf(c)) {
    const d = DESCRIPTORS.get(c)?.get(name);
    if (d) return d;
  }
  return undefined;
}

/** All descriptors visible on `cls`, base-first then overridden by subclasses (like `vars()` over the MRO). */
export function descriptors_of(cls: Function): Map<string, Descriptor> {
  const chain: Function[] = [];
  for (let c: Function | null = cls; c && c !== Function.prototype; c = Object.getPrototypeOf(c)) chain.unshift(c);
  const out = new Map<string, Descriptor>();
  for (const c of chain) for (const [k, v] of DESCRIPTORS.get(c) ?? []) out.set(k, v);
  return out;
}

const TARGET: unique symbol = Symbol("target");

/**
 * Wrap a freshly constructed instance so `__getattr__` runs for missing
 * attributes and `__setattr__` for every assignment, as in Python.
 */
export function py_object<T extends object>(self: T): T {
  const has_getattr = typeof (self as { __getattr__?: unknown }).__getattr__ === "function";
  const has_setattr = typeof (self as { __setattr__?: unknown }).__setattr__ === "function";
  if (!has_getattr && !has_setattr) return self;
  const proxy = new Proxy(self, {
    get(target, key, receiver) {
      if (key === TARGET) return target;
      if (typeof key === "symbol" || key in target || !has_getattr) return Reflect.get(target, key, receiver);
      if (key === "then" || key === "toJSON" || key === "constructor") return undefined;
      // Python looks special methods (`__bool__`, `__eq__`, `__len__`, ...) up on the type,
      // never through `__getattr__`; pyrt probes them as property reads, so a miss is undefined.
      if (key.length > 4 && key.startsWith("__") && key.endsWith("__")) return undefined;
      return (receiver as { __getattr__(name: string): unknown }).__getattr__(key);
    },
    set(target, key, value, receiver) {
      if (typeof key === "symbol" || !has_setattr || in_setattr.has(target)) {
        return Reflect.set(target, key, value, receiver);
      }
      (receiver as { __setattr__(name: string, value: unknown): void }).__setattr__(key, value);
      return true;
    },
  });
  return proxy;
}

const in_setattr = new WeakSet<object>();

/** `object.__setattr__(self, name, value)` - bypasses `__setattr__`, still runs descriptors. */
export function object_setattr(self: any, name: string, value: unknown): void {
  const target = self?.[TARGET] ?? self;
  in_setattr.add(target);
  try {
    Reflect.set(target, name, value, self);
  } finally {
    in_setattr.delete(target);
  }
}

/** `object.__getattribute__(self, name)` - no `__getattr__` fallback. */
export function object_getattr(self: any, name: string): any {
  const target = self?.[TARGET] ?? self;
  if (!(name in target)) {
    throw new AttributeError(`'${target.constructor?.name}' object has no attribute '${name}'`);
  }
  return Reflect.get(target, name, self);
}

/**
 * `obj.__dict__`: a per-instance `Map` of instance attributes that bypass
 * descriptors (parse-time overrides that `ChunkField` / `CosField.__get__`
 * read first). Stored as an own, non-enumerable `__dict__` property, so
 * `deepcopy` copies it with the instance and `Object.assign` / spreads skip
 * it; writable and configurable so a class field named `__dict__` may alias it.
 */
export function instance_dict(obj: any): Map<string, any> {
  if (!Object.prototype.hasOwnProperty.call(obj, "__dict__")) {
    Object.defineProperty(obj, "__dict__", {
      value: new Map<string, any>(),
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }
  return obj.__dict__;
}
