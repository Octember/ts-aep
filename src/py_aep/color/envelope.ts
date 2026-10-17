/**
 * Build and parse the color-profile envelope embedded in `.aep` color chunks.
 *
 * After Effects stores each color space (project working space, display color
 * space, footage media color space) as a compact JSON envelope inside a `Utf8`
 * chunk's `.value`:
 *
 *     \{"baseColorProfile":\{"colorProfileData":"\<base64\>","colorProfileName":"\<name\>"\},"baseProfileType":\<1|2|3\>\}
 *
 * `baseProfileType`:
 *
 * - `2` = Adobe ICC: `colorProfileData` is the raw ICC profile bytes (base64),
 *   `bytes[36:40] == b"acsp"`.
 * - `3` = OCIO: `colorProfileData` is base64 of a small JSON describing the OCIO
 *   color space (single color space, or a display + view pair).
 * - `1` = display-referred tag: an 8-byte `01000000ffffffff` blob (read-only).
 *
 * This module is the single source of truth for that byte format so that
 * round-trips stay byte-identical. It is pure (`json` + `base64`); it performs no
 * I/O and imports nothing from `models/` or `binary/`.
 *
 * AE writes compact JSON (separators `,` and `:`, no whitespace) with a fixed key
 * order; reproducing it exactly is required for byte-identical output.
 */

import { encode, getitem, json_dumps, json_loads } from "../../pyrt/index.ts";
import { b64decode, b64encode } from "../../pyrt/base64.ts";
import type { Dyn } from "./index.ts";

// baseProfileType values.

/** Display-referred tag (8-byte blob); read-only, not a write target. */
export const PROFILE_TYPE_TAG = 1;
/** Adobe ICC profile; `colorProfileData` is raw ICC bytes. */
export const PROFILE_TYPE_ICC = 2;
/** OCIO color space; `colorProfileData` is a small JSON. */
export const PROFILE_TYPE_OCIO = 3;

// ocioColorSpaceType values inside an OCIO `colorProfileData` JSON.

/** A display + view pair (`colorSpace1` = display, `colorSpace2` = view). */
export const OCIO_TYPE_DISPLAY = 1;
/** A single color space (`colorSpace1` only). */
export const OCIO_TYPE_COLORSPACE = 2;

export function _compact(obj: object): string {
  /**
   * Serialize `obj` exactly as AE does: compact, no whitespace.
   *
   * `ensure_ascii=False` so a non-ASCII profile/color-space name is emitted as
   * raw UTF-8 (matching AE's `Utf8` chunk) rather than `\uXXXX` escapes, which
   * would break the byte-identical round-trip.
   */
  return json_dumps(obj, { separators: [",", ":"], ensure_ascii: false });
}

export function _b64(text: string): string {
  return b64encode(encode(text, "utf-8"));
}

export function _envelope(color_profile_data_b64: string, name: string, profile_type: number): string {
  /**
   * Wrap pre-encoded `colorProfileData` in the outer envelope.
   *
   * Key order matches AE verbatim: `baseColorProfile` (`colorProfileData` then
   * `colorProfileName`), then `baseProfileType`.
   */
  return _compact({
    baseColorProfile: {
      colorProfileData: color_profile_data_b64,
      colorProfileName: name,
    },
    baseProfileType: profile_type,
  });
}

/**
 * Envelope for an OCIO color space from a resolved `(name, data)` pair.
 *
 * The pair depends on the selection KIND and so needs the `.ocio` config to
 * resolve; see
 * {@link py_aep.color.ocio.ocio_color_profile_envelope | ocio_color_profile_envelope},
 * which is what callers should use. This function is the pure byte-format
 * half, kept here with the rest of the envelope spec.
 *
 * @param profile_name - The `colorProfileName` (e.g. `"ACES/ACEScg yo"`).
 * @param profile_data - The `colorProfileData` JSON (e.g. `{"colorSpace1":"ACEScg yo"}`).
 */
export function build_ocio_envelope(profile_name: string, profile_data: string): string {
  return _envelope(_b64(profile_data), profile_name, PROFILE_TYPE_OCIO);
}

/**
 * Envelope for an OCIO color space selected by ROLE or ALIAS.
 *
 * `colorProfileName` is the role's target (or the alias) itself, and the
 * data carries `ocioColorSpaceType: 2`.
 *
 * **Warning:** This is only one of the four selection kinds. A DIRECT colorspace
 * pick uses `colorProfileName = "<family>/<name>"` and omits
 * `ocioColorSpaceType` - passing a direct colorspace name here
 * produces an envelope AE would not write. Prefer
 * {@link py_aep.color.ocio.ocio_color_profile_envelope | ocio_color_profile_envelope},
 * which resolves the kind against the config.
 *
 * @param colorspace - The OCIO role target or alias name.
 */
export function build_ocio_colorspace_envelope(colorspace: string): string {
  const inner = _compact({ colorSpace1: colorspace, ocioColorSpaceType: OCIO_TYPE_COLORSPACE });
  return _envelope(_b64(inner), colorspace, PROFILE_TYPE_OCIO);
}

/**
 * Envelope for an OCIO display color space (a display + view pair).
 *
 * `colorProfileName` is `"<display>/<view>"`.
 *
 * @param display - The OCIO display name (e.g. `"sRGB - Display"`).
 * @param view - The OCIO view name (e.g. `"ACES 1.0 - SDR Video"`).
 */
export function build_ocio_display_envelope(display: string, view: string): string {
  const inner = _compact({
    colorSpace1: display,
    colorSpace2: view,
    ocioColorSpaceType: OCIO_TYPE_DISPLAY,
  });
  return _envelope(_b64(inner), `${display}/${view}`, PROFILE_TYPE_OCIO);
}

/**
 * Envelope for an Adobe ICC color space.
 *
 * Used for the project working/display space and footage media color space in
 * Adobe CMS mode.
 *
 * @param name - The profile description (e.g. `"ProPhoto RGB"`).
 * @param icc_bytes - The raw ICC profile bytes to embed.
 */
export function build_icc_envelope(name: string, icc_bytes: Uint8Array): string {
  return _envelope(b64encode(icc_bytes), name, PROFILE_TYPE_ICC);
}

/** A decoded color-profile envelope. */
export class ColorProfile {
  /** `colorProfileName` (e.g. `"ACEScg"`, `"ACES/sRGB"`, `"ProPhoto RGB"`). */
  readonly name: string;

  /** `baseProfileType`: one of `PROFILE_TYPE_TAG/ICC/OCIO`. */
  readonly profile_type: number;

  /** Decoded `colorProfileData`: raw ICC bytes, OCIO JSON bytes, or tag blob. */
  readonly data: Uint8Array;

  constructor(name: string, profile_type: number, data: Uint8Array) {
    this.name = name;
    this.profile_type = profile_type;
    this.data = data;
  }

  *[Symbol.iterator](): Generator<string | number | Uint8Array> {
    yield this.name;
    yield this.profile_type;
    yield this.data;
  }

  /** Whether this is an OCIO profile (`baseProfileType == 3`). */
  get is_ocio(): boolean {
    return this.profile_type === PROFILE_TYPE_OCIO;
  }

  /** Whether this is an Adobe ICC profile (`baseProfileType == 2`). */
  get is_icc(): boolean {
    return this.profile_type === PROFILE_TYPE_ICC;
  }

  /** The OCIO `(colorSpace1[, colorSpace2])` names, or an empty array if not OCIO. */
  get ocio_color_spaces(): readonly string[] {
    if (!this.is_ocio) return [];
    const inner: Map<string, string> = json_loads(this.data);
    const names = [getitem(inner, "colorSpace1")];
    if (inner.has("colorSpace2")) names.push(getitem(inner, "colorSpace2"));
    return names;
  }
}

/**
 * Decode a color-profile envelope `Utf8` value into a `ColorProfile`.
 *
 * @param envelope_json - The raw `Utf8` chunk value (the outer JSON string).
 */
export function parse_envelope(envelope_json: string): ColorProfile {
  const outer: Map<string, Dyn> = json_loads(envelope_json);
  const base: Map<string, string> = getitem(outer, "baseColorProfile");
  return new ColorProfile(
    getitem(base, "colorProfileName"),
    getitem(outer, "baseProfileType"),
    b64decode(getitem(base, "colorProfileData")),
  );
}


/**
 * The envelope's `colorProfileName`, or `"None"` when the envelope is
 * empty (`{}`, e.g. an unset `pdvc` display chunk) or carries no name.
 *
 * Unlike `parse_envelope`, this does not require `colorProfileData`.
 */
export function envelope_profile_name(envelope_json: string): string {
  const outer: Map<string, Map<string, string>> = json_loads(envelope_json);
  return (outer.get("baseColorProfile") ?? new Map<string, string>()).get("colorProfileName") ?? "None";
}
