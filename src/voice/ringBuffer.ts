export const SAMPLE_RATE = 48000;
export const CHANNELS = 2;
export const BYTES_PER_SAMPLE = 2; // 16-bit PCM
export const FRAME_BYTES = CHANNELS * BYTES_PER_SAMPLE;
export const BYTES_PER_MS = (SAMPLE_RATE * FRAME_BYTES) / 1000;

function alignDown(bytes: number): number {
  return bytes - (bytes % FRAME_BYTES);
}

function writeWrap(buf: Buffer, capacity: number, index: number, data: Buffer): void {
  const firstLen = Math.min(data.length, capacity - index);
  data.copy(buf, index, 0, firstLen);
  if (firstLen < data.length) {
    data.copy(buf, 0, firstLen);
  }
}

function zeroWrap(buf: Buffer, capacity: number, index: number, length: number): void {
  if (length <= 0) return;
  if (length >= capacity) {
    buf.fill(0);
    return;
  }
  const firstLen = Math.min(length, capacity - index);
  buf.fill(0, index, index + firstLen);
  if (firstLen < length) {
    buf.fill(0, 0, length - firstLen);
  }
}

function readWrap(buf: Buffer, capacity: number, index: number, length: number): Buffer {
  const out = Buffer.alloc(length);
  const firstLen = Math.min(length, capacity - index);
  buf.copy(out, 0, index, index + firstLen);
  if (firstLen < length) {
    buf.copy(out, firstLen, 0, length - firstLen);
  }
  return out;
}

/**
 * Fixed-size circular buffer holding raw 48kHz/stereo/16-bit PCM audio for a
 * single speaker. Writes are positioned by wall-clock time (modulo the
 * buffer's duration) rather than by arrival order, so that samples written
 * at the same instant land at the same byte offset in every user's buffer.
 * That lets the mixer combine buffers from different speakers with plain
 * index-aligned addition instead of needing to timestamp-match them first.
 */
export class PCMRingBuffer {
  readonly durationMs: number;
  readonly capacity: number;
  private readonly buffer: Buffer;
  private lastWriteEndMs: number | null = null;
  lastActivityMs: number | null = null;

  constructor(durationMs: number) {
    this.durationMs = durationMs;
    this.capacity = alignDown(Math.floor(durationMs * BYTES_PER_MS));
    this.buffer = Buffer.alloc(this.capacity);
  }

  private posFor(ms: number): number {
    const m = ((ms % this.durationMs) + this.durationMs) % this.durationMs;
    let idx = alignDown(Math.floor(m * BYTES_PER_MS));
    if (idx >= this.capacity) idx = this.capacity - FRAME_BYTES;
    return idx;
  }

  write(pcmChunk: Buffer, timestampMs: number = Date.now()): void {
    if (this.capacity === 0 || pcmChunk.length === 0) return;

    if (this.lastWriteEndMs === null) {
      this.lastWriteEndMs = timestampMs;
    } else if (timestampMs > this.lastWriteEndMs) {
      // A real silence gap (or a brand new speaking session) - fill it and
      // resync the cursor to wall-clock time.
      const gapMs = Math.min(timestampMs - this.lastWriteEndMs, this.durationMs);
      const gapBytes = alignDown(Math.round(gapMs * BYTES_PER_MS));
      zeroWrap(this.buffer, this.capacity, this.posFor(this.lastWriteEndMs), gapBytes);
      this.lastWriteEndMs = timestampMs;
    }
    // Otherwise this packet arrived earlier than the running cursor (event
    // loop jitter bunching up decoded frames) - keep writing at the cursor
    // instead of the arrival time so consecutive frames stay contiguous
    // instead of overlapping and corrupting each other.

    const idx = this.posFor(this.lastWriteEndMs);
    writeWrap(this.buffer, this.capacity, idx, pcmChunk);
    this.lastWriteEndMs += pcmChunk.length / BYTES_PER_MS;
    this.lastActivityMs = timestampMs;
  }

  /** Reads [startMs, endMs) as a PCM buffer, oldest sample first. */
  read(startMs: number, endMs: number): Buffer {
    const lenBytes = alignDown(Math.round((endMs - startMs) * BYTES_PER_MS));
    if (lenBytes <= 0) return Buffer.alloc(0);
    return readWrap(this.buffer, this.capacity, this.posFor(startMs), lenBytes);
  }
}
