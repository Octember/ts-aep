// `enum.IntEnum` / `enum.Enum`. Members are plain values (numbers for
// IntEnum), so they compare with `===` against values read from a file or
// from ExtendScript JSON. What Python hangs off the member hangs off the
// enum object instead:
//
//   Python                         TypeScript
//   BlendingMode.ADD               BlendingMode.ADD
//   BlendingMode(5220)             BlendingMode.of(5220)      (ValueError if unknown, after `_missing_`)
//   member.name                    BlendingMode.name_of(member)
//   member.value                   member
//   isinstance(x, BlendingMode)    BlendingMode.has(x)
//   list(BlendingMode)             BlendingMode.members()
//   BlendingMode["ADD"]            BlendingMode.by_name("ADD")  (KeyError if unknown)
//   BlendingMode.__name__          BlendingMode.__name__
//
// Class-level methods (`from_binary`, `to_binary`, `_missing_`, ...) go in
// `methods`; they are called with the enum object as `this`.
//
//   export const BlendingMode = int_enum("BlendingMode", { NORMAL: 5212, ADD: 5220 }, {
//     from_binary(value: number): BlendingMode { return BlendingMode.of(value); },
//   });
//   export type BlendingMode = EnumValue<typeof BlendingMode>;

import { KeyError, ValueError } from "./errors.ts";

const AUTO: unique symbol = Symbol("auto");

/** `enum.auto()` - the previous value + 1 (1 for the first member). */
export function auto(): typeof AUTO {
  return AUTO;
}

type Resolved<M> = { readonly [K in keyof M]: M[K] extends typeof AUTO ? number : M[K] };

export type EnumHelpers<V> = {
  readonly __name__: string;
  /** `Enum(value)` */
  of(value: unknown): V;
  /** `member.name` */
  name_of(value: V): string;
  /** `isinstance(value, Enum)` */
  has(value: unknown): value is V;
  /** `list(Enum)` (aliases excluded, definition order). */
  members(): V[];
  /** `Enum[name]` */
  by_name(name: string): V;
  /** `Enum.__members__` (aliases included). */
  readonly __members__: ReadonlyMap<string, V>;
};

export type EnumValue<E> = E extends EnumHelpers<infer V> ? V : never;

export function py_enum<const M extends Record<string, unknown>, X extends Record<string, any> = {}>(
  name: string,
  members: M,
  methods?: X & ThisType<Resolved<M> & EnumHelpers<Resolved<M>[keyof M]> & X>,
): Resolved<M> & EnumHelpers<Resolved<M>[keyof M]> & X {
  type V = Resolved<M>[keyof M];
  const by_name = new Map<string, V>();
  const by_value = new Map<unknown, string>();
  const canonical: V[] = [];
  let last = 0;
  for (const [k, raw] of Object.entries(members)) {
    const v = (raw === AUTO ? last + 1 : raw) as V;
    if (typeof v === "number") last = v;
    by_name.set(k, v);
    if (!by_value.has(v)) {
      by_value.set(v, k);
      canonical.push(v);
    }
  }
  const self: any = Object.fromEntries(by_name);
  const helpers: EnumHelpers<V> = {
    __name__: name,
    of(value: unknown): V {
      if (by_value.has(value)) return value as V;
      if (typeof self._missing_ === "function") {
        const found = self._missing_(value);
        if (found != null) return found;
      }
      throw new ValueError(`${typeof value === "string" ? `'${value}'` : String(value)} is not a valid ${name}`);
    },
    name_of(value: V): string {
      const n = by_value.get(value);
      if (n === undefined) throw new ValueError(`${String(value)} is not a valid ${name}`);
      return n;
    },
    has(value: unknown): value is V {
      return by_value.has(value);
    },
    members(): V[] {
      return [...canonical];
    },
    by_name(n: string): V {
      if (!by_name.has(n)) throw new KeyError(`'${n}'`);
      return by_name.get(n)!;
    },
    __members__: by_name,
  };
  for (const [k, v] of Object.entries(helpers)) Object.defineProperty(self, k, { value: v, enumerable: false });
  if (methods) {
    for (const [k, v] of Object.entries(Object.getOwnPropertyDescriptors(methods))) {
      Object.defineProperty(self, k, { ...v, enumerable: false });
    }
  }
  return Object.freeze(self);
}

/** `class X(IntEnum)` */
export const int_enum = py_enum;
