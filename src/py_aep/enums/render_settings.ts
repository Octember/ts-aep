/**
 * Render settings enumerations for After Effects render queue items.
 *
 * These enums match the values used in After Effects ExtendScript.
 */

import { and, getitem, int, int_enum, type EnumValue } from "../../pyrt/index.ts";

/**
 * Frame rate source setting for rendering.
 *
 * Determines whether the render uses the composition's own frame rate
 * or a custom frame rate specified in the render settings.
 *
 * Used in RenderQueueItem Settings \> Frame Rate
 *
 * Not documented in AE scripting reference.
 */
export const FrameRateSetting = int_enum(
  "FrameRateSetting",
  {
    USE_COMP_FRAME_RATE: 0,
    USE_THIS_FRAME_RATE: 1,
  },
  {
    /** ExtendScript STRING format label. */
    // NOTE(port): Python `@property label` is `FrameRateSetting.label(member)` per RULEBOOK enum mapping (members are plain numbers); same labels-table lookup.
    label(self: number): string {
      return getitem(_FRAME_RATE_SETTING_LABELS, self);
    },
  },
);
export type FrameRateSetting = EnumValue<typeof FrameRateSetting>;

export const _FRAME_RATE_SETTING_LABELS: Map<number, string> = new Map<number, string>([
  [0, "Use comp's frame rate"],
  [1, "Use this frame rate"],
]);

/**
 * Quality setting for rendering.
 *
 * Used in RenderQueueItem Settings \> Quality
 *
 * Not documented in AE scripting reference.
 */
export const RenderQuality = int_enum(
  "RenderQuality",
  {
    CURRENT_SETTINGS: -1,
    WIREFRAME: 0,
    DRAFT: 1,
    BEST: 2,
  },
  {
    /** ExtendScript STRING format label. */
    // NOTE(port): Python `@property label` is `RenderQuality.label(member)` per RULEBOOK enum mapping (members are plain numbers); same labels-table lookup.
    label(self: number): string {
      return getitem(_RENDER_QUALITY_LABELS, self);
    },

    /** Convert binary value to RenderQuality (0xFFFF = CURRENT_SETTINGS). */
    from_binary(value: number): number {
      return value === 0xffff ? this.CURRENT_SETTINGS : this.of(value);
    },

    /** Convert to binary value (CURRENT_SETTINGS -\> 0xFFFF). */
    to_binary(self: number): number {
      return and(int(self), 0xffff);
    },
  },
);
export type RenderQuality = EnumValue<typeof RenderQuality>;

export const _RENDER_QUALITY_LABELS: Map<number, string> = new Map<number, string>([
  [-1, "Current Settings"],
  [0, "Wireframe"],
  [1, "Draft"],
  [2, "Best"],
]);

/**
 * Field rendering option.
 *
 * Used in RenderQueueItem Settings \> Field Render
 *
 * Not documented in AE scripting reference.
 */
export const FieldRender = int_enum(
  "FieldRender",
  {
    OFF: 0,
    UPPER_FIELD_FIRST: 1,
    LOWER_FIELD_FIRST: 2,
  },
  {
    /** ExtendScript STRING format label. */
    // NOTE(port): Python `@property label` is `FieldRender.label(member)` per RULEBOOK enum mapping (members are plain numbers); same labels-table lookup.
    label(self: number): string {
      return getitem(_FIELD_RENDER_LABELS, self);
    },
  },
);
export type FieldRender = EnumValue<typeof FieldRender>;

export const _FIELD_RENDER_LABELS: Map<number, string> = new Map<number, string>([
  [0, "Off"],
  [1, "Upper Field First"],
  [2, "Lower Field First"],
]);

/**
 * 3:2 Pulldown phase for field rendering.
 *
 * Used in RenderQueueItem Settings \> 3:2 Pulldown
 *
 * Not documented in AE scripting reference.
 */
export const PulldownSetting = int_enum(
  "PulldownSetting",
  {
    OFF: 0,
    WSSWW: 1,
    SSWWW: 2,
    SWWWS: 3,
    WWWSS: 4,
    WWSSW: 5,
  },
  {
    /** ExtendScript STRING format label. */
    // NOTE(port): Python `@property label` is `PulldownSetting.label(member)` per RULEBOOK enum mapping (members are plain numbers); same labels-table lookup.
    label(self: number): string {
      return getitem(_PULLDOWN_SETTING_LABELS, self);
    },
  },
);
export type PulldownSetting = EnumValue<typeof PulldownSetting>;

export const _PULLDOWN_SETTING_LABELS: Map<number, string> = new Map<number, string>([
  [0, "Off"],
  [1, "WSSWW"],
  [2, "SSWWW"],
  [3, "SWWWS"],
  [4, "WWWSS"],
  [5, "WWSSW"],
]);

/**
 * Motion blur render setting.
 *
 * Used in RenderQueueItem Settings \> Motion Blur
 *
 * Not documented in AE scripting reference.
 */
export const MotionBlurSetting = int_enum(
  "MotionBlurSetting",
  {
    OFF_FOR_ALL_LAYERS: 0,
    ON_FOR_CHECKED_LAYERS: 1,
    CURRENT_SETTINGS: 2,
  },
  {
    /** ExtendScript STRING format label. */
    // NOTE(port): Python `@property label` is `MotionBlurSetting.label(member)` per RULEBOOK enum mapping (members are plain numbers); same labels-table lookup.
    label(self: number): string {
      return getitem(_MOTION_BLUR_SETTING_LABELS, self);
    },

    /** Convert binary value (0xFFFF = CURRENT_SETTINGS). */
    from_binary(value: number): number {
      return value === 0xffff ? this.CURRENT_SETTINGS : this.of(value);
    },
  },
);
export type MotionBlurSetting = EnumValue<typeof MotionBlurSetting>;

export const _MOTION_BLUR_SETTING_LABELS: Map<number, string> = new Map<number, string>([
  [0, "Off for All Layers"],
  [1, "On for Checked Layers"],
  [2, "Current Settings"],
]);

/**
 * Frame blending render setting.
 *
 * Used in RenderQueueItem Settings \> Frame Blending
 *
 * Not documented in AE scripting reference.
 */
export const FrameBlendingSetting = int_enum(
  "FrameBlendingSetting",
  {
    OFF_FOR_ALL_LAYERS: 0,
    ON_FOR_CHECKED_LAYERS: 1,
    CURRENT_SETTINGS: 2,
  },
  {
    /** ExtendScript STRING format label. */
    // NOTE(port): Python `@property label` is `FrameBlendingSetting.label(member)` per RULEBOOK enum mapping (members are plain numbers); same labels-table lookup.
    label(self: number): string {
      return getitem(_FRAME_BLENDING_SETTING_LABELS, self);
    },

    /** Convert binary value (0xFFFF = CURRENT_SETTINGS). */
    from_binary(value: number): number {
      return value === 0xffff ? this.CURRENT_SETTINGS : this.of(value);
    },
  },
);
export type FrameBlendingSetting = EnumValue<typeof FrameBlendingSetting>;

export const _FRAME_BLENDING_SETTING_LABELS: Map<number, string> = new Map<number, string>([
  [0, "Off for All Layers"],
  [1, "On for Checked Layers"],
  [2, "Current Settings"],
]);

/**
 * Effects render setting.
 *
 * Used in RenderQueueItem Settings \> Effects
 *
 * Not documented in AE scripting reference.
 */
export const EffectsSetting = int_enum(
  "EffectsSetting",
  {
    ALL_OFF: 0,
    ALL_ON: 1,
    CURRENT_SETTINGS: 2,
  },
  {
    /** ExtendScript STRING format label. */
    // NOTE(port): Python `@property label` is `EffectsSetting.label(member)` per RULEBOOK enum mapping (members are plain numbers); same labels-table lookup.
    label(self: number): string {
      return getitem(_EFFECTS_SETTING_LABELS, self);
    },

    /** Convert binary value (0xFFFF = CURRENT_SETTINGS). */
    from_binary(value: number): number {
      return value === 0xffff ? this.CURRENT_SETTINGS : this.of(value);
    },
  },
);
export type EffectsSetting = EnumValue<typeof EffectsSetting>;

export const _EFFECTS_SETTING_LABELS: Map<number, string> = new Map<number, string>([
  [0, "All Off"],
  [1, "All On"],
  [2, "Current Settings"],
]);

/**
 * Proxy usage render setting.
 *
 * Used in RenderQueueItem Settings \> Proxy Use
 *
 * Not documented in AE scripting reference.
 */
export const ProxyUseSetting = int_enum(
  "ProxyUseSetting",
  {
    USE_NO_PROXIES: 0,
    USE_ALL_PROXIES: 1,
    CURRENT_SETTINGS: 2,
    USE_COMP_PROXIES_ONLY: 3,
  },
  {
    /** ExtendScript STRING format label. */
    // NOTE(port): Python `@property label` is `ProxyUseSetting.label(member)` per RULEBOOK enum mapping (members are plain numbers); same labels-table lookup.
    label(self: number): string {
      return getitem(_PROXY_USE_SETTING_LABELS, self);
    },

    /** Convert binary value (0xFFFF = CURRENT_SETTINGS). */
    from_binary(value: number): number {
      return value === 0xffff ? this.CURRENT_SETTINGS : this.of(value);
    },
  },
);
export type ProxyUseSetting = EnumValue<typeof ProxyUseSetting>;

export const _PROXY_USE_SETTING_LABELS: Map<number, string> = new Map<number, string>([
  [0, "Use No Proxies"],
  [1, "Use All Proxies"],
  [2, "Current Settings"],
  [3, "Use Comp Proxies Only"],
]);

/**
 * Solo switches render setting.
 *
 * Used in RenderQueueItem Settings \> Solo Switches
 *
 * Not documented in AE scripting reference.
 */
export const SoloSwitchesSetting = int_enum(
  "SoloSwitchesSetting",
  {
    ALL_OFF: 0,
    CURRENT_SETTINGS: 2,
  },
  {
    /** ExtendScript STRING format label. */
    // NOTE(port): Python `@property label` is `SoloSwitchesSetting.label(member)` per RULEBOOK enum mapping (members are plain numbers); same labels-table lookup.
    label(self: number): string {
      return getitem(_SOLO_SWITCHES_SETTING_LABELS, self);
    },

    /** Convert binary value (0xFFFF = CURRENT_SETTINGS). */
    from_binary(value: number): number {
      return value === 0xffff ? this.CURRENT_SETTINGS : this.of(value);
    },
  },
);
export type SoloSwitchesSetting = EnumValue<typeof SoloSwitchesSetting>;

export const _SOLO_SWITCHES_SETTING_LABELS: Map<number, string> = new Map<number, string>([
  [0, "All Off"],
  [2, "Current Settings"],
]);

/**
 * Guide layers render setting.
 *
 * Used in RenderQueueItem Settings \> Guide Layers
 *
 * Not documented in AE scripting reference.
 */
export const GuideLayers = int_enum(
  "GuideLayers",
  {
    ALL_OFF: 0,
    CURRENT_SETTINGS: 2,
  },
  {
    /** ExtendScript STRING format label. */
    // NOTE(port): Python `@property label` is `GuideLayers.label(member)` per RULEBOOK enum mapping (members are plain numbers); same labels-table lookup.
    label(self: number): string {
      return getitem(_GUIDE_LAYERS_LABELS, self);
    },

    /** Convert binary value (0xFFFF = CURRENT_SETTINGS). */
    from_binary(value: number): number {
      return value === 0xffff ? this.CURRENT_SETTINGS : this.of(value);
    },
  },
);
export type GuideLayers = EnumValue<typeof GuideLayers>;

export const _GUIDE_LAYERS_LABELS: Map<number, string> = new Map<number, string>([
  [0, "All Off"],
  [2, "Current Settings"],
]);

/**
 * Disk cache render setting.
 *
 * Used in RenderQueueItem Settings \> Disk Cache
 *
 * Not documented in AE scripting reference.
 */
export const DiskCacheSetting = int_enum(
  "DiskCacheSetting",
  {
    READ_ONLY: 0,
    CURRENT_SETTINGS: 2,
  },
  {
    /** ExtendScript STRING format label. */
    // NOTE(port): Python `@property label` is `DiskCacheSetting.label(member)` per RULEBOOK enum mapping (members are plain numbers); same labels-table lookup.
    label(self: number): string {
      return getitem(_DISK_CACHE_SETTING_LABELS, self);
    },

    /** Convert binary value (0xFFFF = CURRENT_SETTINGS). */
    from_binary(value: number): number {
      return value === 0xffff ? this.CURRENT_SETTINGS : this.of(value);
    },
  },
);
export type DiskCacheSetting = EnumValue<typeof DiskCacheSetting>;

export const _DISK_CACHE_SETTING_LABELS: Map<number, string> = new Map<number, string>([
  [0, "Read Only"],
  [2, "Current Settings"],
]);

/**
 * Color depth render setting.
 *
 * Used in RenderQueueItem Settings \> Color Depth
 *
 * Not documented in AE scripting reference.
 */
export const ColorDepthSetting = int_enum(
  "ColorDepthSetting",
  {
    CURRENT_SETTINGS: -1,
    EIGHT_BITS_PER_CHANNEL: 0,
    SIXTEEN_BITS_PER_CHANNEL: 1,
    THIRTY_TWO_BITS_PER_CHANNEL: 2,
  },
  {
    /** ExtendScript STRING format label. */
    // NOTE(port): Python `@property label` is `ColorDepthSetting.label(member)` per RULEBOOK enum mapping (members are plain numbers); same labels-table lookup.
    label(self: number): string {
      return getitem(_COLOR_DEPTH_SETTING_LABELS, self);
    },

    /** Convert binary value (0xFFFF = CURRENT_SETTINGS). */
    from_binary(value: number): number {
      return value === 0xffff ? this.CURRENT_SETTINGS : this.of(value);
    },

    /** Convert to binary value (CURRENT_SETTINGS -\> 0xFFFF). */
    to_binary(self: number): number {
      return and(int(self), 0xffff);
    },
  },
);
export type ColorDepthSetting = EnumValue<typeof ColorDepthSetting>;

export const _COLOR_DEPTH_SETTING_LABELS: Map<number, string> = new Map<number, string>([
  [-1, "Current Settings"],
  [0, "8 bits per channel"],
  [1, "16 bits per channel"],
  [2, "32 bits per channel"],
]);

/**
 * Time span source setting.
 *
 * Used in RenderQueueItem Settings \> Time Span
 *
 * Not documented in AE scripting reference.
 */
export const TimeSpanSource = int_enum(
  "TimeSpanSource",
  {
    LENGTH_OF_COMP: 0,
    WORK_AREA_ONLY: 1,
    CUSTOM: 2,
  },
  {
    /** ExtendScript STRING format label. */
    // NOTE(port): Python `@property label` is `TimeSpanSource.label(member)` per RULEBOOK enum mapping (members are plain numbers); same labels-table lookup.
    label(self: number): string {
      return getitem(_TIME_SPAN_SOURCE_LABELS, self);
    },

    /** Convert binary value (0xFFFF = CUSTOM). */
    from_binary(value: number): number {
      return value === 0xffff ? this.CUSTOM : this.of(value);
    },
  },
);
export type TimeSpanSource = EnumValue<typeof TimeSpanSource>;

export const _TIME_SPAN_SOURCE_LABELS: Map<number, string> = new Map<number, string>([
  [0, "Length of Comp"],
  [1, "Work Area Only"],
  [2, "Custom"],
]);

/**
 * Post-render action for the output module settings dict.
 *
 * Used in OutputModule Settings \> Post-Render Action
 *
 * Not documented in AE scripting reference.
 */
export const PostRenderActionSetting = int_enum(
  "PostRenderActionSetting",
  {
    NONE: 0,
    IMPORT: 1,
    IMPORT_AND_REPLACE_USAGE: 2,
    SET_PROXY: 3,
  },
  {
    /** ExtendScript STRING format label. */
    // NOTE(port): Python `@property label` is `PostRenderActionSetting.label(member)` per RULEBOOK enum mapping (members are plain numbers); same labels-table lookup.
    label(self: number): string {
      return getitem(_POST_RENDER_ACTION_SETTING_LABELS, self);
    },
  },
);
export type PostRenderActionSetting = EnumValue<typeof PostRenderActionSetting>;

export const _POST_RENDER_ACTION_SETTING_LABELS: Map<number, string> = new Map<number, string>([
  [0, "None"],
  [1, "Import"],
  [2, "Import & Replace Usage"],
  [3, "Set Proxy"],
]);
