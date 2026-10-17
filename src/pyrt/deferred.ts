// Python's function-level import (`from .x import Y` inside a function, the
// usual cycle breaker). A top-level ESM import of a module that `extends`
// a class from this one would evaluate before this module's class exists;
// `deferred` looks the module up on first use instead.
//
//   const _mask_property_group = deferred<typeof import("./mask_property_group.ts")>("py_aep/models/properties/mask_property_group");
//   ... _mask_property_group().MaskPropertyGroup ...
//
// The key is the target's path relative to src, without `.ts`. The generated
// hub src/py_aep/_modules.ts (tools/gen_deferred_modules.ts) statically imports
// every target and registers it here; py_aep/index.ts imports the hub last.

const _modules = new Map<string, object>();

export function register(key: string, mod: object): void {
  _modules.set(key, mod);
}

export function deferred<M extends object>(key: string): () => M;
export function deferred(key: string): () => any {
  let mod: any;
  return () => {
    if (mod === undefined) {
      mod = _modules.get(key);
      if (mod === undefined) {
        throw new Error(`deferred module "${key}" is not registered: import py_aep/index.ts, which loads py_aep/_modules.ts`);
      }
    }
    return mod;
  };
}
