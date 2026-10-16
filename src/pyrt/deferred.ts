// Python's function-level import (`from .x import Y` inside a function, the
// usual cycle breaker). A top-level ESM import of a module that `extends`
// a class from this one would evaluate before this module's class exists;
// `deferred` loads the module on first use instead.
//
//   const _mask_property_group = deferred<typeof import("./mask_property_group.ts")>(import.meta.url, "./mask_property_group.ts");
//   ... _mask_property_group().MaskPropertyGroup ...

import { createRequire } from "node:module";

export function deferred<M>(url: string, specifier: string): () => M {
  const req = createRequire(url);
  let mod: M | undefined;
  return () => (mod ??= req(specifier) as M);
}
