/**
 * Chunk type registry for dispatching binary parsing.
 */

import type { Chunk } from "./chunk.ts";
import type { ChunkClasses } from "./chunk_types.ts";

/** The registry by `chunk_type`; `get` of a literal registered type returns its class. */
export interface ChunkRegistry extends Map<string, typeof Chunk> {
  get<K extends keyof ChunkClasses>(chunk_type: K): ChunkClasses[K] | undefined;
  get(chunk_type: string): typeof Chunk | undefined;
}

export const CHUNK_TYPES: ChunkRegistry = new Map();

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
