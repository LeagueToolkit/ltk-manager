/** Why a buffer the `ltk-asset` scheme answered is not one this build draws. */
export class BufferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BufferError";
  }
}

/**
 * A cursor over a buffer the scheme answered, which refuses a read past what arrived.
 *
 * Every block is read as a copy rather than as a view, because the blocks are packed to
 * four bytes, or not at all after a name, and a typed array over the buffer needs its own
 * alignment. Little-endian throughout.
 */
export class BufferReader {
  readonly #view: DataView;
  #at: number;

  constructor(bytes: ArrayBuffer) {
    this.#view = new DataView(bytes);
    this.#at = 0;
  }

  /** The whole buffer has been read. */
  get done(): boolean {
    return this.#at === this.#view.byteLength;
  }

  u32(): number {
    this.#take(4);
    const value = this.#view.getUint32(this.#at, true);
    this.#at += 4;
    return value;
  }

  i32(): number {
    this.#take(4);
    const value = this.#view.getInt32(this.#at, true);
    this.#at += 4;
    return value;
  }

  f32(): number {
    this.#take(4);
    const value = this.#view.getFloat32(this.#at, true);
    this.#at += 4;
    return value;
  }

  floats(count: number): Float32Array {
    this.#take(count * 4);
    const held = new Float32Array(count);
    for (let slot = 0; slot < count; slot += 1) {
      held[slot] = this.#view.getFloat32(this.#at + slot * 4, true);
    }
    this.#at += count * 4;
    return held;
  }

  words(count: number): Uint32Array {
    this.#take(count * 4);
    const held = new Uint32Array(count);
    for (let slot = 0; slot < count; slot += 1) {
      held[slot] = this.#view.getUint32(this.#at + slot * 4, true);
    }
    this.#at += count * 4;
    return held;
  }

  bytes(count: number): Uint8Array {
    this.#take(count);
    const held = new Uint8Array(this.#view.buffer, this.#view.byteOffset + this.#at, count).slice();
    this.#at += count;
    return held;
  }

  /** A length-prefixed UTF-8 string. */
  text(): string {
    const length = this.u32();
    return new TextDecoder().decode(this.bytes(length));
  }

  /** Read the magic and the version a buffer opens with, refusing any but `versions`. */
  header(magic: number, versions: readonly number[], what: string): number {
    if (this.#view.byteLength < 8) {
      throw new BufferError(`A ${what} buffer is at least 8 bytes`);
    }
    const opens = this.u32();
    if (opens !== magic) {
      throw new BufferError(`Not a ${what} buffer: 0x${opens.toString(16)}`);
    }
    const version = this.u32();
    if (!versions.includes(version)) {
      throw new BufferError(`A ${what} buffer of version ${version} is not one this build reads`);
    }
    return version;
  }

  /** Refuse `bytes` more where the buffer does not hold them. */
  #take(bytes: number): void {
    if (this.#at + bytes > this.#view.byteLength) {
      throw new BufferError("A buffer ended before the counts in its header");
    }
  }
}
