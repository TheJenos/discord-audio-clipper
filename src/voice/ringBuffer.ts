// Format of the PCM the recorder decodes out of Discord's Opus streams.
export const SAMPLE_RATE = 48000;
export const CHANNELS = 2;
export const BYTES_PER_SAMPLE = 2; // 16-bit PCM
export const FRAME_BYTES = CHANNELS * BYTES_PER_SAMPLE;
export const BYTES_PER_MS = (SAMPLE_RATE * FRAME_BYTES) / 1000;

// The ring itself is mono - every speaker gets summed into it anyway, and
// Discord's per-speaker stereo is just a duplicated mono channel.
export const SAMPLES_PER_MS = SAMPLE_RATE / 1000;
export const MONO_BYTES_PER_MS = SAMPLE_RATE * BYTES_PER_SAMPLE / 1000;

/** Hard ceiling on how much audio is kept, regardless of configuration. */
export const MAX_WINDOW_MS = 5 * 60 * 1000;

/**
 * A single, guild-wide circular buffer of the last `durationMs` of voice
 * chat, already mixed. Speakers are summed into it as their audio arrives
 * rather than being kept as one buffer each, so memory is bounded by the
 * window length alone and never by how many people are talking.
 *
 * Position in the ring is derived from wall-clock time, so every speaker's
 * audio lands where it belongs on the timeline without any timestamp
 * matching. The important consequence of that - and the bug this class
 * exists to fix - is that a slot in the ring holds audio from exactly one
 * lap around the buffer. `headMs` tracks how far along the timeline the ring
 * is current; everything between the head and "now" is last lap's audio, so
 * it gets zeroed as the head advances (on write, and again on read). Without
 * that, a speaker who went quiet five minutes ago would keep bleeding into
 * every clip, because nothing ever overwrote their samples.
 *
 * Samples accumulate as 32-bit ints so simultaneous speakers can't clip each
 * other; the sum is peak-normalised down to 16-bit only when read.
 */
export class MixingRingBuffer {
  readonly durationMs: number;
  readonly capacity: number;

  private readonly samples: Int32Array;
  /** Timeline position up to which the ring holds current-lap audio. */
  private headMs: number;
  /** Per-speaker write cursor, so bunched-up decoded frames stay contiguous. */
  private readonly cursors = new Map<string, number>();
  private lastWriteMs: number | null = null;

  constructor(durationMs: number, startMs: number = Date.now()) {
    this.durationMs = Math.min(durationMs, MAX_WINDOW_MS);
    this.capacity = Math.max(1, Math.round(this.durationMs * SAMPLES_PER_MS));
    this.samples = new Int32Array(this.capacity);
    this.headMs = startMs;
  }

  /** True once any speaker has written audio into the ring. */
  get hasAudio(): boolean {
    return this.lastWriteMs !== null;
  }

  private indexFor(ms: number): number {
    const idx = Math.floor(ms * SAMPLES_PER_MS) % this.capacity;
    return idx < 0 ? idx + this.capacity : idx;
  }

  /**
   * Clears everything on the timeline between the head and `ms` - that span
   * is silence nobody spoke into, and the ring still holds last lap's audio
   * there - then moves the head to `ms`.
   */
  private advanceTo(ms: number): void {
    if (ms <= this.headMs) return;

    const staleSamples = Math.min(
      Math.floor(ms * SAMPLES_PER_MS) - Math.floor(this.headMs * SAMPLES_PER_MS),
      this.capacity
    );
    if (staleSamples >= this.capacity) {
      this.samples.fill(0);
    } else if (staleSamples > 0) {
      const start = this.indexFor(this.headMs);
      const firstLen = Math.min(staleSamples, this.capacity - start);
      this.samples.fill(0, start, start + firstLen);
      if (firstLen < staleSamples) this.samples.fill(0, 0, staleSamples - firstLen);
    }
    this.headMs = ms;
  }

  /**
   * Sums one speaker's decoded 48kHz stereo chunk into the mix at the point
   * on the timeline it belongs to.
   */
  mix(speakerId: string, pcmChunk: Buffer, arrivalMs: number = Date.now()): void {
    const frameCount = Math.floor(pcmChunk.length / FRAME_BYTES);
    if (frameCount === 0) return;

    let cursor = this.cursors.get(speakerId) ?? arrivalMs;
    // A gap means real silence (or a new speaking session): resync to now.
    // Otherwise the packets simply bunched up in the event loop, so keep
    // writing at the cursor to keep consecutive frames contiguous.
    if (arrivalMs > cursor || cursor < arrivalMs - this.durationMs) cursor = arrivalMs;

    const endMs = cursor + frameCount / SAMPLES_PER_MS;
    this.advanceTo(endMs);

    const start = this.indexFor(cursor);
    for (let i = 0; i < frameCount; i++) {
      const offset = i * FRAME_BYTES;
      const mono = (pcmChunk.readInt16LE(offset) + pcmChunk.readInt16LE(offset + 2)) / 2;
      let pos = start + i;
      if (pos >= this.capacity) pos -= this.capacity;
      this.samples[pos] += mono;
    }

    this.cursors.set(speakerId, endMs);
    this.lastWriteMs = arrivalMs;
  }

  /** Drops a speaker's cursor once their stream ends. */
  endSpeaker(speakerId: string): void {
    this.cursors.delete(speakerId);
  }

  /**
   * Reads [startMs, endMs) as mono 16-bit PCM, oldest sample first, scaled
   * down by the window's peak so overlapping speakers don't distort.
   */
  read(startMs: number, endMs: number, nowMs: number = Date.now()): Buffer {
    // Expire any silence since the last write before reading, so a long quiet
    // stretch reads as silence rather than as last lap's audio.
    this.advanceTo(nowMs);

    const oldestMs = this.headMs - this.durationMs;
    const from = Math.max(startMs, oldestMs);
    const to = Math.min(endMs, this.headMs);
    const count = Math.min(
      Math.floor(to * SAMPLES_PER_MS) - Math.floor(from * SAMPLES_PER_MS),
      this.capacity
    );
    if (count <= 0) return Buffer.alloc(0);

    const start = this.indexFor(from);

    let peak = 0;
    for (let i = 0; i < count; i++) {
      let pos = start + i;
      if (pos >= this.capacity) pos -= this.capacity;
      const abs = Math.abs(this.samples[pos]);
      if (abs > peak) peak = abs;
    }
    const scale = peak > 32767 ? 32767 / peak : 1;

    const out = Buffer.alloc(count * BYTES_PER_SAMPLE);
    for (let i = 0; i < count; i++) {
      let pos = start + i;
      if (pos >= this.capacity) pos -= this.capacity;
      out.writeInt16LE(Math.round(this.samples[pos] * scale), i * BYTES_PER_SAMPLE);
    }
    return out;
  }
}
