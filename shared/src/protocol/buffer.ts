/** Little-endian binary reader/writer used by the network protocol. */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export class ByteWriter {
  private buf: Uint8Array;
  private view: DataView;
  pos = 0;

  constructor(initial = 256) {
    this.buf = new Uint8Array(initial);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const nb = new Uint8Array(size);
    nb.set(this.buf.subarray(0, this.pos));
    this.buf = nb;
    this.view = new DataView(nb.buffer);
  }

  u8(v: number): this {
    this.ensure(1);
    this.buf[this.pos++] = v;
    return this;
  }
  bool(v: boolean): this {
    return this.u8(v ? 1 : 0);
  }
  i8(v: number): this {
    this.ensure(1);
    this.view.setInt8(this.pos, v);
    this.pos += 1;
    return this;
  }
  u16(v: number): this {
    this.ensure(2);
    this.view.setUint16(this.pos, v, true);
    this.pos += 2;
    return this;
  }
  i16(v: number): this {
    this.ensure(2);
    this.view.setInt16(this.pos, v, true);
    this.pos += 2;
    return this;
  }
  i32(v: number): this {
    this.ensure(4);
    this.view.setInt32(this.pos, v, true);
    this.pos += 4;
    return this;
  }
  u32(v: number): this {
    this.ensure(4);
    this.view.setUint32(this.pos, v, true);
    this.pos += 4;
    return this;
  }
  f32(v: number): this {
    this.ensure(4);
    this.view.setFloat32(this.pos, v, true);
    this.pos += 4;
    return this;
  }
  f64(v: number): this {
    this.ensure(8);
    this.view.setFloat64(this.pos, v, true);
    this.pos += 8;
    return this;
  }
  i64(v: bigint): this {
    this.ensure(8);
    this.view.setBigInt64(this.pos, v, true);
    this.pos += 8;
    return this;
  }
  /** Unsigned LEB128 varint (up to 2^53). */
  varint(v: number): this {
    this.ensure(8);
    while (v >= 0x80) {
      this.buf[this.pos++] = (v % 0x80) | 0x80;
      v = Math.floor(v / 0x80);
    }
    this.buf[this.pos++] = v;
    return this;
  }
  /** Zig-zag signed varint. */
  svarint(v: number): this {
    return this.varint(v >= 0 ? v * 2 : -v * 2 - 1);
  }
  str(s: string): this {
    const b = textEncoder.encode(s);
    this.varint(b.length);
    return this.bytes(b);
  }
  bytes(b: Uint8Array): this {
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
    return this;
  }
  u16array(a: Uint16Array): this {
    // align-free copy: write as raw bytes (little-endian platforms) for speed
    return this.bytes(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  }

  /** Copy of the written bytes in a fresh, exactly-sized ArrayBuffer (transferable). */
  finish(): ArrayBuffer {
    return this.buf.slice(0, this.pos).buffer;
  }
}

export class ByteReader {
  private readonly view: DataView;
  private readonly buf: Uint8Array;
  pos = 0;

  constructor(data: ArrayBuffer | Uint8Array) {
    this.buf = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.view = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
  }

  get remaining(): number {
    return this.buf.length - this.pos;
  }

  u8(): number {
    return this.buf[this.pos++]!;
  }
  bool(): boolean {
    return this.u8() !== 0;
  }
  i8(): number {
    const v = this.view.getInt8(this.pos);
    this.pos += 1;
    return v;
  }
  u16(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  i16(): number {
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  i32(): number {
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f32(): number {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f64(): number {
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }
  i64(): bigint {
    const v = this.view.getBigInt64(this.pos, true);
    this.pos += 8;
    return v;
  }
  varint(): number {
    let result = 0;
    let mul = 1;
    for (;;) {
      const b = this.buf[this.pos++]!;
      result += (b & 0x7f) * mul;
      if (b < 0x80) return result;
      mul *= 0x80;
    }
  }
  svarint(): number {
    const v = this.varint();
    return v % 2 === 0 ? v / 2 : -(v + 1) / 2;
  }
  str(): string {
    const n = this.varint();
    const s = textDecoder.decode(this.buf.subarray(this.pos, this.pos + n));
    this.pos += n;
    return s;
  }
  bytes(n: number): Uint8Array {
    const b = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
  u16array(n: number): Uint16Array {
    const b = this.bytes(n * 2);
    return new Uint16Array(b.buffer, b.byteOffset, n);
  }
}
