import { KeywordSpotter, OnlineStream } from 'sherpa-onnx-node';
import { config } from '../config';
import { FRAME_BYTES, SAMPLE_RATE } from './ringBuffer';

const TARGET_SAMPLE_RATE = 16000;
const DECIMATION_RATIO = SAMPLE_RATE / TARGET_SAMPLE_RATE;

export function isConfigured(): boolean {
  return Boolean(
    config.kwsEncoderPath &&
      config.kwsDecoderPath &&
      config.kwsJoinerPath &&
      config.kwsTokensPath &&
      config.kwsKeywordsPath
  );
}

// The ONNX model itself is heavy to load, so it's created once and shared
// across every speaker; only the lightweight per-speaker OnlineStream below
// is created and torn down per speaking session.
let sharedSpotter: KeywordSpotter | null = null;

function getSpotter(): KeywordSpotter {
  if (sharedSpotter) return sharedSpotter;

  if (
    !config.kwsEncoderPath ||
    !config.kwsDecoderPath ||
    !config.kwsJoinerPath ||
    !config.kwsTokensPath ||
    !config.kwsKeywordsPath
  ) {
    throw new Error(
      'Keyword spotting is not configured (KWS_ENCODER_PATH / KWS_DECODER_PATH / KWS_JOINER_PATH / KWS_TOKENS_PATH / KWS_KEYWORDS_PATH).'
    );
  }

  sharedSpotter = new KeywordSpotter({
    featConfig: { sampleRate: TARGET_SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: config.kwsEncoderPath,
        decoder: config.kwsDecoderPath,
        joiner: config.kwsJoinerPath,
      },
      tokens: config.kwsTokensPath,
      numThreads: 1,
      provider: 'cpu',
    },
    keywordsFile: config.kwsKeywordsPath,
    keywordsScore: config.kwsScore,
    keywordsThreshold: config.kwsThreshold,
  });
  return sharedSpotter;
}

/**
 * Feeds a single speaker's 48kHz stereo PCM stream into its own
 * sherpa-onnx keyword-spotting stream to detect the "clip that" wake word,
 * downsampling to the mono rate the model expects along the way.
 */
export class WakeWordDetector {
  private readonly stream: OnlineStream;
  private phase = 0;
  private accumulator = 0;

  constructor(private readonly onDetected: () => void) {
    this.stream = getSpotter().createStream();
  }

  /** Feed a chunk of 48kHz stereo, 16-bit PCM as decoded by the recorder. */
  push(chunk: Buffer): void {
    const frameCount = Math.floor(chunk.length / FRAME_BYTES);
    if (frameCount === 0) return;

    const samples = new Float32Array(Math.ceil(frameCount / DECIMATION_RATIO));
    let sampleCount = 0;

    for (let i = 0; i < frameCount; i++) {
      const offset = i * FRAME_BYTES;
      const left = chunk.readInt16LE(offset);
      const right = chunk.readInt16LE(offset + 2);
      this.accumulator += (left + right) / 2;
      this.phase++;

      if (this.phase < DECIMATION_RATIO) continue;
      this.phase = 0;
      samples[sampleCount++] = this.accumulator / DECIMATION_RATIO / 32768;
      this.accumulator = 0;
    }

    if (sampleCount === 0) return;

    const spotter = getSpotter();
    this.stream.acceptWaveform({ samples: samples.subarray(0, sampleCount), sampleRate: TARGET_SAMPLE_RATE });

    while (spotter.isReady(this.stream)) {
      spotter.decode(this.stream);
    }

    if (spotter.getResult(this.stream).keyword) {
      spotter.reset(this.stream);
      this.onDetected();
    }
  }

  // No explicit native handle to release - the underlying stream is
  // reclaimed by the addon's own finalizer once this is garbage collected.
  destroy(): void {}
}
