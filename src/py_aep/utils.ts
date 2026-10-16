/** General-purpose utilities for py_aep. */

import { warn } from "../pyrt/index.ts";

/**
 * Decorator that marks a function as deprecated.
 *
 * Emits a `DeprecationWarning` with `message` each time the decorated
 * function is called.
 *
 * @param message Explanation shown in the warning (e.g. migration path).
 */
export function deprecated(message: string) {
  return function decorator<R>(func: (...args: any[]) => R): (...args: any[]) => R {
    function wrapper(this: any, ...args: any[]): R {
      // TODO(port): warnings.warn category DeprecationWarning and stacklevel=2 are dropped; pyrt
      // warn() takes only the message (needs a category/stacklevel-aware shim).
      // TODO(port): __qualname__ has no JS equivalent; func.name is used, so methods warn as "m" not "Cls.m".
      warn(`${func.name} is deprecated. ${message}`);
      return func.apply(this, args);
    }
    // functools.wraps(func): copy __name__ and set __wrapped__ (no __doc__/__qualname__ in JS).
    Object.defineProperty(wrapper, "name", { value: func.name, configurable: true });
    (wrapper as any).__wrapped__ = func;
    return wrapper;
  };
}
