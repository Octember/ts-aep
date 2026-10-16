/**
 * Field layouts of chunks whose widths, byte order or signs After Effects
 * fixes (decoded values; the bytes round-trip unchanged).
 */

import { describe, expect, test } from "bun:test";
import "../../src/py_aep/binary/_register.ts";
import type { Chunk } from "../../src/py_aep/binary/chunk.ts";
import { CsctChunk } from "../../src/py_aep/binary/composition_chunks.ts";
import { LdtaChunk } from "../../src/py_aep/binary/layer_chunks.ts";
import { WsnsChunk } from "../../src/py_aep/binary/project_chunks.ts";
import { Tdb4Chunk, TdsbChunk } from "../../src/py_aep/binary/property_chunks.ts";
import { CHUNK_TYPES } from "../../src/py_aep/binary/registry.ts";
import { BytesIO, b, getitem, len, py_assert, py_eq, struct } from "../../src/pyrt/index.ts";

function _read(chunk_type: string, body: Uint8Array): Chunk {
  const cls = getitem(CHUNK_TYPES, chunk_type);
  const chunk = cls.read(new BytesIO(body), len(body), { chunk_type });
  const out = new BytesIO();
  chunk.write(out);
  py_assert(py_eq(out.getvalue(), body));
  return chunk;
}

/**
 * `CsCt`, `sfid` and `mrid` are little-endian inside the big-endian file
 * (`sfid` holds the Solids folder's item id, `mrid` the Media Replacement
 * Comps folder's).
 */
describe("TestLittleEndianAtoms", () => {
  test("test_csct", () => {
    const chunk = _read("CsCt", b("\x02\x00\x00\x00"));
    expect(chunk instanceof CsctChunk).toBe(true);
    expect((chunk as CsctChunk).value).toBe(2);
    expect(py_eq(new CsctChunk().tobytes(), b("\x01\x00\x00\x00"))).toBe(true);
  });

  test("test_sfid_and_mrid", () => {
    expect((_read("sfid", b("\x0d\x00\x00\x00")) as any).value).toBe(13);
    expect((_read("mrid", b("\x1d\x00\x00\x00")) as any).value).toBe(29);
  });
});

/**
 * `CcCt`, `CprC`, `parn`, `fipc`, `fivc` and `wsns` are signed.
 */
describe("TestSignedCounters", () => {
  test("test_four_byte", () => {
    for (const tag of ["CcCt", "CprC", "parn"]) {
      expect((_read(tag, b("\xff\xff\xff\xff")) as any).value).toBe(-1);
    }
  });

  test("test_two_byte", () => {
    for (const tag of ["fipc", "fivc"]) {
      expect((_read(tag, b("\xff\xfe")) as any).value).toBe(-2);
    }
    const chunk = _read("wsns", b("\x00\x0e"));
    expect(chunk instanceof WsnsChunk).toBe(true);
    expect((chunk as WsnsChunk).value).toBe(14);
  });
});

/**
 * ldta 0x70 and 0x78 are doubles (0.0 in every sample), 0x8C-0x9F three
 * words and a double.
 */
describe("TestLdtaDoubles", () => {
  test("test_layout", () => {
    const body = new Uint8Array(new LdtaChunk().tobytes());
    struct.pack_into(">dd", body, 0x70, 1.5, -2.25);
    struct.pack_into(">IIId", body, 0x8c, 1, 0x01000000, 1, 36.0);
    const chunk = _read("ldta", body);
    expect(chunk instanceof LdtaChunk).toBe(true);
    expect((chunk as LdtaChunk)._reserved_70).toBe(1.5);
    expect((chunk as LdtaChunk)._reserved_78).toBe(-2.25);
    expect(
      py_eq(
        [(chunk as LdtaChunk)._reserved_8c, (chunk as LdtaChunk)._reserved_90, (chunk as LdtaChunk)._reserved_94],
        [1, 0x01000000, 1],
      ),
    ).toBe(true);
    expect((chunk as LdtaChunk)._reserved_98).toBe(36.0);
  });
});

/**
 * tdb4 0x48 is one word (a time in units or 0x80000000 in the
 * samples), 0x4C/0x4D bytes, and 0x54-0x73 four doubles.
 */
describe("TestTdb4Layout", () => {
  test("test_layout", () => {
    const body = new Uint8Array(new Tdb4Chunk().tobytes());
    struct.pack_into(">I", body, 0x48, 0x0000a800);
    body[0x4c] = 3;
    body[0x4d] = 1;
    struct.pack_into(">dddd", body, 0x54, 0.0, 0.16666666667, 0.0, 0.5);
    const chunk = _read("tdb4", body);
    expect(chunk instanceof Tdb4Chunk).toBe(true);
    expect((chunk as Tdb4Chunk)._reserved_48).toBe(0xa800);
    expect(py_eq([(chunk as Tdb4Chunk)._reserved_4c, (chunk as Tdb4Chunk)._reserved_4d], [3, 1])).toBe(true);
    expect((chunk as Tdb4Chunk)._reserved_5c).toBe(0.16666666667);
    expect((chunk as Tdb4Chunk)._reserved_6c).toBe(0.5);
  });
});

/**
 * Lock-byte bit 5 (bit 13 of the flags word) is set when a Scale or
 * Mask Feather's dimensions are unlinked; bit 4 is never saved.
 */
describe("TestTdsbRatioLink", () => {
  test("test_unlinked", () => {
    const chunk = _read("tdsb", b("\x00\x00\x20\x01"));
    expect(chunk instanceof TdsbChunk).toBe(true);
    expect((chunk as TdsbChunk).ratio_unlinked).toBe(true);
  });

  test("test_linked", () => {
    const chunk = _read("tdsb", b("\x00\x00\x00\x01"));
    expect(chunk instanceof TdsbChunk).toBe(true);
    expect((chunk as TdsbChunk).ratio_unlinked).toBe(false);
  });
});
