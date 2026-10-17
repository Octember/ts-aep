/**
 * Simple scalar and string chunk types.
 *
 * Each class wraps a single value (int, float, or str) and is registered
 * for one or more chunk_type strings via the multi-key `@register` decorator.
 *
 * Integer and float chunks use `fmt_field()` to declare their binary format
 * inline - the generic `Chunk.read()` / `write()` handles I/O.
 * String chunks keep a custom `read()` / `write()` (they use encoding, not struct).
 */

import { define, field, decode, encode } from "../../pyrt/index.ts";
import type { IO } from "../../pyrt/index.ts";
import { read_bytes, write_bytes } from "./bin_utils.ts";
import { Chunk } from "./chunk.ts";
import { f8_field, s2_field, s4_field, u1_field, u2_field, u4_field } from "./fmt_field.ts";
import { register } from "./registry.ts";

// ---------------------------------------------------------------------------
// String base (encoding-based, custom read/write)
// ---------------------------------------------------------------------------

/** Base for variable-length string chunks. */
export class _StringChunkBase extends Chunk {
  static _ENCODING = "";

  declare value: string;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { value = "" } = kw;
    this.value = value;
  }

  static read(
    fp: IO,
    size: number,
    kwargs: { chunk_type?: string; [k: string]: any } = {},
  ): _StringChunkBase {
    const { chunk_type = "" } = kwargs;
    const cls: any = this;
    const raw = read_bytes(fp, size);
    return new cls({ chunk_type, value: decode(raw, cls._ENCODING) });
  }

  write(fp: IO): number {
    return write_bytes(
      fp,
      encode(this.value, (this.constructor as typeof _StringChunkBase)._ENCODING),
    );
  }
}
define(_StringChunkBase, {
  value: field({ default: "" }),
}, { init: false });

// ---------------------------------------------------------------------------
// Integer chunks (fmt_field declarative - no read/write override)
// ---------------------------------------------------------------------------

/** Unsigned 1-byte integer chunk. */
export class U1Chunk extends Chunk {
  declare value: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { value = 0 } = kw;
    this.value = value;
  }
}
define(U1Chunk, {
  value: u1_field(),
}, { init: false });
register(
  "efdc",
  "acer",
  "cdrp",
  "foac",
  "fiac",
  "fiop",
  "lnrb",
  "lnrp",
  "qtlg",
  "pcms",
  "PwCs",
  "pdvc",
)(U1Chunk);

/** Unsigned 2-byte integer chunk. */
export class U2Chunk extends Chunk {
  declare value: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { value = 0 } = kw;
    this.value = value;
  }
}
define(U2Chunk, {
  value: u2_field(),
}, { init: false });
register("oacc")(U2Chunk);

/** Signed 2-byte integer chunk. */
export class S2Chunk extends Chunk {
  declare value: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { value = 0 } = kw;
    this.value = value;
  }
}
define(S2Chunk, {
  value: s2_field(),
}, { init: false });
register("fivc", "fipc")(S2Chunk);

/** Unsigned 4-byte integer chunk. */
export class U4Chunk extends Chunk {
  declare value: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { value = 0 } = kw;
    this.value = value;
  }
}
define(U4Chunk, {
  value: u4_field(),
}, { init: false });
register(
  "CapL",
  "CCId",
  "CLId",
  "CSMd",
  "CSMe",
  "CSMh",
  "CSMs",
  "CSMt",
  "CSMw",
  "CTyp",
  "blsi",
  "blsv",
  "fovi",
  "fivi",
  "fcid",
  "fvdv",
  "ftts",
  "fifl",
)(U4Chunk);

/**
 * Unsigned 4-byte integer chunk, little-endian inside the big-endian file.
 *
 * `iide` echoes the item id. `sfid` / `mrid` hold the item id of the folder
 * After Effects files new items into (the Solids folder / the Media
 * Replacement Comps folder), 0 when there is none. `StVS` is the file count
 * heading the `LIST:StVc` of an alphabetical image sequence, followed by one
 * `Utf8` file name per frame.
 */
export class U4LeChunk extends Chunk {
  declare value: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { value = 0 } = kw;
    this.value = value;
  }
}
define(U4LeChunk, {
  value: u4_field({ endian: "<" }),
}, { init: false });
register("iide", "mrid", "sfid", "StVS")(U4LeChunk);

/**
 * Signed 4-byte integer chunk.
 *
 * `CprC` is big-endian inside `LIST:CCtl` but little-endian inside
 * `LIST:OvG2` (a layer override count: `03 00 00 00` for three
 * `LIST:CPrp`). py_aep never reads that count and writes it only as 0,
 * so `value` is meaningful for the `LIST:CCtl` copy alone.
 */
export class S4Chunk extends Chunk {
  declare value: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { value = 0 } = kw;
    this.value = value;
  }
}
define(S4Chunk, {
  value: s4_field(),
}, { init: false });
register("tdli", "tdpi", "tdps", "CcCt", "CprC", "parn")(S4Chunk);

// ---------------------------------------------------------------------------
// Float chunks
// ---------------------------------------------------------------------------

/** 8-byte double-precision float chunk. */
export class F8Chunk extends Chunk {
  declare value: number;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { value = 0.0 } = kw;
    this.value = value;
  }
}
define(F8Chunk, {
  value: f8_field({ default: 0.0 }),
}, { init: false });
register("Smax", "Smin", "adfr", "ppSn")(F8Chunk);

// ---------------------------------------------------------------------------
// String chunks (concrete)
// ---------------------------------------------------------------------------

/** Variable-length UTF-8 string chunk. */
export class Utf8Chunk extends _StringChunkBase {
  static _ENCODING = "UTF-8";

  declare chunk_type: string;

  constructor(kw: Record<string, any> = {}) {
    super(kw);
    const { chunk_type = "Utf8" } = kw;
    this.chunk_type = chunk_type;
  }
}
define(Utf8Chunk, {
  chunk_type: field({ default: "Utf8" }),
}, { init: false });
register("alas", "pjef", "Utf8")(Utf8Chunk);

/** Variable-length ASCII string chunk. */
export class AsciiChunk extends _StringChunkBase {
  static _ENCODING = "ASCII";

  constructor(kw: Record<string, any> = {}) {
    super(kw);
  }
}
define(AsciiChunk, {}, { init: false });
register("fitt")(AsciiChunk);
