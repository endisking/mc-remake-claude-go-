/**
 * Brigadier-style string reader and syntax errors, with vanilla 1.17.1 (en_us) messages.
 */

/** A parse/usage error. `cursor` = −1 when it has no position in the input (runtime errors). */
export class CommandSyntaxError extends Error {
  constructor(message: string, readonly input: string | null = null, readonly cursor = -1) {
    super(message);
  }
}

/** A failure raised while executing (vanilla CommandSyntaxException without context). */
export function fail(message: string): CommandSyntaxError {
  return new CommandSyntaxError(message);
}

export function isAllowedNumber(c: string): boolean {
  return (c >= '0' && c <= '9') || c === '.' || c === '-';
}

export function isQuotedStringStart(c: string): boolean {
  return c === '"' || c === "'";
}

export function isAllowedInUnquotedString(c: string): boolean {
  return (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_' || c === '-' || c === '.' || c === '+';
}

export class StringReader {
  cursor = 0;
  constructor(readonly string: string) {}

  clone(): StringReader {
    const r = new StringReader(this.string);
    r.cursor = this.cursor;
    return r;
  }
  get remainingLength(): number {
    return this.string.length - this.cursor;
  }
  get remaining(): string {
    return this.string.slice(this.cursor);
  }
  canRead(n = 1): boolean {
    return this.cursor + n <= this.string.length;
  }
  peek(offset = 0): string {
    return this.string.charAt(this.cursor + offset);
  }
  next(): string {
    return this.string.charAt(this.cursor++);
  }
  skip(): void {
    this.cursor++;
  }
  skipWhitespace(): void {
    while (this.canRead() && this.peek() === ' ') this.skip();
  }
  /** An error pointing at the reader's current position. */
  error(message: string, at = this.cursor): CommandSyntaxError {
    return new CommandSyntaxError(message, this.string, at);
  }

  readInt(): number {
    const start = this.cursor;
    while (this.canRead() && isAllowedNumber(this.peek())) this.skip();
    const s = this.string.slice(start, this.cursor);
    if (!s) throw this.error('Expected integer');
    if (!/^[-+]?\d+$/.test(s) || Math.abs(Number(s)) > 2147483648) {
      this.cursor = start;
      throw this.error(`Invalid integer '${s}'`);
    }
    return Number(s);
  }
  readLong(): number {
    const start = this.cursor;
    while (this.canRead() && isAllowedNumber(this.peek())) this.skip();
    const s = this.string.slice(start, this.cursor);
    if (!s) throw this.error('Expected long');
    if (!/^[-+]?\d+$/.test(s)) {
      this.cursor = start;
      throw this.error(`Invalid long '${s}'`);
    }
    return Number(s);
  }
  private readDecimal(kind: 'float' | 'double'): number {
    const start = this.cursor;
    while (this.canRead() && isAllowedNumber(this.peek())) this.skip();
    const s = this.string.slice(start, this.cursor);
    if (!s) throw this.error(`Expected ${kind}`);
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) {
      this.cursor = start;
      throw this.error(`Invalid ${kind} '${s}'`);
    }
    return Number(s);
  }
  readFloat(): number {
    return this.readDecimal('float');
  }
  readDouble(): number {
    return this.readDecimal('double');
  }
  readUnquotedString(): string {
    const start = this.cursor;
    while (this.canRead() && isAllowedInUnquotedString(this.peek())) this.skip();
    return this.string.slice(start, this.cursor);
  }
  readQuotedString(): string {
    if (!this.canRead()) return '';
    const q = this.peek();
    if (!isQuotedStringStart(q)) throw this.error('Expected quote to start a string');
    this.skip();
    return this.readStringUntil(q);
  }
  readStringUntil(terminator: string): string {
    let out = '';
    let escaped = false;
    while (this.canRead()) {
      const c = this.next();
      if (escaped) {
        if (c === terminator || c === '\\') {
          out += c;
          escaped = false;
        } else {
          this.cursor--;
          throw this.error(`Invalid escape sequence '${c}' in quoted string`);
        }
      } else if (c === '\\') escaped = true;
      else if (c === terminator) return out;
      else out += c;
    }
    throw this.error('Unclosed quoted string');
  }
  readString(): string {
    if (!this.canRead()) return '';
    if (isQuotedStringStart(this.peek())) return this.readQuotedString();
    return this.readUnquotedString();
  }
  readBoolean(): boolean {
    const start = this.cursor;
    const v = this.readString();
    if (!v) throw this.error('Expected bool');
    if (v === 'true') return true;
    if (v === 'false') return false;
    this.cursor = start;
    throw this.error(`Invalid boolean, expected 'true' or 'false' but found '${v}'`);
  }
  expect(c: string): void {
    if (!this.canRead() || this.peek() !== c) throw this.error(`Expected '${c}'`);
    this.skip();
  }
  /** A resource location (namespace:path). */
  readResourceLocation(): string {
    const start = this.cursor;
    while (this.canRead() && /[0-9a-z_:./-]/.test(this.peek())) this.skip();
    const s = this.string.slice(start, this.cursor);
    if (!/^([a-z0-9_.-]+:)?[a-z0-9_./-]*$/.test(s)) {
      this.cursor = start;
      throw this.error('Invalid ID');
    }
    return s;
  }
}

/** ResourceLocation path for the minecraft namespace ("minecraft:stone" / "stone" → "stone"); null for other namespaces. */
export function vanillaPath(id: string): string | null {
  const i = id.indexOf(':');
  if (i < 0) return id;
  return id.slice(0, i) === 'minecraft' ? id.slice(i + 1) : null;
}

/** ResourceLocation.toString: "stone" → "minecraft:stone". */
export function fullId(id: string): string {
  return id.includes(':') ? id : `minecraft:${id}`;
}
