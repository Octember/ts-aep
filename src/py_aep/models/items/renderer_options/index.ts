/**
 * Per-renderer 3D render options.
 *
 * One wrapper class per renderer, selected from the `prda` chunk variant dispatch.
 */

import { AdvancedPrdaChunk, Cinema4DPrdaChunk, ClassicPrdaChunk, RayTracedPrdaChunk } from "../../../binary/misc_chunks.ts";
import { AdvancedRendererOptions } from "./advanced.ts";
import { Cinema4DRendererOptions } from "./cinema_4d.ts";
import { ClassicRendererOptions } from "./classic.ts";
import { RayTracedRendererOptions } from "./ray_traced.ts";
import { RendererOptionsBase } from "./renderer_options_base.ts";
import { dict_get } from "../../../../pyrt/index.ts";
import type { Chunk } from "../../../binary/chunk.ts";
import type { CompItem } from "../composition.ts";

export type RendererOptions =
  | AdvancedRendererOptions
  | Cinema4DRendererOptions
  | ClassicRendererOptions
  | RayTracedRendererOptions
  // Unrecognised prda variants fall back to the empty base wrapper.
  | RendererOptionsBase;

// TODO(port): this table reads the imported classes at module-evaluation time (Python does the same at import); a cycle back into this module would leave them undefined.
export const _WRAPPERS: Map<Function, typeof RendererOptionsBase> = new Map<Function, typeof RendererOptionsBase>([
  [ClassicPrdaChunk, ClassicRendererOptions],
  [AdvancedPrdaChunk, AdvancedRendererOptions],
  [Cinema4DPrdaChunk, Cinema4DRendererOptions],
  [RayTracedPrdaChunk, RayTracedRendererOptions],
]);

/**
 * Wrapper for a comp's `prda` chunk.
 *
 * Falls back to an empty `RendererOptionsBase` for an unrecognised chunk,
 * so a future renderer reads as "no options exposed" rather than raising.
 */
export function renderer_options_for(body: Chunk, comp: CompItem): RendererOptions {
  const wrapper_cls = dict_get(_WRAPPERS, body.constructor, RendererOptionsBase);
  return new wrapper_cls({ body, comp });
}

export { AdvancedRendererOptions, Cinema4DRendererOptions, ClassicRendererOptions, RayTracedRendererOptions, RendererOptionsBase };
