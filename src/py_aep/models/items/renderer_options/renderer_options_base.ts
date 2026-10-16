/** Shared plumbing for the per-renderer option wrappers. */

import { AttributeError, object_setattr, py_object, repr } from "../../../../pyrt/index.ts";
import { SettingsView, type SettingsSpec } from "../../renderqueue/settings.ts";
import type { CompItem } from "../composition.ts";

/**
 * A renderer's options, as both a mapping and a typed object.
 *
 * Subclasses [SettingsView][] with itself as the owner, so one object
 * satisfies both idioms.
 *
 * Example:
 * ```python
 * comp.renderer_options["Quality"] = 61     # mapping
 * comp.renderer_options.quality = 61        # typed, validated
 * ```
 *
 * The [CompItem][] is held because Advanced 3D stores its Casting Box
 * values as fractions of the composition's own pixel dimensions.
 */
export class RendererOptionsBase extends SettingsView {
  // ExtendScript-style key -> (attribute name, optional enum class)
  static _SPEC: SettingsSpec = new Map();

  declare _body: any;
  declare _comp: CompItem;

  constructor(kw: { body: any; comp: CompItem }) {
    const { body, comp } = kw;
    // TODO(port): Python passes `self` as the SettingsView owner. TS forbids
    // touching `this` (passing it included) before super(), so the owner is
    // patched in just below. SettingsView only stores the reference, so
    // nothing observes the placeholder in between.
    super(null as any, (new.target as typeof RendererOptionsBase)._SPEC);
    this._body = body;
    this._comp = comp;
    (this as any)._owner = this;
    return py_object(this);
  }

  __setattr__(name: string, value: any): void {
    // A fresh wrapper is built on every `renderer_options` access, so a
    // write to a name with no backing descriptor would vanish with the
    // wrapper. Reject it instead of silently dropping it.
    // TODO(port): Python `hasattr(type(self), name)` is checked with
    // `in` on the prototype, not pyrt `hasattr`. Descriptors live on the
    // prototype (pyrt `descriptor`), and pyrt `hasattr` would invoke their
    // getters with the prototype as `this`, which can throw.
    if (!name.startsWith("_") && !(name in (this.constructor as any).prototype)) {
      throw new AttributeError(`${this.constructor.name} has no option ${repr(name)}`);
    }
    object_setattr(this, name, value);
  }

  __repr__(): string {
    return `${this.constructor.name}(${repr(new Map(this.items()))})`;
  }
}
