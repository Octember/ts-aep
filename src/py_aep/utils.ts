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
    // TODO(port): functools.wraps(func) copies __name__/__doc__/__qualname__/__wrapped__ onto
    // the wrapper; not replicated here. Only the callable behavior is kept.
    function wrapper(...args: any[]): R {
      // TODO(port): warnings.warn category DeprecationWarning and stacklevel=2 have no pyrt
      // equivalent; pyrt warn() takes only the message.
      // TODO(port): __qualname__ has no JS equivalent; func.name is used (no class/outer scope).
      warn(`${func.name} is deprecated. ${message}`);
      return func(...args);
    }
    return wrapper;
  };
}
