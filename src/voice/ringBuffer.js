const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2; // 16-bit PCM
const FRAME_BYTES = CHANNELS * BYTES_PER_SAMPLE;
const BYTES_PER_MS = (SAMPLE_RATE * FRAME_BYTES) / 1000;

function alignDown(bytes) {
  return bytes - (bytes % FRAME_BYTES);
}

function writeWrap(buf, capacity, index, data) {
  const firstLen = Math.min(data.length, capacity - index);
  data.copy(buf, index, 0, firstLen);
  if (firstLen < data.length) {
    data.copy(buf, 0, firstLen);
  }
}

function zeroWrap(buf, capacity, index, length) {
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

function readWrap(buf, capacity, index, length) {
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
class PCMRingBuffer {
  constructor(durationMs) {
    this.durationMs = durationMs;
    this.capacity = alignDown(Math.floor(durationMs * BYTES_PER_MS));
    this.buffer = Buffer.alloc(this.capacity);
    this.lastWriteEndMs = null;
    this.lastActivityMs = null;
  }

  _posFor(ms) {
    const m = ((ms % this.durationMs) + this.durationMs) % this.durationMs;
    let idx = alignDown(Math.floor(m * BYTES_PER_MS));
    if (idx >= this.capacity) idx = this.capacity - FRAME_BYTES;
    return idx;
  }

  write(pcmChunk, timestampMs = Date.now()) {
    if (this.capacity === 0 || pcmChunk.length === 0) return;

    if (this.lastWriteEndMs !== null && timestampMs > this.lastWriteEndMs) {
      const gapMs = Math.min(timestampMs - this.lastWriteEndMs, this.durationMs);
      const gapBytes = alignDown(Math.round(gapMs * BYTES_PER_MS));
      zeroWrap(this.buffer, this.capacity, this._posFor(this.lastWriteEndMs), gapBytes);
    }

    const idx = this._posFor(timestampMs);
    writeWrap(this.buffer, this.capacity, idx, pcmChunk);
    this.lastWriteEndMs = timestampMs + pcmChunk.length / BYTES_PER_MS;
    this.lastActivityMs = timestampMs;
  }

  /** Reads [startMs, endMs) as a PCM buffer, oldest sample first. */
  read(startMs, endMs) {
    const lenBytes = alignDown(Math.round((endMs - startMs) * BYTES_PER_MS));
    if (lenBytes <= 0) return Buffer.alloc(0);
    return readWrap(this.buffer, this.capacity, this._posFor(startMs), lenBytes);
  }
}

module.exports = {
  PCMRingBuffer,
  SAMPLE_RATE,
  CHANNELS,
  BYTES_PER_SAMPLE,
  FRAME_BYTES,
  BYTES_PER_MS,
};
