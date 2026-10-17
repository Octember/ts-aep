/**
 * Item and project-level chunk types: idta, head, nhed, nnhd.
 *
 * All three use `fmt_field()` for fixed-layout I/O.
 * HeadChunk packs version info into a 32-bit bitfield word with \@property
 * accessors. NnhdChunk uses `BitField` for scattered flag bits.
 */

import {
  and,
  and_not,
  b,
  bytes_,
  decode,
  define,
  descriptor,
  encode,
  field,
  floordiv,
  int,
  lshift,
  mod,
  object_setattr,
  or,
  repr,
  rshift,
  split,
  ValueError,
  py_re,
} from "../../pyrt/index.ts";
import { MAC_EPOCH_OFFSET } from "./bin_utils.ts";
import { BitField } from "./bitfield.ts";
import { Chunk } from "./chunk.ts";
import { FmtItem, bool_field, bytes_field, u1_field, u2_field, u4_field } from "./fmt_field.ts";
import { register } from "./registry.ts";

// ---------------------------------------------------------------------------
// idta - item descriptor (56 bytes + trailing)
// ---------------------------------------------------------------------------

/**
 * Item descriptor chunk.
 *
 * Contains item type, ID, and label. Most of the 84-byte body is
 * reserved/unknown and preserved for round-trip fidelity.
 */
export class IdtaChunk extends Chunk {
  declare chunk_type: string;
  /** Item type enum: 1=folder, 4=composition, 7=footage. */
  declare item_type: number;
  declare _reserved_02: Uint8Array;
  /** Unique item identifier within the project. */
  declare item_id: number;
  declare _flags_14: Uint8Array;
  declare _proxy_flags: number;
  declare _flags_17: number;
  declare _reserved_18: Uint8Array;
  declare _proxy_active: number;
  declare _reserved_39: Uint8Array;
  /** Label color index. */
  declare label: number;
  declare _reserved_3c: Uint8Array;
  /** Bytes 0x50-0x53: big-endian Mac-epoch seconds (see `modified_time`). */
  declare _modified_stamp: number;

  // -- BitField descriptors (not attrs fields) ---------------------------
  declare use_proxy: boolean;
  declare is_solid: boolean;
  declare is_footage: boolean;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const {
      chunk_type = "idta",
      item_type = 0,
      reserved_02 = new Uint8Array(14),
      item_id = 0,
      flags_14 = new Uint8Array(2),
      proxy_flags = 0,
      flags_17 = 0,
      reserved_18 = new Uint8Array(32),
      proxy_active = 0,
      reserved_39 = new Uint8Array(1),
      label = 0,
      reserved_3c = new Uint8Array(21),
      modified_stamp = 0,
    } = kw;
    this.chunk_type = chunk_type;
    this.item_type = item_type;
    this._reserved_02 = reserved_02;
    this.item_id = item_id;
    this._flags_14 = flags_14;
    this._proxy_flags = proxy_flags;
    this._flags_17 = flags_17;
    this._reserved_18 = reserved_18;
    this._proxy_active = proxy_active;
    this._reserved_39 = reserved_39;
    this.label = label;
    this._reserved_3c = reserved_3c;
    this._modified_stamp = modified_stamp;
  }

  /**
   * Item time stamp, as a Unix timestamp (`0` when unstamped).
   *
   * For file footage AE stores the last-modified time of the file in
   * use (the proxy's while a file proxy is active); for other items it
   * stores the time of the item's last edit.
   */
  get modified_time(): number {
    const stamp = this._modified_stamp;
    return stamp ? stamp - MAC_EPOCH_OFFSET : 0;
  }

  set modified_time(value: number) {
    this._modified_stamp = value ? value + MAC_EPOCH_OFFSET : 0;
  }
}
define(IdtaChunk, {
  chunk_type: field({ default: "idta" }),
  item_type: u2_field(),
  _reserved_02: bytes_field(14, { repr: false }),
  item_id: u4_field(),
  _flags_14: bytes_field(2, { repr: false }),
  _proxy_flags: u1_field({ repr: false }),
  _flags_17: u1_field({ repr: false }),
  _reserved_18: bytes_field(32, { repr: false }),
  _proxy_active: u1_field({ repr: false }),
  _reserved_39: bytes_field(1, { repr: false }),
  label: u1_field(),
  _reserved_3c: bytes_field(21, { repr: false }),
  _modified_stamp: u4_field({ repr: false }),
}, { init: false });
register("idta")(IdtaChunk);
// -- BitField descriptors (not attrs fields) ---------------------------
descriptor(IdtaChunk, "use_proxy", new BitField("_proxy_flags", 0));
descriptor(IdtaChunk, "is_solid", new BitField("_flags_17", 4));
descriptor(IdtaChunk, "is_footage", new BitField("_flags_17", 5));

// ---------------------------------------------------------------------------
// idpc - item project context (8 bytes)
// ---------------------------------------------------------------------------

/** Item project context chunk (8 bytes). */
export class IdpcChunk extends Chunk {
  declare chunk_type: string;
  declare data: Uint8Array;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "idpc", data = bytes_.repeat(b("\x00"), 8) } = kw;
    this.chunk_type = chunk_type;
    this.data = data;
  }
}
define(IdpcChunk, {
  chunk_type: field({ default: "idpc" }),
  data: field({ default: bytes_.repeat(b("\x00"), 8) }),
}, { init: false });
register("idpc")(IdpcChunk);

// ---------------------------------------------------------------------------
// head - file header / version (28 bytes)
// ---------------------------------------------------------------------------
//
// Version bitfield layout (32 bits, MSB first):
//   bit  31      : reserved
//   bits 30-26   : ae_version_major_a  (5 bits)
//   bits 25-22   : ae_version_os       (4 bits)
//   bits 21-19   : ae_version_major_b  (3 bits)
//   bits 18-15   : ae_version_minor    (4 bits)
//   bits 14-11   : ae_version_patch    (4 bits)
//   bit  10      : reserved
//   bit   9      : ae_version_beta_flag (0=beta, 1=release)
//   bit   8      : reserved
//   bits  7-0    : ae_build_number     (8 bits)

/**
 * The (file format version, minor) pair After Effects stamps when saving a
 * project for each release. 15 and 23-26 match projects those releases saved
 * (samples/versions); 16-18 and 22 are the pairs AE writes when it saves for
 * them (an early 22.x build saved samples/versions/ae2022 as 93.40). Its keys
 * are the majors py_aep can write a project for (there was no AE 19-21).
 */
export const FORMAT_VERSIONS: Map<number, [number, number]> = new Map<number, [number, number]>([
  [15, [92, 14]],
  [16, [93, 5]],
  [17, [93, 22]],
  [18, [93, 29]],
  [22, [93, 43]],
  [23, [94, 9]],
  [24, [95, 6]],
  [25, [96, 9]],
  [26, [97, 2]],
]);

/** An After Effects version string, `"{major}.{minor}x{build}"`. */
export const AE_VERSION_RE = py_re(String.raw`^(\d+)\.(\d+)x(\d+)$`);

export class HeadChunk extends Chunk {
  declare chunk_type: string;
  declare _reserved_00a: Uint8Array;
  /**
   * Project file-format version AE checks when opening: it refuses files
   * whose value exceeds the running app's own. Equals the AE major version
   * plus 71 for AE 2022+ (e.g. 0x61=97 for AE 26).
   */
  declare file_format_version: number;
  declare _reserved_00c: Uint8Array;
  declare _format_subversion: number;
  // Fresh-project default: OS=12 (Windows, bits 25-22), the reserved bit 10
  // AE always sets on save, and bit 9=1 (release, not beta). The version
  // bits (major/minor/build) are stamped by the `version` setter, which
  // preserves these.
  declare _version_word: number;
  declare _reserved_08: Uint8Array;
  /** Next item ID to allocate, always \> max existing item ID. */
  declare next_item_id: number;
  /** File revision counter (32-bit), incremented on each user action. */
  declare file_revision: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const {
      chunk_type = "head",
      reserved_00a = new Uint8Array(1),
      file_format_version = 0x61,
      reserved_00c = new Uint8Array(1),
      format_subversion = 0x02,
      version_word = (12 << 22) | (1 << 10) | (1 << 9),
      reserved_08 = b("\x80\x00\x00\x00"),
      next_item_id = 1,
      file_revision = 1,
    } = kw;
    this.chunk_type = chunk_type;
    this._reserved_00a = reserved_00a;
    this.file_format_version = file_format_version;
    this._reserved_00c = reserved_00c;
    this._format_subversion = format_subversion;
    this._version_word = version_word;
    this._reserved_08 = reserved_08;
    this.next_item_id = next_item_id;
    this.file_revision = file_revision;
  }

  get ae_version_major_a(): number {
    return and(rshift(this._version_word, 26), 0x1f);
  }

  set ae_version_major_a(value: number) {
    this._version_word = or(and_not(this._version_word, lshift(0x1f, 26)), lshift(and(value, 0x1f), 26));
  }

  get ae_version_major_b(): number {
    return and(rshift(this._version_word, 19), 0x07);
  }

  set ae_version_major_b(value: number) {
    this._version_word = or(and_not(this._version_word, lshift(0x07, 19)), lshift(and(value, 0x07), 19));
  }

  get ae_version_minor(): number {
    return and(rshift(this._version_word, 15), 0x0f);
  }

  set ae_version_minor(value: number) {
    this._version_word = or(and_not(this._version_word, lshift(0x0f, 15)), lshift(and(value, 0x0f), 15));
  }

  /** Raw flag: False=beta, True=release. */
  get ae_version_beta_flag(): boolean {
    return and(rshift(this._version_word, 9), 1) !== 0;
  }

  set ae_version_beta_flag(value: boolean | number) {
    if (value) {
      this._version_word = or(this._version_word, 1 << 9);
    } else {
      this._version_word = and_not(this._version_word, 1 << 9);
    }
  }

  get ae_build_number(): number {
    return and(this._version_word, 0xff);
  }

  set ae_build_number(value: number) {
    this._version_word = or(and_not(this._version_word, 0xff), and(value, 0xff));
  }

  /** OS code (bits 25-22); 12 for Windows in saved files. */
  get ae_version_os(): number {
    return and(rshift(this._version_word, 22), 0x0f);
  }

  set ae_version_os(value: number) {
    this._version_word = or(and_not(this._version_word, lshift(0x0f, 22)), lshift(and(value, 0x0f), 22));
  }

  /** Full major version (e.g. 25). */
  get ae_version_major(): number {
    return this.ae_version_major_a * 8 + this.ae_version_major_b;
  }

  /** AE version as `major.minorxbuild` (e.g. '25.6x101'). */
  get version(): string {
    return `${this.ae_version_major}.${this.ae_version_minor}x${this.ae_build_number}`;
  }

  set version(value: string) {
    const m = AE_VERSION_RE.exec(value);
    if (!m) {
      throw new ValueError(`Invalid version format: ${repr(value)}`);
    }
    const [major, minor, build] = [int(m[1]!), int(m[2]!), int(m[3]!)];
    this.ae_version_major_a = floordiv(major, 8);
    this.ae_version_major_b = mod(major, 8);
    this.ae_version_minor = minor;
    this.ae_build_number = build;
  }

  /**
   * Stamp `file_format_version` (the open-compatibility gate) and its
   * minor for the current major version, as After Effects saves for that
   * release (`FORMAT_VERSIONS`). AE opens a file whose format version is
   * at most its own and reads it with the rules of the (format, minor)
   * pair, so a major with no release to take a stamp from (a newer AE,
   * or one that never existed) keeps the current pair: a derived pair
   * (AE 2026 measured on `py_aep.new` 12-14 and 19-21) makes AE misread
   * every property name or reject the file, while the version word
   * alone does not matter to it (AE 2026 opens projects relabelled 0,
   * 12, 20, 21, 27, 99 and 255 with their own pair kept).
   */
  sync_file_format_version(): void {
    const pair = FORMAT_VERSIONS.get(this.ae_version_major) ?? null;
    if (pair != null) {
      [this.file_format_version, this._format_subversion] = pair;
    }
  }
}
define(HeadChunk, {
  chunk_type: field({ default: "head" }),
  // Defaults capture a fresh AE 2026 project (see project_chunks.py).
  _reserved_00a: bytes_field(1, { repr: false }),
  file_format_version: u1_field({ default: 0x61 }),
  _reserved_00c: bytes_field(1, { repr: false }),
  _format_subversion: u1_field({ default: 0x02, repr: false }),
  _version_word: u4_field({ default: (12 << 22) | (1 << 10) | (1 << 9), repr: false }),
  _reserved_08: bytes_field(4, { default: b("\x80\x00\x00\x00"), repr: false }),
  next_item_id: u4_field({ default: 1, repr: false }),
  file_revision: u4_field({ default: 1 }),
}, { init: false });
register("head")(HeadChunk);

// ---------------------------------------------------------------------------
// nhed - compact project settings mirror (32 bytes)
// ---------------------------------------------------------------------------

/**
 * Compact root-level mirror for selected project settings.
 *
 * Sample comparisons show that several `nnhd` display settings are
 * mirrored here at more compact offsets. Some bytes still have
 * unknown semantics and are preserved exactly.
 */
export class NhedChunk extends Chunk {
  declare chunk_type: string;
  declare _reserved_00: Uint8Array;
  declare _display_byte: number;
  declare footage_timecode_display_start_type: number;
  declare _reserved_0a: Uint8Array;
  declare _feet_byte: number;
  declare timecode_default_base: number;
  declare _reserved_0d: Uint8Array;
  declare frames_count_type: number;
  declare bits_per_channel: number;
  declare transparency_grid_thumbnails: boolean;
  declare _reserved_11: Uint8Array;

  declare feet_frames_film_type: boolean;
  declare frames_use_feet_frames: boolean;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const {
      chunk_type = "nhed",
      reserved_00 = bytes_.concat(bytes_.repeat(b("\x00"), 7), b("\x05")),
      display_byte = 0,
      footage_timecode_display_start_type = 1,
      reserved_0a = b("\x01"),
      feet_byte = 0,
      timecode_default_base = 30,
      reserved_0d = b("\x10"),
      frames_count_type = 2,
      bits_per_channel = 0,
      transparency_grid_thumbnails = false,
      reserved_11 = new Uint8Array(15),
    } = kw;
    this.chunk_type = chunk_type;
    this._reserved_00 = reserved_00;
    this._display_byte = display_byte;
    this.footage_timecode_display_start_type = footage_timecode_display_start_type;
    this._reserved_0a = reserved_0a;
    this._feet_byte = feet_byte;
    this.timecode_default_base = timecode_default_base;
    this._reserved_0d = reserved_0d;
    this.frames_count_type = frames_count_type;
    this.bits_per_channel = bits_per_channel;
    this.transparency_grid_thumbnails = transparency_grid_thumbnails;
    this._reserved_11 = reserved_11;
  }

  /** Time display type (0=TIMECODE, 1=FRAMES). */
  get time_display_type(): number {
    return this._display_byte & 0x7f;
  }

  set time_display_type(value: number) {
    this._display_byte = (this._display_byte & 0x80) | (value & 0x7f);
  }

  get display_start_frame(): number {
    return mod(this.frames_count_type, 2);
  }

  set display_start_frame(value: number) {
    this.frames_count_type = value;
  }
}
define(NhedChunk, {
  chunk_type: field({ default: "nhed" }),
  // Defaults capture a fresh AE 2026 project (see project_chunks.py).
  _reserved_00: bytes_field(8, { default: bytes_.concat(bytes_.repeat(b("\x00"), 7), b("\x05")), repr: false }),
  _display_byte: u1_field({ repr: false }),
  footage_timecode_display_start_type: u1_field({ default: 1 }),
  _reserved_0a: bytes_field(1, { default: b("\x01"), repr: false }),
  _feet_byte: u1_field({ repr: false }),
  timecode_default_base: u1_field({ default: 30 }),
  _reserved_0d: bytes_field(1, { default: b("\x10"), repr: false }),
  frames_count_type: u1_field({ default: 2 }),
  bits_per_channel: u1_field(),
  transparency_grid_thumbnails: bool_field(),
  _reserved_11: bytes_field(15, { repr: false }),
}, { init: false });
register("nhed")(NhedChunk);
descriptor(NhedChunk, "feet_frames_film_type", new BitField("_display_byte", 7));
descriptor(NhedChunk, "frames_use_feet_frames", new BitField("_feet_byte", 0));

// ---------------------------------------------------------------------------
// nnhd - project display settings (40 bytes)
// ---------------------------------------------------------------------------

/**
 * Project display settings.
 *
 * Contains time display format, frame count settings, color depth,
 * and various toggle flags.
 */
export class NnhdChunk extends Chunk {
  declare chunk_type: string;
  declare _reserved_00: Uint8Array;
  /**
   * Byte 2: 0x08 when After Effects on macOS saved the project, 0 on
   * Windows (AE rewrites it on every save).
   */
  declare _saving_platform: number;
  declare _reserved_03: Uint8Array;
  /** Byte 8: bit 7 = feet_frames_film_type, bits 6-0 = time_display_type. */
  declare _display_byte: number;
  declare footage_timecode_display_start_type: number;
  declare _reserved_0a: number;
  /** Byte 11: bit 0 = frames_use_feet_frames. */
  declare _feet_byte: number;
  declare _reserved_0c: Uint8Array;
  declare timecode_default_base: number;
  declare _unknown_10: Uint8Array;
  declare frames_count_type: number;
  declare _reserved_15: Uint8Array;
  declare bits_per_channel: number;
  declare transparency_grid_thumbnails: boolean;
  /**
   * Bytes 0x1A-0x1B: the saving system's text encoding - Windows code
   * page 1252 up to AE 25 and 65001 (UTF-8) from AE 26, 0x0100 on macOS
   * (AE rewrites it on every save).
   */
  declare _system_code_page: number;
  declare _unknown_1c: Uint8Array;

  // -- Bit-level accessors (not attrs fields) ----------------------------
  declare feet_frames_film_type: boolean;
  declare frames_use_feet_frames: boolean;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const {
      chunk_type = "nnhd",
      reserved_00 = new Uint8Array(2),
      saving_platform = 0,
      reserved_03 = bytes_.concat(bytes_.repeat(b("\x00"), 4), b("\x05")),
      display_byte = 0,
      footage_timecode_display_start_type = 1,
      reserved_0a = 1,
      feet_byte = 0,
      reserved_0c = new Uint8Array(2),
      timecode_default_base = 30,
      unknown_10 = b("\x00\x00\x00\x10"),
      frames_count_type = 2,
      reserved_15 = new Uint8Array(3),
      bits_per_channel = 0,
      transparency_grid_thumbnails = false,
      system_code_page = 0,
      unknown_1c = new Uint8Array(12),
    } = kw;
    this.chunk_type = chunk_type;
    this._reserved_00 = reserved_00;
    this._saving_platform = saving_platform;
    this._reserved_03 = reserved_03;
    this._display_byte = display_byte;
    this.footage_timecode_display_start_type = footage_timecode_display_start_type;
    this._reserved_0a = reserved_0a;
    this._feet_byte = feet_byte;
    this._reserved_0c = reserved_0c;
    this.timecode_default_base = timecode_default_base;
    this._unknown_10 = unknown_10;
    this.frames_count_type = frames_count_type;
    this._reserved_15 = reserved_15;
    this.bits_per_channel = bits_per_channel;
    this.transparency_grid_thumbnails = transparency_grid_thumbnails;
    this._system_code_page = system_code_page;
    this._unknown_1c = unknown_1c;
  }

  /** Time display type (0=TIMECODE, 1=FRAMES). */
  get time_display_type(): number {
    return this._display_byte & 0x7f;
  }

  set time_display_type(value: number) {
    this._display_byte = (this._display_byte & 0x80) | (value & 0x7f);
  }

  get display_start_frame(): number {
    return mod(this.frames_count_type, 2);
  }

  set display_start_frame(value: number) {
    this.frames_count_type = value;
  }
}
define(NnhdChunk, {
  chunk_type: field({ default: "nnhd" }),
  // Defaults capture a fresh AE 2026 project (see project_chunks.py).
  _reserved_00: bytes_field(2, { repr: false }),
  _saving_platform: u1_field({ repr: false }),
  _reserved_03: bytes_field(5, { default: bytes_.concat(bytes_.repeat(b("\x00"), 4), b("\x05")), repr: false }),
  _display_byte: u1_field({ repr: false }),
  footage_timecode_display_start_type: u1_field({ default: 1 }),
  _reserved_0a: u1_field({ default: 1, repr: false }),
  _feet_byte: u1_field({ repr: false }),
  _reserved_0c: bytes_field(2, { repr: false }),
  timecode_default_base: u2_field({ default: 30 }),
  _unknown_10: bytes_field(4, { default: b("\x00\x00\x00\x10"), repr: false }),
  frames_count_type: u1_field({ default: 2 }),
  _reserved_15: bytes_field(3, { repr: false }),
  bits_per_channel: u1_field(),
  transparency_grid_thumbnails: bool_field(),
  _system_code_page: u2_field({ repr: false }),
  _unknown_1c: bytes_field(12, { repr: false }),
}, { init: false });
register("nnhd")(NnhdChunk);
// -- Bit-level accessors (not attrs fields) ----------------------------
descriptor(NnhdChunk, "feet_frames_film_type", new BitField("_display_byte", 7));
descriptor(NnhdChunk, "frames_use_feet_frames", new BitField("_feet_byte", 0));

// ---------------------------------------------------------------------------
// Project time-display preference blob (preferences only, not in .aep files)
// ---------------------------------------------------------------------------

/**
 * The "Project Settings Time Display Format" preferences value (16 bytes).
 *
 * Mirrors the `nnhd` time-display settings cluster (AE stamps the
 * last-used Project Settings into this machine-specific preference and
 * new projects inherit it). Field defaults reproduce a factory AE 2026
 * preferences file.
 */
export class TimeDisplayPrefItem extends FmtItem {
  /** Bit 7 = feet_frames_film_type, bits 6-0 = time_display_type. */
  declare display_byte: number;
  declare footage_timecode_display_start_type: number;
  declare _reserved_02: number;
  /** Bit 0 = frames_use_feet_frames. */
  declare feet_byte: number;
  declare timecode_default_base: number;
  declare _reserved_08: number;
  declare frames_count_type: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const {
      display_byte = 0,
      footage_timecode_display_start_type = 1,
      reserved_02 = 1,
      feet_byte = 0,
      timecode_default_base = 30,
      reserved_08 = 16,
      frames_count_type = 2,
    } = kw;
    this.display_byte = display_byte;
    this.footage_timecode_display_start_type = footage_timecode_display_start_type;
    this._reserved_02 = reserved_02;
    this.feet_byte = feet_byte;
    this.timecode_default_base = timecode_default_base;
    this._reserved_08 = reserved_08;
    this.frames_count_type = frames_count_type;
  }
}
define(TimeDisplayPrefItem, {
  display_byte: u1_field(),
  footage_timecode_display_start_type: u1_field({ default: 1 }),
  _reserved_02: u1_field({ default: 1, repr: false }),
  feet_byte: u1_field(),
  timecode_default_base: u4_field({ default: 30, endian: "<" }),
  _reserved_08: u4_field({ default: 16, endian: "<", repr: false }),
  frames_count_type: u4_field({ default: 2, endian: "<" }),
}, { init: false });

// ---------------------------------------------------------------------------
// cmta - item comment (variable-length, null-terminated UTF-8)
// ---------------------------------------------------------------------------

/**
 * Comment chunk: null-terminated UTF-8, CRLF line endings.
 *
 * `data` holds the raw bytes (roundtrip-safe). The `value` property
 * decodes to normalised text (LF, no null). Setting `value` encodes
 * back with CRLF and a double-null terminator, matching AE's convention.
 */
export class CmtaChunk extends Chunk {
  declare chunk_type: string;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "cmta" } = kw;
    this.chunk_type = chunk_type;
  }

  /** Decoded comment text, LF line endings, no trailing null. */
  get value(): string {
    return split(decode(this.data, "UTF-8"), "\x00")[0].replaceAll("\r\n", "\n");
  }

  set value(text: string) {
    // AE always writes a double-null terminator inside the chunk data.
    const encoded = encode(text.replaceAll("\n", "\r\n") + "\x00\x00", "UTF-8");
    object_setattr(this, "data", encoded);
  }
}
define(CmtaChunk, {
  chunk_type: field({ default: "cmta" }),
}, { init: false });
register("cmta")(CmtaChunk);
