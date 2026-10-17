/**
 * Root-level project chunk types used when building a new project.
 *
 * These chunks appear once at the top of the `RIFX` of every `.aep` and
 * are otherwise opaque to py_aep. They are modelled here with best-guess
 * `fmt_field`s and fresh-project defaults (captured from an AE 2026 empty
 * project) so `Project._new()` can build a valid skeleton by instantiating
 * them with no arguments. See `scripts/dev/dump_new_project.py`.
 */

import { b, bytes_, define, encode, field } from "../../pyrt/index.ts";
import { Chunk } from "./chunk.ts";
import { bytes_field, s2_field, u1_field, u2_field, u4_field } from "./fmt_field.ts";
import { register } from "./registry.ts";

// ---------------------------------------------------------------------------
// svap - save-app marker (4 bytes); byte 3 tracks the AE build number
// ---------------------------------------------------------------------------

/**
 * Top-of-file marker (4 bytes).
 *
 * The last byte is the AE build number; the leading 3 bytes are stable
 * for AE 2024+ (AE's open gate keys off `head.file_format_version`, not
 * svap).
 */
export class SvapChunk extends Chunk {
  declare chunk_type: string;
  declare _prefix: Uint8Array;
  declare build_number: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "svap", prefix = b("\x0f\x10\x06"), build_number = 0x43 } = kw;
    this.chunk_type = chunk_type;
    this._prefix = prefix;
    this.build_number = build_number;
  }
}
define(SvapChunk, {
  chunk_type: field({ default: "svap" }),
  _prefix: bytes_field(3, { default: b("\x0f\x10\x06"), repr: false }),
  build_number: u1_field({ default: 0x43 }),
}, { init: false });
register("svap")(SvapChunk);

// ---------------------------------------------------------------------------
// cpid - working-space ICC profile id (16 bytes)
// ---------------------------------------------------------------------------

/**
 * Working-space profile id (16 bytes): the ICC Profile ID (ISO
 * 15076-1 MD5) of the working color space, whose ICC is embedded after
 * `PwCs` (AE 22+) or kept in `LIST:CPPl` (older files). All `0xFF` when
 * the working space is None or the project uses OCIO; a new project
 * has no working space.
 */
export class CpidChunk extends Chunk {
  declare chunk_type: string;
  declare data: Uint8Array;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "cpid", data = bytes_.repeat(b("\xff"), 16) } = kw;
    this.chunk_type = chunk_type;
    this.data = data;
  }
}
define(CpidChunk, {
  chunk_type: field({ default: "cpid" }),
  data: field({ default: bytes_.repeat(b("\xff"), 16) }),
}, { init: false });
register("cpid")(CpidChunk);

// ---------------------------------------------------------------------------
// fdta - root folder data (14 bytes)
// ---------------------------------------------------------------------------

/**
 * Root folder descriptor (14 bytes).
 *
 * The leading 10 bytes are zero; the 4-byte tail is an opaque
 * folder-state value that varies per file (AE rewrites it on save).
 */
export class FdtaChunk extends Chunk {
  declare chunk_type: string;
  declare _reserved_00: Uint8Array;
  declare _tail: Uint8Array;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const {
      chunk_type = "fdta",
      reserved_00 = new Uint8Array(10),
      tail = b("\x1f\x44\x84\x00"),
    } = kw;
    this.chunk_type = chunk_type;
    this._reserved_00 = reserved_00;
    this._tail = tail;
  }
}
define(FdtaChunk, {
  chunk_type: field({ default: "fdta" }),
  _reserved_00: bytes_field(10, { repr: false }),
  _tail: bytes_field(4, { default: b("\x1f\x44\x84\x00"), repr: false }),
}, { init: false });
register("fdta")(FdtaChunk);

// ---------------------------------------------------------------------------
// Rhed - render queue header (20 bytes)
// ---------------------------------------------------------------------------

/** Render queue header (`LRdr/Rhed`, 20 bytes). */
export class RhedChunk extends Chunk {
  declare chunk_type: string;
  declare _a: number;
  declare _b: number;
  declare _c: number;
  declare _d: number;
  declare _uid: number;
  declare _e: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "Rhed", a = 1, b = 2, c = 0, d = 0, uid = 0x03e2076c, e = 1 } = kw;
    this.chunk_type = chunk_type;
    this._a = a;
    this._b = b;
    this._c = c;
    this._d = d;
    this._uid = uid;
    this._e = e;
  }
}
define(RhedChunk, {
  chunk_type: field({ default: "Rhed" }),
  _a: u2_field({ default: 1, repr: false }),
  _b: u2_field({ default: 2, repr: false }),
  _c: u4_field({ repr: false }),
  _d: u4_field({ repr: false }),
  // Render-queue identity captured from one empty project. The fixed default
  // is intentional: it keeps py_aep.new() output deterministic, and AE
  // rewrites render-queue state on save - so every generated file sharing
  // this value is inert (it is not a cross-file item/project id).
  _uid: u4_field({ default: 0x03e2076c, repr: false }),
  _e: u4_field({ default: 1, repr: false }),
}, { init: false });
register("Rhed")(RhedChunk);

// ---------------------------------------------------------------------------
// wsns - workspace-name byte length (S2); wsnm - workspace name (UTF-16-LE)
// ---------------------------------------------------------------------------

/**
 * Workspace-name byte length (2 bytes).
 *
 * Holds the byte length of the following `wsnm` chunk. A fresh project's
 * `"Default"` workspace name is 14 bytes in UTF-16-LE.
 */
export class WsnsChunk extends Chunk {
  declare chunk_type: string;
  declare value: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "wsns", value = 14 } = kw;
    this.chunk_type = chunk_type;
    this.value = value;
  }
}
define(WsnsChunk, {
  chunk_type: field({ default: "wsns" }),
  value: s2_field({ default: 14 }),
}, { init: false });
register("wsns")(WsnsChunk);

/** Workspace name (variable length, UTF-16-LE). Fresh projects use `"Default"`. */
export class WsnmChunk extends Chunk {
  declare chunk_type: string;
  declare data: Uint8Array;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "wsnm", data = encode("Default", "utf-16-le") } = kw;
    this.chunk_type = chunk_type;
    this.data = data;
  }
}
define(WsnmChunk, {
  chunk_type: field({ default: "wsnm" }),
  data: field({ default: encode("Default", "utf-16-le") }),
}, { init: false });
register("wsnm")(WsnmChunk);
