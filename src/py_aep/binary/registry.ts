/**
 * Chunk type registry for dispatching binary parsing.
 */

import type { Chunk } from "./chunk.ts";

export const CHUNK_TYPES: Map<string, typeof Chunk> = new Map();

/**
 * Decorator that registers a Chunk subclass for one or more chunk_types.
 */
export function register(...chunk_types: string[]): <T extends typeof Chunk>(cls: T) => T {
  function decorator<T extends typeof Chunk>(cls: T): T {
    for (const ct of chunk_types) {
      CHUNK_TYPES.set(ct, cls);
    }
    return cls;
  }
  return decorator;
}
