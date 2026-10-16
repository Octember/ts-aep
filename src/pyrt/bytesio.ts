// `io.BytesIO`, the `IO[bytes]` every chunk reader/writer takes.

export class BytesIO {
  private buf: Uint8Array;
  private len: number;
  private pos = 0;

  constructor(initial?: Uint8Array) {
    this.buf = initial ? initial.slice() : new Uint8Array(256);
    this.len = initial ? initial.length : 0;
  }

  /** `fp.read(n)`; `n` omitted or negative reads to the end. */
  read(n?: number): Uint8Array {
    const end = n == null || n < 0 ? this.len : Math.min(this.len, this.pos + n);
    const out = this.buf.slice(Math.min(this.pos, end), end);
    this.pos = Math.max(this.pos, end);
    return out;
  }

  write(data: Uint8Array): number {
    const end = this.pos + data.length;
    if (end > this.buf.length) {
      const grown = new Uint8Array(Math.max(end, this.buf.length * 2));
      grown.set(this.buf.subarray(0, this.len));
      this.buf = grown;
    }
    if (this.pos > this.len) this.buf.fill(0, this.len, this.pos);
    this.buf.set(data, this.pos);
    this.pos = end;
    if (end > this.len) this.len = end;
    return data.length;
  }

  tell(): number {
    return this.pos;
  }

  /** `fp.seek(offset, whence)`; whence 0 = start, 1 = current, 2 = end. */
  seek(offset: number, whence: 0 | 1 | 2 = 0): number {
    const base = whence === 0 ? 0 : whence === 1 ? this.pos : this.len;
    this.pos = Math.max(0, base + offset);
    return this.pos;
  }

  getvalue(): Uint8Array {
    return this.buf.slice(0, this.len);
  }

  /** `getbuffer()` - a view without copying. */
  getbuffer(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }

  truncate(size?: number): number {
    this.len = Math.min(this.len, size ?? this.pos);
    return this.len;
  }

  close(): void {}
}

export type IO = BytesIO;
