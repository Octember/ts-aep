/** Ray-traced 3D (`ADBE Picasso`) render options. */

import { RendererOptionsBase } from "./renderer_options_base.ts";
import type { RayTracedPrdaChunk } from "../../../binary/misc_chunks.ts";

/**
 * Options for the Ray-traced 3D renderer.
 *
 * Deliberately empty. The renderer was removed in AE 2020 (17.0), so its
 * Options dialog cannot be opened and its stored fields could never be
 * matched to controls. Files using it parse and re-save byte-exact;
 * there is nothing safe to expose. Read-only.
 */
export class RayTracedRendererOptions extends RendererOptionsBase {
  declare _body: RayTracedPrdaChunk;

  static _SPEC: Map<string, [string, any]> = new Map<string, [string, any]>();
}
