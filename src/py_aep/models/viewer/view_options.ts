import { ChannelType, FastPreviewType } from "../../enums/index.ts";
import { ChunkField } from "../descriptors.ts";
import { _validate_number } from "../validators.ts";
import { descriptor } from "../../../pyrt/index.ts";
import type { FipsChunk } from "../../binary/misc_chunks.ts";
import type { AVItem } from "../items/av_item.ts";

/**
 * The `ViewOptions` object represents the options for a given {@link View} object.
 *
 * ```python
 * from py_aep import parse
 *
 * app = parse("project.aep")
 * options = app.active_viewer.views[0].options
 * print(options.zoom)
 * ```
 *
 * @example
 * @see https://ae-scripting.docsforadobe.dev/other/viewoptions/
 */
export class ViewOptions {
  /**
   * The state of the Channels menu. Read / Write.
   */
  declare channels: ChannelType;

  /**
   * When `True`, checkerboards (transparency grid) is enabled in the current view.
   * Read / Write.
   */
  declare checkerboards: boolean;

  /**
   * When `True`, Draft 3D mode is enabled for the Composition panel. This
   * corresponds to the value of the Draft 3D button in the Composition panel.
   * Read / Write.
   */
  declare draft3d: boolean;

  /**
   * The exposure value for the current view. Read / Write.
   */
  declare exposure: number;

  /** When `True`, the grid overlay is visible in the view. Read / Write. */
  declare grid: boolean;

  /** When `True`, indicates guides are locked in the view. Read / Write. */
  declare guides_locked: boolean;

  /**
   * When `True`, indicates layers snap to guides when dragged in the view.
   * Read / Write.
   */
  declare guides_snap: boolean;

  /**
   * When `True`, indicates guides are visible in the view. Read / Write.
   */
  declare guides_visibility: boolean;

  /**
   * When `True`, indicates mask and shape paths are visible in the view.
   * Read / Write.
   */
  declare mask_and_shape_path: boolean;

  /**
   * When `True`, indicates the proportional grid overlay is visible in the
   * view. Read / Write.
   */
  declare proportional_grid: boolean;

  /**
   * When `True`, the region of interest (ROI) selection is active in the view.
   * Read / Write.
   */
  declare region_of_interest: boolean;

  /** Top coordinate of the region of interest in pixels. Read / Write. */
  declare roi_top: number;

  /** Left coordinate of the region of interest in pixels. Read / Write. */
  declare roi_left: number;

  /** Bottom coordinate of the region of interest in pixels. Read / Write. */
  declare roi_bottom: number;

  /** Right coordinate of the region of interest in pixels. Read / Write. */
  declare roi_right: number;

  /** When `True`, indicates rulers are shown in the view. Read / Write. */
  declare rulers: boolean;

  /**
   * When `True`, indicates title/action safe margin guides are visible in the
   * view. Read / Write.
   */
  declare title_action_safe: boolean;

  /**
   * When `True`, indicates display color management is enabled for the view.
   * Read / Write.
   */
  declare use_display_color_management: boolean;

  /**
   * The current zoom value for the view, as a normalized percentage between 1%
   * (0.01) and 1600% (16). Read / Write.
   */
  declare zoom: number;

  /** The state of the Fast Previews menu. Read / Write. */
  declare fast_preview: FastPreviewType;

  declare _fips: FipsChunk;
  declare _item: AVItem | null;

  constructor(kw: { _fips: FipsChunk; _item?: AVItem | null }) {
    const { _fips, _item = null } = kw;
    this._fips = _fips;
    this._item = _item;
  }
}

descriptor(ViewOptions, "channels", ChunkField.enum<ChannelType>(ChannelType, "_fips", "channels"));

descriptor(ViewOptions, "checkerboards", ChunkField.bool("_fips", "checkerboards"));

descriptor(ViewOptions, "draft3d", ChunkField.bool("_fips", "draft3d"));

descriptor(
  ViewOptions,
  "exposure",
  new ChunkField<number>("_fips", "exposure", {
    validate: _validate_number({ min: -40.0, max: 40.0 }),
  }),
);

descriptor(ViewOptions, "grid", ChunkField.bool("_fips", "grid"));

descriptor(ViewOptions, "guides_locked", ChunkField.bool("_fips", "guides_locked", { min_version: 16 }));

descriptor(ViewOptions, "guides_snap", ChunkField.bool("_fips", "guides_snap", { min_version: 16 }));

descriptor(
  ViewOptions,
  "guides_visibility",
  ChunkField.bool("_fips", "guides_visibility", { min_version: 16 }),
);

descriptor(ViewOptions, "mask_and_shape_path", ChunkField.bool("_fips", "mask_and_shape_path"));

descriptor(ViewOptions, "proportional_grid", ChunkField.bool("_fips", "proportional_grid"));

descriptor(ViewOptions, "region_of_interest", ChunkField.bool("_fips", "region_of_interest"));

descriptor(
  ViewOptions,
  "roi_top",
  new ChunkField<number>("_fips", "roi_top", {
    validate: _validate_number({
      min: 0,
      max: (self: any) => self.roi_bottom - 1,
      integer: true,
    }),
  }),
);

descriptor(
  ViewOptions,
  "roi_left",
  new ChunkField<number>("_fips", "roi_left", {
    validate: _validate_number({
      min: 0,
      max: (self: any) => self.roi_right - 1,
      integer: true,
    }),
  }),
);

descriptor(
  ViewOptions,
  "roi_bottom",
  new ChunkField<number>("_fips", "roi_bottom", {
    validate: _validate_number({
      min: (self: any) => self.roi_top + 1,
      max: (self: any) => (self._item ? self._item.height : null),
      integer: true,
    }),
  }),
);

descriptor(
  ViewOptions,
  "roi_right",
  new ChunkField<number>("_fips", "roi_right", {
    validate: _validate_number({
      min: (self: any) => self.roi_left + 1,
      max: (self: any) => (self._item ? self._item.width : null),
      integer: true,
    }),
  }),
);

descriptor(ViewOptions, "rulers", ChunkField.bool("_fips", "rulers", { min_version: 16 }));

descriptor(ViewOptions, "title_action_safe", ChunkField.bool("_fips", "title_action_safe"));

descriptor(
  ViewOptions,
  "use_display_color_management",
  ChunkField.bool("_fips", "use_display_color_management"),
);

descriptor(
  ViewOptions,
  "zoom",
  new ChunkField<number>("_fips", "zoom", {
    validate: _validate_number({ min: 0.01, max: 16.0 }),
  }),
);

descriptor(
  ViewOptions,
  "fast_preview",
  ChunkField.enum<FastPreviewType>(FastPreviewType, "_fips", "fast_preview_type", { min_version: 12 }),
);
