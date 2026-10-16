/**
 * Settings-view infrastructure for render queue settings.
 *
 * `SettingsView` provides a thin `MutableMapping` wrapper that proxies
 * attribute access on the owner class: each ExtendScript key maps to a
 * model attribute (either a ChunkField descriptor or a `@property`).
 */

import {
  AttributeError,
  KeyError,
  TypeError_,
  ValueError,
  contains,
  dict_get,
  getattr,
  int,
  len,
  py_bool,
  py_eq,
  repr,
  sorted,
  str,
  tkey,
} from "../../../pyrt/index.ts";
import type { CompPreset } from "../../parsers/comp_presets.ts";
import type { Preferences } from "../preferences.ts";

// TODO(pyrt): py_enum members are plain numbers and carry no owning class, so
// `isinstance(value, IntEnum)` cannot be answered. This placeholder answers
// "never an IntEnum member": enum-valued settings then pass through as plain
// ints, and STRING output shows the number instead of the enum label.
export const IntEnum = {
  has(_value: unknown): boolean {
    return false;
  },
};

// Python `member.label` property; the enum objects expose it as `E.label(member)`.
export function enum_label(enum_class: any, member: any): string {
  return enum_class.label(member);
}

// TODO(pyrt): `type(x).__name__` has no pyrt shim. Covers the builtin types
// this module can receive.
export function py_type_name(value: any): string {
  if (value == null) return "NoneType";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "float";
  if (typeof value === "string") return "str";
  if (value instanceof Uint8Array) return "bytes";
  if (Array.isArray(value)) return "list";
  if (value instanceof Map) return "dict";
  return value.constructor?.name ?? "object";
}

// TODO(pyrt): `repr()` of a dict (Map) is not in pyrt. Formats `{k!r: v!r, ...}`.
export function repr_map(m: Map<unknown, unknown>): string {
  const r = (x: unknown): string => (x instanceof Map ? repr_map(x) : repr(x));
  return "{" + [...m].map(([k, v]) => `${r(k)}: ${r(v)}`).join(", ") + "}";
}

// TODO(pyrt): Python's Mapping `.items()` protocol. dicts are Maps; SettingsView
// provides its own `items()`.
export function mapping_items(m: Map<string, any> | SettingsView): Array<[string, any]> {
  return m instanceof Map ? [...m.entries()] : m.items();
}

/** Type alias for a settings spec: (attribute_name, optional_enum_class). */
export type SettingsSpec = Map<string, [string, any]>;

/**
 * Dict-like view mapping ExtendScript setting keys to model attributes.
 *
 * Every read delegates to `getattr(owner, attr_name)` and every write
 * delegates to `setattr(owner, attr_name, value)`. Validation is handled by
 * the underlying ChunkField descriptors or `@property` setters.
 *
 * When `enum_class` is provided for a key, `__setitem__` coerces
 * the value (int, string label, or enum member) before passing it
 * to the descriptor.
 */
export class SettingsView {
  declare _owner: object;
  declare _specs: SettingsSpec;

  constructor(owner: object, specs: SettingsSpec) {
    this._owner = owner;
    this._specs = specs;
  }

  // -- reads -------------------------------------------------------------

  __getitem__(key: string): any {
    const spec = dict_get(this._specs, key);
    if (spec == null) throw new KeyError(repr(key));
    const [attr_name] = spec;
    return getattr(this._owner, attr_name);
  }

  // -- writes ------------------------------------------------------------

  __setitem__(key: string, value: any): void {
    const spec = dict_get(this._specs, key);
    if (spec == null) {
      const valid = sorted(this._specs.keys());
      throw new KeyError(`Unknown setting ${repr(key)}. Valid keys: ${repr(valid)}`);
    }
    const [attr_name, enum_class] = spec;
    if (enum_class != null) value = _coerce_enum(enum_class, value);
    // TODO(port): a plain JS getter-only accessor throws a native TypeError in
    // strict mode, which Python would have raised as AttributeError. Only
    // descriptor setters (which throw AttributeError) convert here.
    try {
      (this._owner as any)[attr_name] = value;
    } catch (e) {
      if (!(e instanceof AttributeError)) throw e;
      throw new AttributeError(`Setting ${repr(key)} is read-only.`);
    }
  }

  __delitem__(key: string): void {
    throw new TypeError_("Cannot delete settings keys");
  }

  // -- iteration ---------------------------------------------------------

  [Symbol.iterator](): Iterator<string> {
    return this._specs.keys();
  }

  __len__(): number {
    return len(this._specs);
  }

  __contains__(key: unknown): boolean {
    return contains(this._specs, key);
  }

  // -- MutableMapping mixin methods (inherited in Python) -----------------

  keys(): string[] {
    return [...this._specs.keys()];
  }

  items(): Array<[string, any]> {
    return [...this._specs.keys()].map((key): [string, any] => [key, this.__getitem__(key)]);
  }

  values(): any[] {
    return this.items().map(([, v]) => v);
  }

  get(key: string, default_: any = null): any {
    try {
      return this.__getitem__(key);
    } catch (e) {
      if (!(e instanceof KeyError)) throw e;
      return default_;
    }
  }

  update(other: Map<string, any> | SettingsView | Iterable<[string, any]> = [], kwargs: Record<string, any> = {}): void {
    if (other instanceof Map || other instanceof SettingsView) {
      for (const [k, v] of mapping_items(other)) this.__setitem__(k, v);
    } else {
      for (const [k, v] of other) this.__setitem__(k, v);
    }
    for (const [k, v] of Object.entries(kwargs)) this.__setitem__(k, v);
  }

  setdefault(key: string, default_: any = null): any {
    try {
      return this.__getitem__(key);
    } catch (e) {
      if (!(e instanceof KeyError)) throw e;
      this.__setitem__(key, default_);
      return default_;
    }
  }

  pop(key: string, ...default_: [any?]): any {
    let value: any;
    try {
      value = this.__getitem__(key);
    } catch (e) {
      if (!(e instanceof KeyError)) throw e;
      if (default_.length) return default_[0];
      throw e;
    }
    this.__delitem__(key);
    return value;
  }

  popitem(): [string, any] {
    const it = this._specs.keys().next();
    if (it.done) throw new KeyError("");
    const key = it.value;
    const value = this.__getitem__(key);
    this.__delitem__(key);
    return [key, value];
  }

  clear(): void {
    // TODO(port): Python's MutableMapping.clear() loops popitem() until KeyError;
    // popitem raises TypeError here (delete is unsupported), as in Python.
    for (;;) {
      try {
        this.popitem();
      } catch (e) {
        if (e instanceof KeyError) return;
        throw e;
      }
    }
  }

  __repr__(): string {
    return `SettingsView(${repr_map(new Map(this.items()))})`;
  }

  __eq__(other: unknown): boolean {
    if (other instanceof Map || other instanceof SettingsView) {
      return py_eq(new Map(this.items()), new Map(mapping_items(other)));
    }
    // TODO(port): Python returns NotImplemented here. pyrt has no sentinel for
    // it, so `false` is returned and the reflected `other.__eq__(self)` attempt
    // is not made.
    return false;
  }
}

/**
 * Coerce a value to an enum member.
 *
 * Accepts:
 *     - An enum member of the correct type
 *     - An int matching an enum member's value
 *     - A string matching an enum member's label
 */
export function _coerce_enum(enum_class: any, value: any): any {
  if (enum_class.has(value)) return value;
  if (typeof value === "boolean") {
    // bool is int: settings["Output Audio"] = True would silently
    // coerce to OutputAudio.OFF (== 1). Reject rather than surprise.
    throw new TypeError_(`Expected ${enum_class.__name__}, int, or str, got bool`);
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    try {
      return enum_class.of(value);
    } catch (e) {
      if (!(e instanceof ValueError)) throw e;
      const members = enum_class
        .members()
        .map((m: any) => `${enum_class.name_of(m)} (${int(m)})`)
        .join(", ");
      throw new ValueError(
        `Invalid int value ${repr(value)} for ${enum_class.__name__}. ` +
          `Valid members: ${members}`,
      );
    }
  }
  if (typeof value === "string") {
    const by_label = new Map<string, any>();
    for (const m of enum_class.members()) by_label.set(enum_label(enum_class, m), m);
    if (by_label.has(value)) return by_label.get(value);
    const labels = enum_class
      .members()
      .map((m: any) => repr(enum_label(enum_class, m)))
      .join(", ");
    throw new ValueError(
      `Invalid string ${repr(value)} for ${enum_class.__name__}. ` +
        `Valid labels: ${labels}`,
    );
  }
  throw new TypeError_(
    `Expected ${enum_class.__name__}, int, or str, got ${py_type_name(value)}`,
  );
}

export const _RESOLUTION_STRINGS: Map<string, string> = new Map<string, string>([
  // [0, 0] is the "use the comp's own resolution" sentinel (probed AE
  // 2026: getSettings(STRING) reads back "Current Settings").
  [tkey(0, 0), "Current Settings"],
  [tkey(1, 1), "Full"],
  [tkey(2, 2), "Half"],
  [tkey(3, 3), "Third"],
  [tkey(4, 4), "Quarter"],
]);

// AE's "Resize to" dropdown labels a target resolution with a New
// Composition preset name. When several presets share a resolution, AE
// picks the LOWEST frame rate (ties broken by the later preset) - probed
// in AE 2026 by reading OutputModule.getSetting("Resize to") for each
// collision resolution against the live comp presets. These labels are
// derived from the user's presets when a preferences directory is
// provided (see build_resize_to_strings); this table is the factory-
// preset fallback used when it is not, and holds AE's actual strings for
// a default install.
export const _RESIZE_TO_STRINGS: Map<string, string> = new Map<string, string>([
  [tkey(3656, 2664), "Cineon Full  •  3656x2664 • 24 fps"],
  [tkey(1828, 1332), "Cineon Half  •  1828x1332 • 24 fps"],
  [tkey(1280, 1080), "DVCPRO HD  •  1280x1080 (1.5) • 29.97 fps"],
  [tkey(1440, 1080), "DVCPRO HD  •  1440x1080 (1.33) • 25 fps"],
  [tkey(960, 720), "DVCPRO HD  •  960x720 (1.33) • 23.976 fps"],
  [tkey(2048, 1556), "Film (2K)  •  2048x1556 • 24 fps"],
  [tkey(4096, 3112), "Film (4K)  •  4096x3112 • 24 fps"],
  [tkey(1920, 1080), "HD  •  1920x1080 • 24 fps"],
  [tkey(1280, 720), "HDV/HDTV  •  1280x720 • 25 fps"],
  [tkey(720, 1280), "Social Media Portrait  •  720x1280 • 30 fps"],
  [tkey(1080, 1920), "Social Media Portrait HD  •  1080x1920 • 30 fps"],
  [tkey(1080, 1080), "Social Media Square  •  1080x1080 • 30 fps"],
  [tkey(3840, 2160), "UHD (4K)  •  3840x2160 • 23.976 fps"],
  [tkey(7680, 4320), "UHD (8K)  •  7680x4320 • 23.976 fps"],
]);

/**
 * Build the "Resize to" resolution -> preset-name map from prefs.
 *
 * Mirrors AE's Resize dropdown: one label per resolution, choosing the
 * lowest-frame-rate New Composition preset at that resolution (ties
 * broken by the later preset). Falls back to [_RESIZE_TO_STRINGS][] (AE's
 * factory-preset labels) when no preferences directory was provided.
 */
export function build_resize_to_strings(preferences: Preferences): Map<string, string> {
  const presets = preferences.composition_presets();
  if (!py_bool(presets)) return _RESIZE_TO_STRINGS;
  const best = new Map<string, CompPreset>();
  for (const preset of presets) {
    const key = tkey(preset.width, preset.height);
    const current = dict_get(best, key);
    if (current == null || preset.frame_rate <= current.frame_rate) best.set(key, preset);
  }
  return new Map<string, string>([...best.entries()].map(([key, preset]) => [key, preset.name] as [string, string]));
}

/**
 * Convert a settings value to NUMBER format.
 *
 * IntEnum values are unwrapped to their integer value.
 * All other types pass through unchanged.
 */
export function _to_number_value(value: any): any {
  if (IntEnum.has(value)) return int(value);
  return value;
}

/**
 * Convert a settings value to STRING format.
 *
 * Args:
 *     key: The settings key name.
 *     value: The settings value.
 *     resize_map: Resolution -> label map for the "Resize to" key
 *         (the AE-preference-derived map, or the factory fallback).
 */
export function _to_string_value(
  key: string,
  value: any,
  resize_map: Map<string, string> = _RESIZE_TO_STRINGS,
): any {
  if (value instanceof Map) {
    return new Map([...value.entries()].map(([k, v]) => [k, _to_string_value(k, v, resize_map)]));
  }
  if (IntEnum.has(value)) {
    // TODO(pyrt): unreachable while IntEnum.has is the placeholder above. Needs the
    // owning enum class to read `.label`.
    return (value as any).label;
  }
  if (key === "Resolution") return dict_get(_RESOLUTION_STRINGS, tkey(...value), "Custom");
  if (key === "Resize to") return dict_get(resize_map, tkey(...value), "Custom");
  if (typeof value === "boolean") return str(value).toLowerCase();
  // TODO(port): int/float distinction. A float such as 1.0 renders as "1" here,
  // but Python's str(1.0) is "1.0".
  return str(value);
}

/**
 * Convert settings to NUMBER format.
 *
 * IntEnum values are unwrapped to plain integers. Other values
 * (bool, float, int, list) pass through unchanged.
 *
 * Args:
 *     settings: The typed settings dict.
 */
export function settings_to_number(settings: Map<string, any> | SettingsView): Map<string, any> {
  return new Map<string, any>(
    mapping_items(settings).map(([k, v]): [string, any] => [k, _to_number_value(v)]),
  );
}

/**
 * Convert settings to STRING format.
 *
 * All values are converted to their ExtendScript STRING representation.
 *
 * Args:
 *     settings: The typed settings dict.
 *     resize_map: Resolution -> label map for the "Resize to" key
 *         (from [build_resize_to_strings][]); defaults to the factory
 *         fallback table.
 */
export function settings_to_string(
  settings: Map<string, any> | SettingsView,
  resize_map: Map<string, string> = _RESIZE_TO_STRINGS,
): Map<string, string> {
  return new Map<string, string>(
    mapping_items(settings).map(([k, v]): [string, string] => [k, _to_string_value(k, v, resize_map)]),
  );
}
