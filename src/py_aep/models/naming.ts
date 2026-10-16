/** Name generation and incrementing utilities for project items. */

import { int, isdigit, rstrip } from "../../pyrt/index.ts";

// Python `\d` on str patterns matches Unicode Nd digits, hence \p{Nd}. Python `$`
// also matches before one trailing "\n", hence the lookahead.
const _TRAILING_NUMBER_RE = /(\p{Nd}+)(?=\n?$)/u;

function _next_suffix(prefix: string, existing_names: Set<string>): number {
  /**
   * Return the next available numeric suffix for `{prefix}{N}`.
   *
   * Returns 1 if no name in `existing_names` starts with `prefix`.
   * If any name matches `prefix` (with or without a digit suffix),
   * suffix 1 is skipped - returns at least 2.
   */
  let max_suffix = 0;
  for (const name of existing_names) {
    if (name.startsWith(prefix)) {
      const tail = name.slice(prefix.length);
      if (isdigit(tail)) {
        const n = int(tail);
        max_suffix = Math.max(max_suffix, n > 0 ? n : 1);
      } else {
        max_suffix = Math.max(max_suffix, 1);
      }
    } else if (name === rstrip(prefix)) {
      max_suffix = Math.max(max_suffix, 1);
    }
  }
  return max_suffix + 1;
}

export function auto_name(name: string, existing_names: Set<string>): string {
  /**
   * Find the next available incremented name.
   *
   * - Removes the number suffix if there is one
   * - Finds the highest number suffix with the same prefix in `existing_names`
   * - Increments it by 1
   * - If no existing name starts with the base name, return `{name} 1`.
   * - If existing names start with the base name but none has a number suffix, skip 1 and
   * return `{name} 2`.
   */
  const match = _TRAILING_NUMBER_RE.exec(name);
  let prefix: string;
  if (match) {
    prefix = name.slice(0, match.index);
  } else {
    prefix = `${name} `;
  }
  const suffix = _next_suffix(prefix, existing_names);
  return `${prefix}${suffix}`;
}
