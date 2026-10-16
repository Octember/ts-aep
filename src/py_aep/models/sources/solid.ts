import { str } from "../../../pyrt/index.ts";
import { SoliOptiChunk, SspcChunk } from "../../binary/footage_chunks.ts";
import { solid_color_name } from "../../resolvers/solid.ts";
import { ChunkField, descriptor } from "../descriptors.ts";
import {
  validate_opti_name,
  validate_pixel_aspect,
  validate_rgb_color,
  validate_solid_dimension,
} from "../validators.ts";
import { FootageSource } from "./footage.ts";

import type { ListChunk } from "../../binary/chunk.ts";
import type { OptiChunk } from "../../binary/footage_chunks.ts";
import type { U1Chunk } from "../../binary/scalar_chunks.ts";

/**
 * The `SolidSource` object represents a solid-color footage source.
 *
 * Example:
 * ```python
 * from py_aep import SolidSource, parse
 *
 * app = parse("project.aep")
 * footage = app.project.footages[0]
 * if isinstance(footage.main_source, SolidSource):
 *     print(footage.main_source.color)
 * ```
 *
 * Info:
 * `SolidSource` is a subclass of [FootageSource][] object. All methods and
 * attributes of [FootageSource][] are available when working with `SolidSource`.
 *
 * See: https://ae-scripting.docsforadobe.dev/sources/solidsource/
 */
export class SolidSource extends FootageSource {
  declare _opti: OptiChunk;

  static _owns_name = true;

  /**
   * The solid color, expressed as `[R, G, B]` values in the
   * range `[0.0..1.0]`. Read / Write.
   */
  declare color: number[];

  constructor(kw: {
    _sspc: SspcChunk;
    _opti: OptiChunk;
    _linl?: U1Chunk | null;
    _clrs?: ListChunk | null;
  }) {
    const { _sspc, _opti, _linl = null, _clrs = null } = kw;
    super({ _sspc, _linl, _clrs });
    this._opti = _opti;
  }

  /**
   * Derive the base solid name from an RGB color.
   *
   * After Effects names solids by their perceived color category.
   * Returns the base name (e.g. `"Red Solid"`) without a trailing
   * number suffix; the caller is responsible for disambiguation.
   *
   * Args:
   *     r: Red channel in `[0.0, 1.0]`.
   *     g: Green channel in `[0.0, 1.0]`.
   *     b: Blue channel in `[0.0, 1.0]`.
   */
  static _color_name(r: number, g: number, b: number): string {
    return solid_color_name(r, g, b);
  }

  /**
   * Create a new solid source with backing chunks.
   *
   * Args:
   *     color: Solid color as [R, G, B] in 0.0-1.0 range.
   *     name: The solid name.
   *     width: Width in pixels (1-30000).
   *     height: Height in pixels (1-30000).
   *     pixel_aspect: Pixel aspect ratio (0.01-100.0).
   */
  static _new(
    name: string,
    color: number[] = [0.0, 0.0, 0.0],
    width: number = 100,
    height: number = 100,
    pixel_aspect: number = 1.0,
  ): SolidSource {
    validate_opti_name(name);
    validate_solid_dimension(width);
    validate_solid_dimension(height);
    validate_pixel_aspect(pixel_aspect);
    validate_rgb_color(color);

    const sspc = new SspcChunk({
      width,
      height,
      source_format_type: "Soli",
      alpha_mode_raw: 3,
      duration_dividend: 0,
    });
    sspc.pixel_aspect = pixel_aspect;

    const opti = new SoliOptiChunk({
      color_r: color[0],
      color_g: color[1],
      color_b: color[2],
      solid_name: name,
    });

    return new this({ _sspc: sspc, _opti: opti });
  }

  _resolve_name(raw_name: string): string {
    return str((this._opti as SoliOptiChunk).solid_name);
  }

  _store_name(value: string): void {
    validate_opti_name(value);
    (this._opti as SoliOptiChunk).solid_name = value;
  }
}

descriptor(
  SolidSource,
  "color",
  new ChunkField<number[]>("_opti", "color", {
    validate: validate_rgb_color,
  }),
);
