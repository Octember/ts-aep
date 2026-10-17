/**
 * BitField descriptor for single-bit flags on raw byte fields.
 *
 * Usage::
 *
 *     \@define
 *     class MyChunk(Chunk):
 *         _flags: int = u1_field(repr=False)
 *
 *         my_flag = BitField("_flags", 3)  # bit 3 (no annotation)
 */

import { and, and_not, getattr, lshift, or, py_bool } from "../../pyrt/index.ts";

/**
 * Descriptor mapping a single bit in a raw-byte attrs field to a bool.
 *
 * The descriptor has no type annotation on the class body, so attrs
 * ignores it (it stays as a class-level data descriptor, not a slot).
 * Unknown bits in the raw byte are preserved implicitly.
 */
export class BitField {
  byte_field: string;
  mask: number;

  constructor(byte_field: string, bit: number) {
    this.byte_field = byte_field;
    this.mask = lshift(1, bit);
  }

  __get__(obj: any, objtype: Function | null = null): boolean {
    return py_bool(and(getattr(obj, this.byte_field), this.mask));
  }

  __set__(obj: any, value: boolean): void {
    const raw = getattr(obj, this.byte_field);
    if (value) {
      obj[this.byte_field] = or(raw, this.mask);
    } else {
      obj[this.byte_field] = and_not(raw, this.mask);
    }
  }
}
