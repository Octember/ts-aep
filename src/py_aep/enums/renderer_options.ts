/**
 * 3D renderer option enumerations.
 *
 * These options are not exposed in ExtendScript; the values are the indices
 * After Effects stores in the `prda` chunk, and the labels are the entries
 * its Render Options dialog shows.
 */

import { getitem, int_enum, type EnumValue } from "../../pyrt/index.ts";

/**
 * Classic 3D shadow map resolution.
 *
 * Used in Composition Settings > 3D Renderer > Classic 3D > Options.
 *
 * Not documented in the AE scripting reference.
 */
export const ShadowMapResolution = int_enum(
  "ShadowMapResolution",
  {
    COMP_SIZE: 0,
    RES_250: 1,
    RES_500: 2,
    RES_750: 3,
    RES_1000: 4,
    RES_1500: 5,
    RES_2000: 6,
    RES_3000: 7,
    RES_4000: 8,
  },
  {
    // TODO(port): Python `member.label` is a property on the member; members are plain numbers here, so this is a method that takes the member.
    /** The entry as the Options dialog spells it. */
    label(value: number): string {
      return getitem(_SHADOW_MAP_RESOLUTION_LABELS, value);
    },
  },
);
export type ShadowMapResolution = EnumValue<typeof ShadowMapResolution>;

export const _SHADOW_MAP_RESOLUTION_LABELS: Map<number, string> = new Map<number, string>([
  [0, "Comp Size"],
  [1, "250"],
  [2, "500"],
  [3, "750"],
  [4, "1000"],
  [5, "1500"],
  [6, "2000"],
  [7, "3000"],
  [8, "4000"],
]);

/**
 * Advanced 3D environment light shadow resolution.
 *
 * Used in Composition Settings > 3D Renderer > Advanced 3D > Options.
 *
 * Not documented in the AE scripting reference.
 */
export const EnvironmentLightShadowResolution = int_enum(
  "EnvironmentLightShadowResolution",
  {
    HALF: 0,
    FULL: 1,
    DOUBLE: 2,
  },
  {
    // TODO(port): Python `member.label` is a property on the member; members are plain numbers here, so this is a method that takes the member.
    /** The entry as the Options dialog spells it. */
    label(value: number): string {
      return getitem(_ENV_LIGHT_SHADOW_RESOLUTION_LABELS, value);
    },
  },
);
export type EnvironmentLightShadowResolution = EnumValue<typeof EnvironmentLightShadowResolution>;

export const _ENV_LIGHT_SHADOW_RESOLUTION_LABELS: Map<number, string> = new Map<number, string>([
  [0, "Half (2MB)"],
  [1, "Full (16MB)"],
  [2, "Double (128MB)"],
]);
