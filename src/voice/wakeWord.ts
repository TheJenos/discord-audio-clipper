import { Porcupine } from '@picovoice/porcupine-node';
import { config } from '../config';
import { FRAME_BYTES, SAMPLE_RATE } from './ringBuffer';

export function isConfigured(): boolean {
  return Boolean(config.porcupineAccessKey && config.porcupineKeywordPath);
}

/**
 * Feeds a single speaker's 48kHz stereo PCM stream into a dedicated Porcupine
 * instance to detect the "clip that" wake word, downsampling to whatever mono
 * rate Porcupine expects along the way.
 */
export class WakeWordDetector {
  private readonly porcupine: Porcupine;
  private readonly decimationRatio: number;
  private readonly frame: Int16Array;
  private frameLen = 0;
  private phase = 0;
  private accumulator = 0;

  constructor(private readonly onDetected: () => void) {
    if (!config.porcupineAccessKey || !config.porcupineKeywordPath) {
      throw new Error('Porcupine is not configured (PORCUPINE_ACCESS_KEY / PORCUPINE_KEYWORD_PATH).');
    }

    this.porcupine = new Porcupine(
      config.porcupineAccessKey,
      [config.porcupineKeywordPath],
      [config.porcupineSensitivity]
    );

    if (SAMPLE_RATE % this.porcupine.sampleRate !== 0) {
      this.porcupine.release();
      throw new Error(
        `Porcupine sample rate (${this.porcupine.sampleRate}Hz) does not evenly divide the recorder's ${SAMPLE_RATE}Hz.`
      );
    }
    this.decimationRatio = SAMPLE_RATE / this.porcupine.sampleRate;
    this.frame = new Int16Array(this.porcupine.frameLength);
  }

  /** Feed a chunk of 48kHz stereo, 16-bit PCM as decoded by the recorder. */
  push(chunk: Buffer): void {
    const frameCount = Math.floor(chunk.length / FRAME_BYTES);

    for (let i = 0; i < frameCount; i++) {
      const offset = i * FRAME_BYTES;
      const left = chunk.readInt16LE(offset);
      const right = chunk.readInt16LE(offset + 2);
      this.accumulator += (left + right) / 2;
      this.phase++;

      if (this.phase < this.decimationRatio) continue;
      this.phase = 0;
      this.frame[this.frameLen++] = Math.round(this.accumulator / this.decimationRatio);
      this.accumulator = 0;

      if (this.frameLen === this.frame.length) {
        this.frameLen = 0;
        if (this.porcupine.process(this.frame) >= 0) {
          this.onDetected();
        }
      }
    }
  }

  destroy(): void {
    this.porcupine.release();
  }
}
