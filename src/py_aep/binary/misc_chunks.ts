/**
 * Miscellaneous chunk types: prin, mkif, shph, NmHd, fips, pard, fth5, dwga.
 *
 * Fixed-layout chunks use `fmt_field()` and `BitField`.
 * Fth5Chunk uses `items_field()` for repeating feather points.
 * PardChunk and PrdaChunk use variant subclass dispatch for polymorphic layouts.
 */

import { uuid4_bytes } from "../../pyrt/uuid.ts";
import { define, field, b, bytes_, decode, encode, getattr, len, py_assert, round, descriptor, TypeError_, ValueError } from "../../pyrt/index.ts";
import type { IO } from "../../pyrt/index.ts";
import { read_bytes } from "./bin_utils.ts";
import { BitField } from "./bitfield.ts";
import { Chunk } from "./chunk.ts";
import { FmtItem, ascii_field, bool_field, bytes_field, f4_field, f8_field, items_field, s2_field, s4_field, u1_field, u2_field, u4_field } from "./fmt_field.ts";
import { register } from "./registry.ts";

// ---------------------------------------------------------------------------
// prin - composition renderer info (104 bytes)
// ---------------------------------------------------------------------------

/**
 * Composition renderer plug-in info (104 bytes).
 *
 * Contains the match name and display name of the active 3D renderer.
 */
export class PrinChunk extends Chunk {
  declare chunk_type: string;
  declare _reserved_00: Uint8Array;
  /** Internal match name (e.g. 'ADBE Advanced 3d'). */
  declare match_name: string;
  /** Human-readable name (e.g. 'Classic 3D'). */
  declare display_name: string;
  declare _reserved_68: Uint8Array;
  declare _end_marker: Uint8Array;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const {
      chunk_type = "prin",
      reserved_00 = new Uint8Array(4),
      match_name = "ADBE Escher",
      display_name = "Classic 3D",
      reserved_68 = new Uint8Array(3),
      end_marker = b("\x01"),
    } = kw;
    this.chunk_type = chunk_type;
    this._reserved_00 = reserved_00;
    this.match_name = match_name;
    this.display_name = display_name;
    this._reserved_68 = reserved_68;
    this._end_marker = end_marker;
  }
}
define(PrinChunk, {
  chunk_type: field({ default: "prin" }),
  _reserved_00: bytes_field(4, { repr: false }),
  match_name: ascii_field(48, { default: "ADBE Escher" }),
  display_name: ascii_field(48, { default: "Classic 3D" }),
  _reserved_68: bytes_field(3, { repr: false }),
  _end_marker: bytes_field(1, { default: b("\x01"), repr: false }),
}, { init: false });
register("prin")(PrinChunk);

// ---------------------------------------------------------------------------
// sfdt - subfolder data (4 bytes)
// ---------------------------------------------------------------------------

/** Subfolder data chunk. */
export class SfdtChunk extends Chunk {
  declare chunk_type: string;
  declare value: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "sfdt", value = 1 } = kw;
    this.chunk_type = chunk_type;
    this.value = value;
  }
}
define(SfdtChunk, {
  chunk_type: field({ default: "sfdt" }),
  value: u4_field({ default: 1 }),
}, { init: false });
register("sfdt")(SfdtChunk);

// ---------------------------------------------------------------------------
// pgui - 16-byte GUID
// ---------------------------------------------------------------------------

/** 16-byte GUID chunk. */
export class PguiChunk extends Chunk {
  declare chunk_type: string;
  declare guid: Uint8Array;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "pgui", guid = new Uint8Array(16) } = kw;
    this.chunk_type = chunk_type;
    this.guid = guid;
  }

  /** Build a pgui with a fresh random GUID. */
  static new_(): PguiChunk {
    // uuid4().bytes: random bits with the version nibble and RFC 4122 variant set.
    return new this({ guid: uuid4_bytes() });
  }
}
define(PguiChunk, {
  chunk_type: field({ default: "pgui" }),
  guid: bytes_field(16),
}, { init: false });
register("pgui")(PguiChunk);

// ---------------------------------------------------------------------------
// prda - renderer additional data (variant dispatch)
// ---------------------------------------------------------------------------

/**
 * Renderer additional data (polymorphic).
 *
 * The layout is renderer-specific, so the base class dispatches on the
 * sibling `prin` chunk's match name (resolved by the chunk reader), with
 * the body size as a sanity check. Unknown renderers and unexpected
 * sizes fall back to raw bytes and still round-trip byte-exact.
 *
 * These options are not exposed by ExtendScript.
 */
export class PrdaChunk extends Chunk {
  declare chunk_type: string;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "prda" } = kw;
    this.chunk_type = chunk_type;
  }

  static read(
    fp: IO,
    size: number,
    kw: { chunk_type?: string; renderer_match_name?: string } & Record<string, any> = {},
  ): PrdaChunk {
    const { chunk_type = "", renderer_match_name = "" } = kw;
    if (this !== PrdaChunk) {
      const result = super.read(fp, size, { chunk_type }) as PrdaChunk;
      py_assert(result instanceof PrdaChunk);
      return result;
    }
    const variant = _PRDA_VARIANTS.get(renderer_match_name);
    if (variant == null || variant[1] !== size) {
      // preserve unknown raw bytes
      return new this({ chunk_type, data: read_bytes(fp, size) });
    }
    return variant[0].read(fp, size, { chunk_type }) as PrdaChunk;
  }
}
define(PrdaChunk, {
  chunk_type: field({ default: "prda" }),
}, { init: false });
register("prda")(PrdaChunk);

/** Classic 3D (`ADBE Escher`) options, 12 bytes. */
export class ClassicPrdaChunk extends PrdaChunk {
  declare _version: number;
  // Offset 4 seems likely to be unique per-renderer, but this is not fully proven.
  // Both Classic and RayTraced share the same values (version=1, tag=0), so this
  // works for now as RayTraced is deprecated. If a future renderer shares the same
  // tag value as another existing renderer, we should rename this to `_unknown_04`.
  declare _renderer_tag: number;
  declare shadow_map_resolution: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { version = 1, renderer_tag = 0, shadow_map_resolution = 0 } = kw;
    this._version = version;
    this._renderer_tag = renderer_tag;
    this.shadow_map_resolution = shadow_map_resolution;
  }
  /** Index into the Shadow Map Resolution dropdown, 0='Comp Size',
   * 1=250, 2=500, 3=750, 4=1000, 5=1500, 6=2000, 7=3000, 8=4000. */
}
define(ClassicPrdaChunk, {
  _version: u4_field({ default: 1, repr: false }),
  _renderer_tag: u4_field({ default: 0, repr: false }),
  shadow_map_resolution: u4_field({ default: 0 }),
}, { init: false });

/**
 * Advanced 3D (`ADBE Calder`) options, 52 bytes.
 *
 * The body is genuinely mixed-endian: the header through `quality` is
 * big-endian like the rest of the format, while everything from offset
 * 20 on is little-endian. That is AE's own layout, not a bug here.
 *
 * The three `casting_box_size_*` fields are written in lockstep by a
 * single dialog control. All six float fields store fractions of the
 * composition's **raw pixel** dimensions - pixel aspect ratio is not
 * applied - rather than the pixel values the dialog displays.
 */
export class AdvancedPrdaChunk extends PrdaChunk {
  declare _version: number;
  declare _renderer_tag: number;
  /** Renderer quality, 1-125. */
  declare quality: number;
  declare _reserved_12: number;
  declare _reserved_16: number;
  /** Environment light shadow resolution:
   * 0='Half (2MB)', 1='Full (16MB)', 2='Double (128MB)'. */
  declare resolution: number;
  /** Environment light shadow smoothness, 1-20. */
  declare smoothness: number;
  /** Casting box size on X, as a fraction of comp width. */
  declare casting_box_size_x: number;
  /** Casting box size on Y, as a fraction of comp width. */
  declare casting_box_size_y: number;
  /** Casting box size on Z, as a fraction of comp width. */
  declare casting_box_size_z: number;
  /** Casting box centre on X, offset from comp centre, fraction of width. */
  declare casting_box_center_x: number;
  /** Casting box centre on Y, offset from comp centre, fraction of height. */
  declare casting_box_center_y: number;
  /** Casting box centre on Z, as a fraction of comp width. */
  declare casting_box_center_z: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const {
      version = 1,
      renderer_tag = 3,
      quality = 8,
      reserved_12 = 1,
      reserved_16 = 0,
      resolution = 1,
      smoothness = 3,
      casting_box_size_x = 1.0,
      casting_box_size_y = 1.0,
      casting_box_size_z = 1.0,
      casting_box_center_x = 0.0,
      casting_box_center_y = 0.0,
      casting_box_center_z = 0.0,
    } = kw;
    this._version = version;
    this._renderer_tag = renderer_tag;
    this.quality = quality;
    this._reserved_12 = reserved_12;
    this._reserved_16 = reserved_16;
    this.resolution = resolution;
    this.smoothness = smoothness;
    this.casting_box_size_x = casting_box_size_x;
    this.casting_box_size_y = casting_box_size_y;
    this.casting_box_size_z = casting_box_size_z;
    this.casting_box_center_x = casting_box_center_x;
    this.casting_box_center_y = casting_box_center_y;
    this.casting_box_center_z = casting_box_center_z;
  }
}
define(AdvancedPrdaChunk, {
  _version: u4_field({ default: 1, repr: false }),
  _renderer_tag: u4_field({ default: 3, repr: false }),
  quality: u4_field({ default: 8 }),
  _reserved_12: u4_field({ default: 1, repr: false }),
  _reserved_16: u4_field({ default: 0, repr: false }),
  resolution: u4_field({ default: 1, endian: "<" }),
  smoothness: u4_field({ default: 3, endian: "<" }),
  casting_box_size_x: f4_field({ default: 1.0, endian: "<" }),
  casting_box_size_y: f4_field({ default: 1.0, endian: "<" }),
  casting_box_size_z: f4_field({ default: 1.0, endian: "<" }),
  casting_box_center_x: f4_field({ default: 0.0, endian: "<" }),
  casting_box_center_y: f4_field({ default: 0.0, endian: "<" }),
  casting_box_center_z: f4_field({ default: 0.0, endian: "<" }),
}, { init: false });

/** Cinema 4D (`ADBE Ernst`) options, 20 bytes. */
export class Cinema4DPrdaChunk extends PrdaChunk {
  declare _version: number;
  declare _renderer_tag: number;
  /** Renderer quality, 1-99. */
  declare quality: number;
  declare _reserved_12: number;
  declare _reserved_16: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { version = 1, renderer_tag = 1, quality = 25, reserved_12 = 1, reserved_16 = 0 } = kw;
    this._version = version;
    this._renderer_tag = renderer_tag;
    this.quality = quality;
    this._reserved_12 = reserved_12;
    this._reserved_16 = reserved_16;
  }
}
define(Cinema4DPrdaChunk, {
  _version: u4_field({ default: 1, repr: false }),
  _renderer_tag: u4_field({ default: 1, repr: false }),
  quality: u4_field({ default: 25 }),
  _reserved_12: u4_field({ default: 1, repr: false }),
  _reserved_16: u4_field({ default: 0, repr: false }),
}, { init: false });

/**
 * Ray-traced 3D (`ADBE Picasso`) options, 16 bytes.
 *
 * Legacy: this renderer has been removed since AE 17.0.
 * Read-only in practice: files containing it can be parsed
 * and rewritten, but no supported AE version can author one.
 */
export class RayTracedPrdaChunk extends PrdaChunk {
  declare _version: number;
  declare _renderer_tag: number;
  declare _unknown_08: number;
  declare _unknown_12: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { version = 1, renderer_tag = 0, unknown_08 = 3, unknown_12 = 1 } = kw;
    this._version = version;
    this._renderer_tag = renderer_tag;
    this._unknown_08 = unknown_08;
    this._unknown_12 = unknown_12;
  }
}
define(RayTracedPrdaChunk, {
  _version: u4_field({ default: 1, repr: false }),
  _renderer_tag: u4_field({ default: 0, repr: false }),
  _unknown_08: u4_field({ default: 3, repr: false }),
  _unknown_12: u4_field({ default: 1, repr: false }),
}, { init: false });

// Body size -> variant. Sizes are distinct per renderer, so size alone
// discriminates without needing the sibling `prin` chunk's match name.
export const _PRDA_VARIANTS = new Map<string, [typeof PrdaChunk, number]>([
  ["ADBE Escher", [ClassicPrdaChunk, 12]],
  ["ADBE Picasso", [RayTracedPrdaChunk, 16]],
  ["ADBE Ernst", [Cinema4DPrdaChunk, 20]],
  ["ADBE Calder", [AdvancedPrdaChunk, 52]],
]);

// ---------------------------------------------------------------------------
// mkif - mask info (48 bytes)
// ---------------------------------------------------------------------------

/**
 * Mask info chunk (48 bytes).
 *
 * Contains mask flags, mode, and color.
 */
export class MkifChunk extends Chunk {
  declare chunk_type: string;
  /** 1 = inverted, 0 = normal. */
  declare inverted: boolean;
  /** 1 = locked, 0 = unlocked. */
  declare locked: boolean;
  /** 0 = Same as Layer, 1 = Off, 2 = On. */
  declare mask_motion_blur: number;
  /** 0 = Smooth, 1 = Linear. */
  declare mask_feather_falloff: number;
  declare _reserved_04: Uint8Array;
  /** SDK `PF_MaskMode`: 0=None, 1=Add, 2=Subtract, 3=Intersect,
   * 4=Lighten, 5=Darken, 6=Difference. */
  declare mode: number;
  /** 1-based id assigned at mask creation (creation order within the
   * layer). */
  declare mask_id: number;
  declare _reserved_0c: Uint8Array;
  declare color_r: number;
  declare color_g: number;
  declare color_b: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const {
      chunk_type = "mkif",
      inverted = false,
      locked = false,
      mask_motion_blur = 0,
      mask_feather_falloff = 0,
      reserved_04 = new Uint8Array(2),
      mode = 0,
      mask_id = 0,
      reserved_0c = new Uint8Array(33),
      color_r = 0,
      color_g = 0,
      color_b = 0,
    } = kw;
    this.chunk_type = chunk_type;
    this.inverted = inverted;
    this.locked = locked;
    this.mask_motion_blur = mask_motion_blur;
    this.mask_feather_falloff = mask_feather_falloff;
    this._reserved_04 = reserved_04;
    this.mode = mode;
    this.mask_id = mask_id;
    this._reserved_0c = reserved_0c;
    this.color_r = color_r;
    this.color_g = color_g;
    this.color_b = color_b;
  }

  /** Mask color as [R, G, B] in 0.0-1.0 range. */
  get color(): number[] {
    return [this.color_r / 255, this.color_g / 255, this.color_b / 255];
  }

  set color(value: number[]) {
    this.color_r = round(value[0] * 255);
    this.color_g = round(value[1] * 255);
    this.color_b = round(value[2] * 255);
  }
}
define(MkifChunk, {
  chunk_type: field({ default: "mkif" }),
  inverted: bool_field(),
  locked: bool_field(),
  mask_motion_blur: u1_field(),
  mask_feather_falloff: u1_field(),
  _reserved_04: bytes_field(2, { repr: false }),
  mode: u2_field(),
  mask_id: u4_field(),
  _reserved_0c: bytes_field(33, { repr: false }),
  color_r: u1_field(),
  color_g: u1_field(),
  color_b: u1_field(),
}, { init: false });
register("mkif")(MkifChunk);

// ---------------------------------------------------------------------------
// shph - shape path header (24 bytes)
// ---------------------------------------------------------------------------

/**
 * Shape path header chunk (24 bytes).
 *
 * Contains closed/open flag and bounding box for shape vertices.
 * Vertex coordinates in the associated ldat are normalized to
 * [0, 1] relative to this bounding box.
 */
export class ShphChunk extends Chunk {
  declare chunk_type: string;
  declare _reserved_00: Uint8Array;
  /** Byte 3 bit flags: bit 0 = `normalized`, bit 3 = `open`. Defaults to
   * `1` (normalized, closed). */
  declare _flags: number;
  /** Bounding-box left edge (x minimum). */
  declare top_left_x: number;
  /** Bounding-box top edge (y minimum). */
  declare top_left_y: number;
  /** Bounding-box right edge (x maximum). */
  declare bottom_right_x: number;
  /** Bounding-box bottom edge (y maximum). */
  declare bottom_right_y: number;
  declare _reserved_14: Uint8Array;
  /** True when the ldat points are stored as `[0, 1]` fractions of the
   * bounding box (AE's universal encoding). */
  declare normalized: boolean;
  /** True when the path is open (not closed). */
  declare open: boolean;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const {
      chunk_type = "shph",
      reserved_00 = b("\xb3\xde\x02"),
      flags = 1,
      top_left_x = 0,
      top_left_y = 0,
      bottom_right_x = 0,
      bottom_right_y = 0,
      reserved_14 = b("\x01\x00\x00\x00"),
    } = kw;
    this.chunk_type = chunk_type;
    this._reserved_00 = reserved_00;
    this._flags = flags;
    this.top_left_x = top_left_x;
    this.top_left_y = top_left_y;
    this.bottom_right_x = bottom_right_x;
    this.bottom_right_y = bottom_right_y;
    this._reserved_14 = reserved_14;
  }
}
define(ShphChunk, {
  chunk_type: field({ default: "shph" }),
  _reserved_00: bytes_field(3, { default: b("\xb3\xde\x02"), repr: false }),
  _flags: u1_field({ default: 1, repr: false }),
  top_left_x: f4_field(),
  top_left_y: f4_field(),
  bottom_right_x: f4_field(),
  bottom_right_y: f4_field(),
  _reserved_14: bytes_field(4, { default: b("\x01\x00\x00\x00"), repr: false }),
}, { init: false });
descriptor(ShphChunk, "normalized", new BitField("_flags", 0));
descriptor(ShphChunk, "open", new BitField("_flags", 3));
register("shph")(ShphChunk);

// ---------------------------------------------------------------------------
// NmHd - marker data (17 bytes)
// ---------------------------------------------------------------------------

/**
 * Marker data chunk (20 bytes).
 *
 * Contains marker flags, duration, and label color.
 */
export class NmhdChunk extends Chunk {
  declare chunk_type: string;
  declare _reserved_00: Uint8Array;
  /** Byte 3: bit 2=unknown, bit 1=protected_region, bit 0=navigation. */
  declare _marker_flags: number;
  /** Number of cue-point parameter key/value pairs.
   *
   * Must match the number of trailing Utf8 pairs in the Nmrd list or
   * AE ignores the parameters entirely. */
  declare num_params: number;
  /** Duration dividend: seconds = `duration_value / duration_scale`. */
  declare duration_value: number;
  /** Duration divisor. 600 on every marker a script creates or whose
   * duration a script sets (AE 2026, any composition frame rate); markers
   * edited in the UI also store 24, 25 or 24576. AE 2026 reads 0 as 600. */
  declare duration_scale: number;
  /** Label color index. */
  declare label: number;
  /** Bytes 17-19: trailing padding. */
  declare _reserved_11: Uint8Array;
  declare protected_region: boolean;
  declare navigation: boolean;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const {
      chunk_type = "NmHd",
      reserved_00 = new Uint8Array(3),
      marker_flags = 0,
      num_params = 0,
      duration_value = 0,
      duration_scale = 600,
      label = 0,
      reserved_11 = new Uint8Array(3),
    } = kw;
    this.chunk_type = chunk_type;
    this._reserved_00 = reserved_00;
    this._marker_flags = marker_flags;
    this.num_params = num_params;
    this.duration_value = duration_value;
    this.duration_scale = duration_scale;
    this.label = label;
    this._reserved_11 = reserved_11;
  }

  /** Duration in seconds. */
  get duration_seconds(): number {
    return this.duration_value / (this.duration_scale || 600);
  }

  set duration_seconds(value: number) {
    this.duration_value = round(value * 600);
    this.duration_scale = 600;
  }
}
define(NmhdChunk, {
  chunk_type: field({ default: "NmHd" }),
  _reserved_00: bytes_field(3, { repr: false }),
  _marker_flags: u1_field({ repr: false }),
  num_params: u4_field(),
  duration_value: u4_field(),
  duration_scale: u4_field({ default: 600 }),
  label: u1_field(),
  _reserved_11: bytes_field(3, { repr: false }),
}, { init: false });
// BitField descriptors
descriptor(NmhdChunk, "protected_region", new BitField("_marker_flags", 1));
descriptor(NmhdChunk, "navigation", new BitField("_marker_flags", 0));
register("NmHd")(NmhdChunk);

// ---------------------------------------------------------------------------
// fips - viewer panel settings (96 bytes)
// ---------------------------------------------------------------------------

/**
 * Viewer panel settings chunk (96 bytes).
 *
 * Contains zoom, exposure, ROI, channel display, and toggle flags
 * for guides, rulers, grid, etc. Bitfield flags are exposed via
 * `BitField` descriptors. The last 9 bytes (0x57-0x5F) are undecoded and
 * kept verbatim as trailing data: zeros except byte 0x59 (0x24 or 0x00 in
 * the samples).
 */
export class FipsChunk extends Chunk {
  declare chunk_type: string;
  declare _pad_00: Uint8Array;
  /** Channel display mode (0=RGB, 1=Red, 2=Green, 3=Blue, 4=Alpha, 8=RGB Straight). */
  declare channels: number;
  declare _pad_08: Uint8Array;
  /** Byte 11: bit 1=proportional_grid, bit 0=title_action_safe. */
  declare _grid_safe_flags: number;
  /** Byte 12: bit 2=draft3d. */
  declare _draft_flags: number;
  /** Byte 13: bit 4=draft, bit 2=fast_draft, bit 0=adaptive. */
  declare _preview_flags: number;
  /** Byte 14: bit 7=region_of_interest, bit 6=rulers, bit 4=wireframe. */
  declare _view_flags: number;
  /** Byte 15: bit 7=checkerboards, bit 4=mask_and_shape_path. */
  declare _display_flags: number;
  declare _pad_10: Uint8Array;
  /** Byte 23: bit 3=grid, bit 2=guides_snap, bit 1=guides_locked, bit 0=guides_visibility. */
  declare _guide_flags: number;
  declare _pad_18: Uint8Array;
  declare roi_top: number;
  declare roi_left: number;
  declare roi_bottom: number;
  declare roi_right: number;
  declare _pad_30: Uint8Array;
  /** Zoom mode (0=custom, 1=fit, 2=fit up to 100%). */
  declare zoom_type: number;
  declare _pad_46: Uint8Array;
  /** Zoom factor (1.0 = 100%). */
  declare zoom: number;
  /** Exposure value in stops (-40.0 to 40.0). */
  declare exposure: number;
  declare _pad_54: number;
  /** Byte 85: bit 0=use_display_color_management. */
  declare _color_mgmt_flags: number;
  /** Byte 86: bit 0=auto_resolution. */
  declare _resolution_flags: number;

  // -- BitField descriptors (not attrs fields) ---------------------------
  declare proportional_grid: boolean;
  declare title_action_safe: boolean;
  declare draft3d: boolean;
  declare fast_preview_draft: boolean;
  declare fast_preview_fast_draft: boolean;
  declare fast_preview_adaptive: boolean;
  declare region_of_interest: boolean;
  declare rulers: boolean;
  declare fast_preview_wireframe: boolean;
  declare checkerboards: boolean;
  declare mask_and_shape_path: boolean;
  declare grid: boolean;
  declare guides_snap: boolean;
  declare guides_locked: boolean;
  declare guides_visibility: boolean;
  declare use_display_color_management: boolean;
  declare auto_resolution: boolean;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const {
      chunk_type = "fips",
      pad_00 = new Uint8Array(7),
      channels = 0,
      pad_08 = new Uint8Array(3),
      grid_safe_flags = 0,
      draft_flags = 0,
      preview_flags = 0,
      view_flags = 0,
      display_flags = 0,
      pad_10 = new Uint8Array(7),
      guide_flags = 0,
      pad_18 = new Uint8Array(16),
      roi_top = 0,
      roi_left = 0,
      roi_bottom = 0,
      roi_right = 0,
      pad_30 = new Uint8Array(21),
      zoom_type = 0,
      pad_46 = new Uint8Array(2),
      zoom = 0,
      exposure = 0,
      pad_54 = 0,
      color_mgmt_flags = 1,
      resolution_flags = 0,
    } = kw;
    this.chunk_type = chunk_type;
    this._pad_00 = pad_00;
    this.channels = channels;
    this._pad_08 = pad_08;
    this._grid_safe_flags = grid_safe_flags;
    this._draft_flags = draft_flags;
    this._preview_flags = preview_flags;
    this._view_flags = view_flags;
    this._display_flags = display_flags;
    this._pad_10 = pad_10;
    this._guide_flags = guide_flags;
    this._pad_18 = pad_18;
    this.roi_top = roi_top;
    this.roi_left = roi_left;
    this.roi_bottom = roi_bottom;
    this.roi_right = roi_right;
    this._pad_30 = pad_30;
    this.zoom_type = zoom_type;
    this._pad_46 = pad_46;
    this.zoom = zoom;
    this.exposure = exposure;
    this._pad_54 = pad_54;
    this._color_mgmt_flags = color_mgmt_flags;
    this._resolution_flags = resolution_flags;
  }

  /** Computed fast preview type (0=off, 1=adaptive, 2=draft, 3=fast_draft, 4=wireframe). */
  get fast_preview_type(): number {
    if (this.fast_preview_wireframe) return 4;
    if (this.fast_preview_fast_draft) return 3;
    if (this.fast_preview_draft) return 2;
    if (this.fast_preview_adaptive) return 1;
    return 0;
  }

  set fast_preview_type(value: number) {
    this.fast_preview_adaptive = value === 1;
    this.fast_preview_draft = value === 2;
    this.fast_preview_fast_draft = value === 3;
    this.fast_preview_wireframe = value === 4;
  }
}
define(FipsChunk, {
  chunk_type: field({ default: "fips" }),
  _pad_00: bytes_field(7, { repr: false }),
  channels: u1_field(),
  _pad_08: bytes_field(3, { repr: false }),
  _grid_safe_flags: u1_field({ repr: false }),
  _draft_flags: u1_field({ repr: false }),
  _preview_flags: u1_field({ repr: false }),
  _view_flags: u1_field({ repr: false }),
  _display_flags: u1_field({ repr: false }),
  _pad_10: bytes_field(7, { repr: false }),
  _guide_flags: u1_field({ repr: false }),
  _pad_18: bytes_field(16, { repr: false }),
  roi_top: u2_field(),
  roi_left: u2_field(),
  roi_bottom: u2_field(),
  roi_right: u2_field(),
  _pad_30: bytes_field(21, { repr: false }),
  zoom_type: u1_field(),
  _pad_46: bytes_field(2, { repr: false }),
  zoom: f8_field(),
  exposure: f4_field(),
  _pad_54: u1_field({ repr: false }),
  _color_mgmt_flags: u1_field({ default: 1, repr: false }),
  _resolution_flags: u1_field({ repr: false }),
}, { init: false });
descriptor(FipsChunk, "proportional_grid", new BitField("_grid_safe_flags", 1));
descriptor(FipsChunk, "title_action_safe", new BitField("_grid_safe_flags", 0));
descriptor(FipsChunk, "draft3d", new BitField("_draft_flags", 2));
descriptor(FipsChunk, "fast_preview_draft", new BitField("_preview_flags", 4));
descriptor(FipsChunk, "fast_preview_fast_draft", new BitField("_preview_flags", 2));
descriptor(FipsChunk, "fast_preview_adaptive", new BitField("_preview_flags", 0));
descriptor(FipsChunk, "region_of_interest", new BitField("_view_flags", 7));
descriptor(FipsChunk, "rulers", new BitField("_view_flags", 6));
descriptor(FipsChunk, "fast_preview_wireframe", new BitField("_view_flags", 4));
descriptor(FipsChunk, "checkerboards", new BitField("_display_flags", 7));
descriptor(FipsChunk, "mask_and_shape_path", new BitField("_display_flags", 4));
descriptor(FipsChunk, "grid", new BitField("_guide_flags", 3));
descriptor(FipsChunk, "guides_snap", new BitField("_guide_flags", 2));
descriptor(FipsChunk, "guides_locked", new BitField("_guide_flags", 1));
descriptor(FipsChunk, "guides_visibility", new BitField("_guide_flags", 0));
descriptor(FipsChunk, "use_display_color_management", new BitField("_color_mgmt_flags", 0));
descriptor(FipsChunk, "auto_resolution", new BitField("_resolution_flags", 0));
register("fips")(FipsChunk);

// ---------------------------------------------------------------------------
// pard - effect property parameter definitions (variant dispatch)
// ---------------------------------------------------------------------------

// NOTE(port): Python lets a subclass attrs field replace the base property; attrs `define` assigns
// with `self[name] = v`, so a writable data property on each variant prototype (applied after
// `_PARD_VARIANTS`) gives the same behavior.
export function shadow_property(cls: Function, name: string): void {
  Object.defineProperty(cls.prototype, name, {
    configurable: true,
    enumerable: true,
    writable: true,
    value: undefined,
  });
}

/**
 * Effect property parameter definition (polymorphic).
 *
 * Serialized form of the AE SDK `PF_ParamDef`. Layout depends on
 * `property_control_type` (the SDK `PF_ParamType`) at byte 15; the base
 * class dispatches to variant subclasses and unknown control types fall
 * back to raw bytes.
 *
 * Common header (56 bytes): 4s pad, u4 ui_flags (`PF_ParamUIFlags`),
 * 7s pad, B property_control_type, 32s name (UTF-8),
 * u4 param_flags (`PF_ParamFlags`), 4s pad.
 */
export class PardChunk extends Chunk {
  declare chunk_type: string;
  declare _raw_name: Uint8Array;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "pard" } = kw;
    this.chunk_type = chunk_type;
  }

  /** Control type discriminator at byte 15 of the raw data. */
  get property_control_type(): number {
    const data = getattr(this, "data", b(""));
    if (len(data) > 15) return data[15];
    return 0;
  }

  static read(
    fp: IO,
    size: number,
    kw: { chunk_type?: string } & Record<string, any> = {},
  ): PardChunk {
    const { chunk_type = "" } = kw;
    if (this !== PardChunk) {
      const result = super.read(fp, size, { chunk_type }) as PardChunk;
      py_assert(result instanceof PardChunk);
      return result;
    }
    if (size < 56) return new this({ chunk_type, data: read_bytes(fp, size) });
    // Peek at discriminator (byte 15)
    const header = read_bytes(fp, 16);
    const control_type = header[15];
    fp.seek(-16, 1);
    const variant_cls = _PARD_VARIANTS.get(control_type) ?? PardChunk;
    if (variant_cls === PardChunk) return new this({ chunk_type, data: read_bytes(fp, size) });
    return variant_cls.read(fp, size, { chunk_type }) as PardChunk;
  }

  /**
   * Low byte of the AE SDK `PF_ParamFlags` (u4 at offsets 48-51).
   *
   * Bit 1 (0x02) is `PF_ParamFlag_CANNOT_TIME_VARY`, bit 6 (0x40) is
   * `PF_ParamFlag_SUPERVISE`. Validated against ExtendScript
   * `canVaryOverTime` ground truth across the sample corpus.
   */
  get param_flags(): number {
    const pad: Uint8Array = getattr(this, "_pad_post", b(""));
    if (pad.length > 3) return pad[3];
    const data = getattr(this, "data", b(""));
    if (len(data) > 51) return data[51];
    return 0;
  }

  /**
   * `PF_PUI_INVISIBLE` (bit 9 of the `PF_ParamUIFlags` u4 at
   * offsets 4-7): the parameter is hidden from the Effect Controls
   * and the Timeline, and expressions can never be set on it.
   *
   * Empirical: across the sample corpus, ExtendScript reports
   * `canSetExpression = false` for every parameter with this bit set.
   */
  get expressions_disabled(): boolean {
    const pre: Uint8Array = getattr(this, "_pad_pre", b(""));
    if (pre.length > 6) return (pre[6] & 0x02) !== 0;
    const data = getattr(this, "data", b(""));
    if (len(data) > 6) return (data[6] & 0x02) !== 0;
    return false;
  }

  /** Decoded parameter name (from `_raw_name` up to first NUL). */
  get name(): string {
    const raw: Uint8Array = getattr(this, "_raw_name", b(""));
    if (!raw.length) return "";
    const nul = bytes_.find(raw, 0x00);
    if (nul >= 0) return decode(bytes_.slice(raw, 0, nul), "utf-8", "surrogateescape");
    return decode(raw, "utf-8", "surrogateescape");
  }

  set name(value: string) {
    const encoded = bytes_.slice(encode(value, "utf-8", "surrogateescape"), 0, 31);
    this._raw_name = bytes_.concat(encoded, bytes_.repeat(b("\x00"), 32 - encoded.length));
  }
}
define(PardChunk, {
  chunk_type: field({ default: "pard" }),
}, { init: false });
register("pard")(PardChunk);

/**
 * Generic pard for control types without specialized body parsing.
 *
 * Covers SDK `PF_ParamType` values 0 (LAYER), 9 (NO_DATA),
 * 11 (ARBITRARY_DATA), 12 (PATH), 13 (GROUP_START), 14 (GROUP_END)
 * and 15 (BUTTON).
 * All are 148 bytes: 56-byte header + 92-byte body.
 */
export class GenericPardChunk extends PardChunk {
  declare _pad_pre: Uint8Array;
  declare _raw_name: Uint8Array;
  declare _pad_post: Uint8Array;
  declare _body: Uint8Array;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const {
      pad_pre = new Uint8Array(15),
      property_control_type = 0,
      raw_name = new Uint8Array(32),
      pad_post = new Uint8Array(8),
      body = new Uint8Array(92),
    } = kw;
    this._pad_pre = pad_pre;
    (this as any).property_control_type = property_control_type;
    this._raw_name = raw_name;
    this._pad_post = pad_post;
    this._body = body;
  }
}
define(GenericPardChunk, {
  _pad_pre: bytes_field(15, { repr: false }),
  property_control_type: u1_field(),
  _raw_name: bytes_field(32, { repr: false }),
  _pad_post: bytes_field(8, { repr: false }),
  _body: bytes_field(92, { repr: false }),
}, { init: false });

/** `bytes(list_of_ints)`: raises like CPython outside 0..255 instead of wrapping. */
export function _bytes_from_ints(value: number[]): Uint8Array {
  const out = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) {
    const v = value[i];
    if (typeof v !== "number" || !Number.isInteger(v)) throw new TypeError_(`'${typeof v}' object cannot be interpreted as an integer`);
    if (v < 0 || v > 255) throw new ValueError("bytes must be in range(0, 256)");
    out[i] = v;
  }
  return out;
}

/**
 * Color control (type 5, SDK `PF_ColorDef`): 4xB value and 4xB
 * default, both alpha, red, green, blue. The rest of the body is leftover
 * memory, not a field (zeros in most samples, pointer-like patterns and
 * match-name fragments in others), kept as trailing bytes.
 */
export class ColorPardChunk extends PardChunk {
  declare _pad_pre: Uint8Array;
  declare _raw_name: Uint8Array;
  declare _pad_post: Uint8Array;
  declare _last_color: Uint8Array;
  declare _default_color: Uint8Array;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const {
      pad_pre = new Uint8Array(15),
      property_control_type = 5,
      raw_name = new Uint8Array(32),
      pad_post = new Uint8Array(8),
      last_color = new Uint8Array(4),
      default_color = new Uint8Array(4),
    } = kw;
    this._pad_pre = pad_pre;
    (this as any).property_control_type = property_control_type;
    this._raw_name = raw_name;
    this._pad_post = pad_post;
    this._last_color = last_color;
    this._default_color = default_color;
  }

  get last_color(): number[] {
    return Array.from(this._last_color);
  }

  set last_color(value: number[]) {
    this._last_color = _bytes_from_ints(value);
  }

  get default_color(): number[] {
    return Array.from(this._default_color);
  }

  set default_color(value: number[]) {
    this._default_color = _bytes_from_ints(value);
  }
}
define(ColorPardChunk, {
  _pad_pre: bytes_field(15, { repr: false }),
  property_control_type: u1_field({ default: 5 }),
  _raw_name: bytes_field(32, { repr: false }),
  _pad_post: bytes_field(8, { repr: false }),
  _last_color: bytes_field(4, { repr: false }),
  _default_color: bytes_field(4, { repr: false }),
}, { init: false });

/**
 * Integer slider (type 1, SDK `PF_Param_SLIDER` / `PF_SliderDef`).
 *
 * Body: s4 value, 32s value_str, 32s value_desc, s4 valid_min,
 * s4 valid_max, s4 slider_min, s4 slider_max, s4 default. The valid
 * range is what ExtendScript reports as `minValue`/`maxValue`;
 * `default` is the parameter's factory default value.
 */
export class IntegerPardChunk extends PardChunk {
  declare _pad_pre: Uint8Array;
  declare _raw_name: Uint8Array;
  declare _pad_post: Uint8Array;
  declare last_value: number;
  declare _value_str: Uint8Array;
  declare _value_desc: Uint8Array;
  declare valid_min: number;
  declare valid_max: number;
  declare slider_min: number | null;
  declare slider_max: number | null;
  declare default_: number | null;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const {
      pad_pre = new Uint8Array(15),
      property_control_type = 1,
      raw_name = new Uint8Array(32),
      pad_post = new Uint8Array(8),
      last_value = 0,
      value_str = new Uint8Array(32),
      value_desc = new Uint8Array(32),
      valid_min = 0,
      valid_max = 0,
      slider_min = null,
      slider_max = null,
      default_ = null,
    } = kw;
    this._pad_pre = pad_pre;
    (this as any).property_control_type = property_control_type;
    this._raw_name = raw_name;
    this._pad_post = pad_post;
    this.last_value = last_value;
    this._value_str = value_str;
    this._value_desc = value_desc;
    this.valid_min = valid_min;
    this.valid_max = valid_max;
    this.slider_min = slider_min;
    this.slider_max = slider_max;
    this.default_ = default_;
  }
}
define(IntegerPardChunk, {
  _pad_pre: bytes_field(15, { repr: false }),
  property_control_type: u1_field({ default: 1 }),
  _raw_name: bytes_field(32, { repr: false }),
  _pad_post: bytes_field(8, { repr: false }),
  last_value: s4_field(),
  _value_str: bytes_field(32, { repr: false }),
  _value_desc: bytes_field(32, { repr: false }),
  valid_min: s4_field(),
  valid_max: s4_field(),
  slider_min: s4_field({ optional: true, default: null }),
  slider_max: s4_field({ optional: true, default: null }),
  default_: s4_field({ optional: true, default: null }),
}, { init: false });

/**
 * Fixed-point slider (type 2, SDK `PF_Param_FIX_SLIDER` /
 * `PF_FixedSliderDef`).
 *
 * Body: `PF_Fixed` (16.16 fixed point, `raw / 65536`) value, 32s
 * value_str, 32s value_desc, then PF_Fixed valid_min / valid_max
 * (what ExtendScript reports as `minValue`/`maxValue`), PF_Fixed
 * slider_min / slider_max (the UI slider range) and PF_Fixed
 * default (the parameter's factory default value).
 */
export class ScalarPardChunk extends PardChunk {
  declare _pad_pre: Uint8Array;
  declare _raw_name: Uint8Array;
  declare _pad_post: Uint8Array;
  declare last_value_raw: number;
  declare _value_str: Uint8Array;
  declare _value_desc: Uint8Array;
  declare valid_min_raw: number;
  declare valid_max_raw: number;
  declare slider_min_raw: number;
  declare slider_max_raw: number;
  declare default_raw: number | null;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const {
      pad_pre = new Uint8Array(15),
      property_control_type = 2,
      raw_name = new Uint8Array(32),
      pad_post = new Uint8Array(8),
      last_value_raw = 0,
      value_str = new Uint8Array(32),
      value_desc = new Uint8Array(32),
      valid_min_raw = 0,
      valid_max_raw = 0,
      slider_min_raw = 0,
      slider_max_raw = 0,
      default_raw = null,
    } = kw;
    this._pad_pre = pad_pre;
    (this as any).property_control_type = property_control_type;
    this._raw_name = raw_name;
    this._pad_post = pad_post;
    this.last_value_raw = last_value_raw;
    this._value_str = value_str;
    this._value_desc = value_desc;
    this.valid_min_raw = valid_min_raw;
    this.valid_max_raw = valid_max_raw;
    this.slider_min_raw = slider_min_raw;
    this.slider_max_raw = slider_max_raw;
    this.default_raw = default_raw;
  }

  get last_value(): number {
    return this.last_value_raw / 65536;
  }

  get valid_min(): number {
    return this.valid_min_raw / 65536;
  }

  get valid_max(): number {
    return this.valid_max_raw / 65536;
  }

  get slider_min(): number {
    return this.slider_min_raw / 65536;
  }

  get slider_max(): number {
    return this.slider_max_raw / 65536;
  }

  get default_(): number | null {
    return this.default_raw == null ? null : this.default_raw / 65536;
  }
}
define(ScalarPardChunk, {
  _pad_pre: bytes_field(15, { repr: false }),
  property_control_type: u1_field({ default: 2 }),
  _raw_name: bytes_field(32, { repr: false }),
  _pad_post: bytes_field(8, { repr: false }),
  last_value_raw: s4_field(),
  _value_str: bytes_field(32, { repr: false }),
  _value_desc: bytes_field(32, { repr: false }),
  valid_min_raw: s4_field(),
  valid_max_raw: s4_field(),
  slider_min_raw: s4_field(),
  slider_max_raw: s4_field(),
  default_raw: s4_field({ optional: true, default: null }),
}, { init: false });

/**
 * Angle control (type 3, SDK `PF_AngleDef`).
 *
 * Body: `PF_Fixed` (16.16 fixed point, `raw / 65536`) value, then
 * PF_Fixed default (the parameter's factory default value).
 */
export class AnglePardChunk extends PardChunk {
  declare _pad_pre: Uint8Array;
  declare _raw_name: Uint8Array;
  declare _pad_post: Uint8Array;
  declare last_value_raw: number;
  declare default_raw: number | null;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const {
      pad_pre = new Uint8Array(15),
      property_control_type = 3,
      raw_name = new Uint8Array(32),
      pad_post = new Uint8Array(8),
      last_value_raw = 0,
      default_raw = null,
    } = kw;
    this._pad_pre = pad_pre;
    (this as any).property_control_type = property_control_type;
    this._raw_name = raw_name;
    this._pad_post = pad_post;
    this.last_value_raw = last_value_raw;
    this.default_raw = default_raw;
  }

  get last_value(): number {
    return this.last_value_raw / 65536;
  }

  get default_(): number | null {
    return this.default_raw == null ? null : this.default_raw / 65536;
  }
}
define(AnglePardChunk, {
  _pad_pre: bytes_field(15, { repr: false }),
  property_control_type: u1_field({ default: 3 }),
  _raw_name: bytes_field(32, { repr: false }),
  _pad_post: bytes_field(8, { repr: false }),
  last_value_raw: s4_field(),
  default_raw: s4_field({ optional: true, default: null }),
}, { init: false });

/** Boolean control (type 4): u4 last_value, u1 default. */
export class BooleanPardChunk extends PardChunk {
  declare _pad_pre: Uint8Array;
  declare _raw_name: Uint8Array;
  declare _pad_post: Uint8Array;
  declare last_value: number;
  declare default_: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const {
      pad_pre = new Uint8Array(15),
      property_control_type = 4,
      raw_name = new Uint8Array(32),
      pad_post = new Uint8Array(8),
      last_value = 0,
      default_ = 0,
    } = kw;
    this._pad_pre = pad_pre;
    (this as any).property_control_type = property_control_type;
    this._raw_name = raw_name;
    this._pad_post = pad_post;
    this.last_value = last_value;
    this.default_ = default_;
  }
}
define(BooleanPardChunk, {
  _pad_pre: bytes_field(15, { repr: false }),
  property_control_type: u1_field({ default: 4 }),
  _raw_name: bytes_field(32, { repr: false }),
  _pad_post: bytes_field(8, { repr: false }),
  last_value: u4_field(),
  default_: u1_field(),
}, { init: false });

/**
 * 2D point control (type 6, SDK `PF_PointDef`).
 *
 * Body: `PF_Fixed` (16.16) value x / y, 3 reserved bytes,
 * `restrict_bounds`, then `PF_Fixed` default x / y in percent of the
 * layer size. The cached value comes in two forms: a fraction of the
 * layer size (0.5 = centre), or equal to the percent default.
 */
export class TwoDPardChunk extends PardChunk {
  declare _pad_pre: Uint8Array;
  declare _raw_name: Uint8Array;
  declare _pad_post: Uint8Array;
  declare last_value_x_raw: number;
  declare last_value_y_raw: number;
  declare _reserved_40: Uint8Array;
  declare restrict_bounds: number;
  declare default_x_raw: number;
  declare default_y_raw: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const {
      pad_pre = new Uint8Array(15),
      property_control_type = 6,
      raw_name = new Uint8Array(32),
      pad_post = new Uint8Array(8),
      last_value_x_raw = 0,
      last_value_y_raw = 0,
      reserved_40 = new Uint8Array(3),
      restrict_bounds = 0,
      default_x_raw = 0,
      default_y_raw = 0,
    } = kw;
    this._pad_pre = pad_pre;
    (this as any).property_control_type = property_control_type;
    this._raw_name = raw_name;
    this._pad_post = pad_post;
    this.last_value_x_raw = last_value_x_raw;
    this.last_value_y_raw = last_value_y_raw;
    this._reserved_40 = reserved_40;
    this.restrict_bounds = restrict_bounds;
    this.default_x_raw = default_x_raw;
    this.default_y_raw = default_y_raw;
  }

  get last_value_x(): number {
    return this.last_value_x_raw * (1.0 / 128);
  }

  get last_value_y(): number {
    return this.last_value_y_raw * (1.0 / 128);
  }

  /** Default x / y, in percent of the layer width / height. */
  get default_(): number[] {
    return [this.default_x_raw / 65536, this.default_y_raw / 65536];
  }
}
define(TwoDPardChunk, {
  _pad_pre: bytes_field(15, { repr: false }),
  property_control_type: u1_field({ default: 6 }),
  _raw_name: bytes_field(32, { repr: false }),
  _pad_post: bytes_field(8, { repr: false }),
  last_value_x_raw: s4_field(),
  last_value_y_raw: s4_field(),
  _reserved_40: bytes_field(3, { repr: false }),
  restrict_bounds: u1_field(),
  default_x_raw: s4_field(),
  default_y_raw: s4_field(),
}, { init: false });

/**
 * Popup control (type 7, SDK `PF_PopupDef`): s4 value, s2 number of
 * choices, s2 default (1-based). The choice-names pointer that follows
 * in the SDK record is leftover memory, kept as trailing bytes.
 */
export class EnumPardChunk extends PardChunk {
  declare _pad_pre: Uint8Array;
  declare _raw_name: Uint8Array;
  declare _pad_post: Uint8Array;
  declare last_value: number;
  declare nb_options: number;
  declare default_: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const {
      pad_pre = new Uint8Array(15),
      property_control_type = 7,
      raw_name = new Uint8Array(32),
      pad_post = new Uint8Array(8),
      last_value = 0,
      nb_options = 0,
      default_ = 0,
    } = kw;
    this._pad_pre = pad_pre;
    (this as any).property_control_type = property_control_type;
    this._raw_name = raw_name;
    this._pad_post = pad_post;
    this.last_value = last_value;
    this.nb_options = nb_options;
    this.default_ = default_;
  }
}
define(EnumPardChunk, {
  _pad_pre: bytes_field(15, { repr: false }),
  property_control_type: u1_field({ default: 7 }),
  _raw_name: bytes_field(32, { repr: false }),
  _pad_post: bytes_field(8, { repr: false }),
  last_value: u4_field(),
  nb_options: s2_field(),
  default_: s2_field(),
}, { init: false });

/**
 * Float slider (type 10, SDK `PF_Param_FLOAT_SLIDER` /
 * `PF_FloatSliderDef`).
 *
 * Body: f8 value, f8 phase, 32s value_desc, then f4 valid_min /
 * valid_max (what ExtendScript reports as `minValue`/`maxValue`;
 * non-finite means that side is unbounded), f4 slider_min /
 * slider_max (the UI slider range) and f4 default (the parameter's
 * factory default value).
 */
export class SliderPardChunk extends PardChunk {
  declare _pad_pre: Uint8Array;
  declare _raw_name: Uint8Array;
  declare _pad_post: Uint8Array;
  declare last_value: number;
  declare phase: number;
  declare _value_desc: Uint8Array;
  declare valid_min: number;
  declare valid_max: number;
  declare slider_min: number;
  declare slider_max: number;
  declare default_: number | null;
  declare _precision: number | null;
  /** SDK `PF_ValueDisplayFlags`: bit 0 (PERCENT) is the only flag AE
   * writes reliably for float sliders (fixed-point sliders leave it 0). */
  declare display_flags: number | null;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const {
      pad_pre = new Uint8Array(15),
      property_control_type = 10,
      raw_name = new Uint8Array(32),
      pad_post = new Uint8Array(8),
      last_value = 0,
      phase = 0,
      value_desc = new Uint8Array(32),
      valid_min = 0,
      valid_max = 0,
      slider_min = 0,
      slider_max = 0,
      default_ = null,
      precision = null,
      display_flags = null,
    } = kw;
    this._pad_pre = pad_pre;
    (this as any).property_control_type = property_control_type;
    this._raw_name = raw_name;
    this._pad_post = pad_post;
    this.last_value = last_value;
    this.phase = phase;
    this._value_desc = value_desc;
    this.valid_min = valid_min;
    this.valid_max = valid_max;
    this.slider_min = slider_min;
    this.slider_max = slider_max;
    this.default_ = default_;
    this._precision = precision;
    this.display_flags = display_flags;
  }

  /** SDK `PF_ValueDisplayFlag_PERCENT` (bit 0). */
  get displays_percent(): boolean {
    const flags = this.display_flags;
    return flags != null && (flags & 0x01) !== 0;
  }
}
define(SliderPardChunk, {
  _pad_pre: bytes_field(15, { repr: false }),
  property_control_type: u1_field({ default: 10 }),
  _raw_name: bytes_field(32, { repr: false }),
  _pad_post: bytes_field(8, { repr: false }),
  last_value: f8_field(),
  phase: f8_field(),
  _value_desc: bytes_field(32, { repr: false }),
  valid_min: f4_field(),
  valid_max: f4_field(),
  slider_min: f4_field(),
  slider_max: f4_field(),
  default_: f4_field({ optional: true, default: null }),
  _precision: u2_field({ optional: true, default: null, repr: false }),
  display_flags: u2_field({ optional: true, default: null }),
}, { init: false });

/**
 * 3D point control (type 18, SDK `PF_Point3DDef`): f8 value x / y /
 * z, then f8 default x / y / z in percent of the layer size. The cached
 * value is a fraction of the layer size or equal to the percent default,
 * as for a 2D point.
 */
export class ThreeDPardChunk extends PardChunk {
  declare _pad_pre: Uint8Array;
  declare _raw_name: Uint8Array;
  declare _pad_post: Uint8Array;
  declare last_value_x_raw: number;
  declare last_value_y_raw: number;
  declare last_value_z_raw: number;
  declare default_x: number;
  declare default_y: number;
  declare default_z: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const {
      pad_pre = new Uint8Array(15),
      property_control_type = 18,
      raw_name = new Uint8Array(32),
      pad_post = new Uint8Array(8),
      last_value_x_raw = 0,
      last_value_y_raw = 0,
      last_value_z_raw = 0,
      default_x = 0,
      default_y = 0,
      default_z = 0,
    } = kw;
    this._pad_pre = pad_pre;
    (this as any).property_control_type = property_control_type;
    this._raw_name = raw_name;
    this._pad_post = pad_post;
    this.last_value_x_raw = last_value_x_raw;
    this.last_value_y_raw = last_value_y_raw;
    this.last_value_z_raw = last_value_z_raw;
    this.default_x = default_x;
    this.default_y = default_y;
    this.default_z = default_z;
  }

  /** Default x / y / z, in percent of the layer size. */
  get default_(): number[] {
    return [this.default_x, this.default_y, this.default_z];
  }

  get last_value_x(): number {
    return this.last_value_x_raw * 512;
  }

  get last_value_y(): number {
    return this.last_value_y_raw * 512;
  }

  get last_value_z(): number {
    return this.last_value_z_raw * 512;
  }
}
define(ThreeDPardChunk, {
  _pad_pre: bytes_field(15, { repr: false }),
  property_control_type: u1_field({ default: 18 }),
  _raw_name: bytes_field(32, { repr: false }),
  _pad_post: bytes_field(8, { repr: false }),
  last_value_x_raw: f8_field(),
  last_value_y_raw: f8_field(),
  last_value_z_raw: f8_field(),
  default_x: f8_field(),
  default_y: f8_field(),
  default_z: f8_field(),
}, { init: false });

// ---------------------------------------------------------------------------
// dwga - working gamma selector (1 byte)
// ---------------------------------------------------------------------------

/**
 * Working gamma selector chunk (4 bytes).
 *
 * The first byte selects the gamma (0 = 2.2, non-zero = 2.4)
 */
export class DwgaChunk extends Chunk {
  declare chunk_type: string;
  declare working_gamma_selector: number;
  declare _reserved_01: Uint8Array;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "dwga", working_gamma_selector = 0, reserved_01 = new Uint8Array(3) } = kw;
    this.chunk_type = chunk_type;
    this.working_gamma_selector = working_gamma_selector;
    this._reserved_01 = reserved_01;
  }

  /** Working gamma (2.2 or 2.4). */
  get working_gamma(): number {
    return this.working_gamma_selector === 0 ? 2.2 : 2.4;
  }

  set working_gamma(value: number) {
    this.working_gamma_selector = value === 2.2 ? 0 : 1;
  }
}
define(DwgaChunk, {
  chunk_type: field({ default: "dwga" }),
  working_gamma_selector: u1_field(),
  _reserved_01: bytes_field(3, { repr: false }),
}, { init: false });
register("dwga")(DwgaChunk);

// ---------------------------------------------------------------------------
// ewot - effect workspace outline entries
// ---------------------------------------------------------------------------

/**
 * Single effect workspace outline entry (4 bytes).
 *
 * Bit 7 of byte 0 marks child-property entries; bit 6 marks selected.
 */
export class EwotItem extends FmtItem {
  declare _flags: number;
  declare _data: Uint8Array;
  declare is_child_property: boolean;
  declare selected: boolean;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { flags = 0, data = new Uint8Array(3) } = kw;
    this._flags = flags;
    this._data = data;
  }
}
define(EwotItem, {
  _flags: u1_field(),
  _data: bytes_field(3),
}, { init: false });
descriptor(EwotItem, "is_child_property", new BitField("_flags", 7));
descriptor(EwotItem, "selected", new BitField("_flags", 6));

/**
 * Effect workspace outline entries.
 *
 * 4-byte count header followed by `count` × 4-byte entries.
 */
export class EwotChunk extends Chunk {
  declare chunk_type: string;
  declare num_entries: number;
  declare items: EwotItem[];

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "ewot", num_entries = 0, items = [] } = kw;
    this.chunk_type = chunk_type;
    this.num_entries = num_entries;
    this.items = items;
  }
}
define(EwotChunk, {
  chunk_type: field({ default: "ewot" }),
  num_entries: u4_field(),
  items: items_field(EwotItem, 4),
}, { init: false });
register("ewot")(EwotChunk);

// ---------------------------------------------------------------------------
// otln - composition panel outline entries
// ---------------------------------------------------------------------------

/**
 * Single comp panel outline entry (4 bytes).
 *
 * Bit 7 = collapsed, bit 6 = selected, bit 5 = is_property,
 * bit 3 = is_sub_entry.  `entry_type == 68` marks layer boundaries.
 */
export class OtlnItem extends FmtItem {
  declare _flags: number;
  declare _unnamed6: Uint8Array;
  declare entry_type: number;
  declare collapsed: boolean;
  declare selected: boolean;
  declare is_property: boolean;
  declare is_sub_entry: boolean;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { flags = 0, unnamed6 = new Uint8Array(2), entry_type = 0 } = kw;
    this._flags = flags;
    this._unnamed6 = unnamed6;
    this.entry_type = entry_type;
  }

  /** True when this entry is a per-layer boundary marker. */
  get is_layer_marker(): boolean {
    return this.entry_type === 68;
  }
}
define(OtlnItem, {
  _flags: u1_field(),
  _unnamed6: bytes_field(2),
  entry_type: u1_field(),
}, { init: false });
descriptor(OtlnItem, "collapsed", new BitField("_flags", 7));
descriptor(OtlnItem, "selected", new BitField("_flags", 6));
descriptor(OtlnItem, "is_property", new BitField("_flags", 5));
descriptor(OtlnItem, "is_sub_entry", new BitField("_flags", 3));

/**
 * Comp panel outline entries.
 *
 * 4-byte count header followed by `count` × 4-byte entries.
 */
export class OtlnChunk extends Chunk {
  declare chunk_type: string;
  declare num_entries: number;
  declare items: OtlnItem[];

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "otln", num_entries = 0, items = [] } = kw;
    this.chunk_type = chunk_type;
    this.num_entries = num_entries;
    this.items = items;
  }
}
define(OtlnChunk, {
  chunk_type: field({ default: "otln" }),
  num_entries: u4_field(),
  items: items_field(OtlnItem, 4),
}, { init: false });
register("otln")(OtlnChunk);

export const _PARD_VARIANTS = new Map<number, typeof PardChunk>([
  [0, GenericPardChunk],
  [1, IntegerPardChunk],
  [2, ScalarPardChunk],
  [3, AnglePardChunk],
  [4, BooleanPardChunk],
  [5, ColorPardChunk],
  [6, TwoDPardChunk],
  [7, EnumPardChunk],
  [9, GenericPardChunk],
  [10, SliderPardChunk],
  [11, GenericPardChunk],
  [12, GenericPardChunk],
  [13, GenericPardChunk],
  [14, GenericPardChunk],
  [15, GenericPardChunk],
  [18, ThreeDPardChunk],
]);

// Every variant redeclares `property_control_type` as a field over the base getter.
for (const variant of [
  GenericPardChunk,
  ColorPardChunk,
  IntegerPardChunk,
  ScalarPardChunk,
  AnglePardChunk,
  BooleanPardChunk,
  TwoDPardChunk,
  EnumPardChunk,
  SliderPardChunk,
  ThreeDPardChunk,
]) {
  shadow_property(variant, "property_control_type");
}

// ---------------------------------------------------------------------------
// fth5 - mask feather points (variable length, mixed endianness)
// ---------------------------------------------------------------------------

/**
 * A single variable-width mask feather point (32 bytes).
 *
 * Integer fields are little-endian; float fields are big-endian.
 */
export class FeatherPointItem extends FmtItem {
  /** Segment index (0-based, LE u4). */
  declare seg_loc: number;
  /** Interpolation type raw value (LE u4). 0=non-Hold, 2=Hold. */
  declare interp_raw: number;
  /** Relative position on the segment (0.0 to 1.0, BE f8). */
  declare rel_seg_loc: number;
  /** Feather radius. Negative=inner, positive=outer (BE f8). */
  declare radius: number;
  /** Corner angle percentage 0-100 (BE f4). */
  declare corner_angle: number;
  /** Feather tension 0.0-1.0 (BE f4). */
  declare tension: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const {
      seg_loc = 0,
      interp_raw = 0,
      rel_seg_loc = 0.0,
      radius = 0.0,
      corner_angle = 0.0,
      tension = 0.0,
    } = kw;
    this.seg_loc = seg_loc;
    this.interp_raw = interp_raw;
    this.rel_seg_loc = rel_seg_loc;
    this.radius = radius;
    this.corner_angle = corner_angle;
    this.tension = tension;
  }
}
define(FeatherPointItem, {
  seg_loc: u4_field({ endian: "<" }),
  interp_raw: u4_field({ endian: "<" }),
  rel_seg_loc: f8_field({ default: 0.0 }),
  radius: f8_field({ default: 0.0 }),
  corner_angle: f4_field({ default: 0.0 }),
  tension: f4_field({ default: 0.0 }),
}, { init: false });

export const _FTH5_ITEM_SIZE = 32;

/** Variable-width mask feather points (32 bytes per point). */
export class Fth5Chunk extends Chunk {
  declare chunk_type: string;
  declare points: FeatherPointItem[];

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "fth5", points = [] } = kw;
    this.chunk_type = chunk_type;
    this.points = points;
  }
}
define(Fth5Chunk, {
  chunk_type: field({ default: "fth5" }),
  points: items_field(FeatherPointItem, 32),
}, { init: false });
register("fth5")(Fth5Chunk);

// ---------------------------------------------------------------------------
// omtn - per-vertex RotoBezier tensions of a shape value
// ---------------------------------------------------------------------------

/** One vertex's RotoBezier tension (BE f4). */
export class TensionItem extends FmtItem {
  declare value: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { value = 0.0 } = kw;
    this.value = value;
  }
}
define(TensionItem, {
  value: f4_field({ default: 0.0 }),
}, { init: false });

/**
 * Per-vertex RotoBezier tensions of a mask shape value, one float per
 * vertex (0 = smoothest, 1 = a corner). Empty when the shape was never
 * given tensions.
 */
export class OmtnChunk extends Chunk {
  declare chunk_type: string;
  declare tensions: TensionItem[];

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "omtn", tensions = [] } = kw;
    this.chunk_type = chunk_type;
    this.tensions = tensions;
  }
}
define(OmtnChunk, {
  chunk_type: field({ default: "omtn" }),
  tensions: items_field(TensionItem, 4),
}, { init: false });
register("omtn")(OmtnChunk);

// ---------------------------------------------------------------------------
// Source / footage utility chunks
// ---------------------------------------------------------------------------
/** Application color profile ID (16 bytes, all 0xff = unmanaged). */
export class ApidChunk extends Chunk {
  declare chunk_type: string;
  declare data: Uint8Array;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "apid", data = bytes_.repeat(b("\xff"), 16) } = kw;
    this.chunk_type = chunk_type;
    this.data = data;
  }
}
define(ApidChunk, {
  chunk_type: field({ default: "apid" }),
  data: field({ default: bytes_.repeat(b("\xff"), 16) }),
}, { init: false });
register("apid")(ApidChunk);

/** Embedded color profile ID (16 bytes, all 0xff = unmanaged). */
export class EpidChunk extends Chunk {
  declare chunk_type: string;
  declare data: Uint8Array;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "epid", data = bytes_.repeat(b("\xff"), 16) } = kw;
    this.chunk_type = chunk_type;
    this.data = data;
  }
}
define(EpidChunk, {
  chunk_type: field({ default: "epid" }),
  data: field({ default: bytes_.repeat(b("\xff"), 16) }),
}, { init: false });
register("epid")(EpidChunk);

/**
 * Embedded-profile-present flag.
 *
 * AE writes this (value 1) when the source file carries an embedded color
 * profile; the `Utf8` chunk that follows it in `LIST:CLRS` holds the
 * profile's name (e.g. `Coated FOGRA39 (ISO 12647-2:2004)`). Absent when the
 * source has no embedded profile.
 */
export class EmpdChunk extends Chunk {
  declare chunk_type: string;
  declare value: boolean;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "empd", value = true } = kw;
    this.chunk_type = chunk_type;
    this.value = value;
  }
}
define(EmpdChunk, {
  chunk_type: field({ default: "empd" }),
  value: bool_field({ default: true }),
}, { init: false });
register("empd")(EmpdChunk);

/** Linearization setting (4 bytes little-endian). */
export class LinlChunk extends Chunk {
  declare chunk_type: string;
  declare value: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "linl", value = 2 } = kw;
    this.chunk_type = chunk_type;
    this.value = value;
  }
}
define(LinlChunk, {
  chunk_type: field({ default: "linl" }),
  value: u4_field({ endian: "<", default: 2 }),
}, { init: false });
register("linl")(LinlChunk);

/** Embed profile flag. */
export class EmbpChunk extends Chunk {
  declare chunk_type: string;
  declare value: boolean;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "embp", value = true } = kw;
    this.chunk_type = chunk_type;
    this.value = value;
  }
}
define(EmbpChunk, {
  chunk_type: field({ default: "embp" }),
  value: bool_field({ default: true }),
}, { init: false });
register("embp")(EmbpChunk);

/** Input profile working space. */
export class IpwsChunk extends Chunk {
  declare chunk_type: string;
  declare value: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "ipws", value = 1 } = kw;
    this.chunk_type = chunk_type;
    this.value = value;
  }
}
define(IpwsChunk, {
  chunk_type: field({ default: "ipws" }),
  value: u1_field({ default: 1 }),
}, { init: false });
register("ipws")(IpwsChunk);

/** Display color UI flag (solid sources only). */
export class DcuiChunk extends Chunk {
  declare chunk_type: string;
  declare value: boolean;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "dcui", value = true } = kw;
    this.chunk_type = chunk_type;
    this.value = value;
  }
}
define(DcuiChunk, {
  chunk_type: field({ default: "dcui" }),
  value: bool_field({ default: true }),
}, { init: false });
register("dcui")(DcuiChunk);

/** Preserve RGB flag (solid sources only). */
export class PrgbChunk extends Chunk {
  declare chunk_type: string;
  declare value: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "prgb", value = 1 } = kw;
    this.chunk_type = chunk_type;
    this.value = value;
  }
}
define(PrgbChunk, {
  chunk_type: field({ default: "prgb" }),
  value: u1_field({ default: 1 }),
}, { init: false });
register("prgb")(PrgbChunk);

/** Monitor color space flag. */
export class McspChunk extends Chunk {
  declare chunk_type: string;
  declare value: boolean;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "Mcsp", value = true } = kw;
    this.chunk_type = chunk_type;
    this.value = value;
  }
}
define(McspChunk, {
  chunk_type: field({ default: "Mcsp" }),
  value: bool_field({ default: true }),
}, { init: false });
register("Mcsp")(McspChunk);

/** Output color space flag. */
export class OcspChunk extends Chunk {
  declare chunk_type: string;
  declare value: boolean;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "ocsp", value = true } = kw;
    this.chunk_type = chunk_type;
    this.value = value;
  }
}
define(OcspChunk, {
  chunk_type: field({ default: "ocsp" }),
  value: bool_field({ default: true }),
}, { init: false });
register("ocsp")(OcspChunk);

/** HDR mode flag. */
export class HdrmChunk extends Chunk {
  declare chunk_type: string;
  declare value: boolean;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "hdrm", value = true } = kw;
    this.chunk_type = chunk_type;
    this.value = value;
  }
}
define(HdrmChunk, {
  chunk_type: field({ default: "hdrm" }),
  value: bool_field({ default: true }),
}, { init: false });
register("hdrm")(HdrmChunk);

/** Media start info (8 bytes). */
export class StrtChunk extends Chunk {
  declare chunk_type: string;
  declare _reserved_00: Uint8Array;
  declare fps_byte: number;
  declare _reserved_05: Uint8Array;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const {
      chunk_type = "strt",
      reserved_00 = new Uint8Array(4),
      fps_byte = 1,
      reserved_05 = new Uint8Array(3),
    } = kw;
    this.chunk_type = chunk_type;
    this._reserved_00 = reserved_00;
    this.fps_byte = fps_byte;
    this._reserved_05 = reserved_05;
  }
}
define(StrtChunk, {
  chunk_type: field({ default: "strt" }),
  _reserved_00: bytes_field(4, { repr: false }),
  fps_byte: u1_field({ default: 1 }),
  _reserved_05: bytes_field(3, { repr: false }),
}, { init: false });
register("strt")(StrtChunk);

/** Drop frame flag. */
export class DropChunk extends Chunk {
  declare chunk_type: string;
  declare value: boolean;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "drop", value = true } = kw;
    this.chunk_type = chunk_type;
    this.value = value;
  }
}
define(DropChunk, {
  chunk_type: field({ default: "drop" }),
  value: bool_field({ default: true }),
}, { init: false });
register("drop")(DropChunk);

/** Footage interpretation global info (16 bytes). */
export class FtgiChunk extends Chunk {
  declare chunk_type: string;
  declare start_offset: number;
  declare frame_rate_num: number;
  declare end_frame: number;
  declare time_base: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const {
      chunk_type = "ftgi",
      start_offset = 0,
      frame_rate_num = 1,
      end_frame = 0xffffffff,
      time_base = 600,
    } = kw;
    this.chunk_type = chunk_type;
    this.start_offset = start_offset;
    this.frame_rate_num = frame_rate_num;
    this.end_frame = end_frame;
    this.time_base = time_base;
  }
}
define(FtgiChunk, {
  chunk_type: field({ default: "ftgi" }),
  start_offset: u4_field(),
  frame_rate_num: u4_field({ default: 1 }),
  end_frame: u4_field({ default: 0xffffffff }),
  time_base: u4_field({ default: 600 }),
}, { init: false });
register("ftgi")(FtgiChunk);
