import { FRAME_BYTES, SAMPLE_RATE } from './ringBuffer';

export const TARGET_SAMPLE_RATE = 16000;
export const DOWNSAMPLE_RATIO = SAMPLE_RATE / TARGET_SAMPLE_RATE;

/**
 * Downmixes a chunk of 48kHz stereo, 16-bit PCM (as decoded by the recorder)
 * to mono Float32 samples at TARGET_SAMPLE_RATE, the input format shared by
 * every sherpa-onnx model this project uses (KWS and transcription alike).
 * Averaging each group of DOWNSAMPLE_RATIO frames down (rather than dropping
 * samples) acts as a cheap anti-aliasing filter.
 */
export function downsampleToMono16k(chunk: Buffer): Float32Array {
  const frameCount = Math.floor(chunk.length / FRAME_BYTES);
  const downsampledCount = Math.floor(frameCount / DOWNSAMPLE_RATIO);
  if (downsampledCount === 0) return new Float32Array(0);

  const samples = new Float32Array(downsampledCount);
  for (let i = 0; i < downsampledCount; i++) {
    let sum = 0;
    for (let j = 0; j < DOWNSAMPLE_RATIO; j++) {
      const offset = (i * DOWNSAMPLE_RATIO + j) * FRAME_BYTES;
      const left = chunk.readInt16LE(offset);
      const right = chunk.readInt16LE(offset + 2);
      sum += (left + right) / 2 / 32768;
    }
    samples[i] = sum / DOWNSAMPLE_RATIO;
  }
  return samples;
}
