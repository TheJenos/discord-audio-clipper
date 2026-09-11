import fs from 'node:fs';
import path from 'node:path';
import { KeywordSpotter, OnlineStream } from 'sherpa-onnx-node';
import { config } from '../config';
import { TARGET_SAMPLE_RATE, downsampleToMono16k } from './downsample';

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
 * sherpa-onnx keyword-spotting stream to detect the "please clip that" wake word,
 * downmixing to mono and downsampling to the model's expected
 * TARGET_SAMPLE_RATE along the way.
 */
export class WakeWordDetector {
  private readonly stream: OnlineStream;
  private readonly debugChunks: Int16Array[] | null = config.kwsDebugAudioDir ? [] : null;

  constructor(
    private readonly onDetected: (phrase: string) => void,
    private readonly debugLabel?: string
  ) {
    this.stream = getSpotter().createStream();
  }

  /** Feed a chunk of 48kHz stereo, 16-bit PCM as decoded by the recorder. */
  push(chunk: Buffer): void {
    const samples = downsampleToMono16k(chunk);
    if (samples.length === 0) return;

    if (this.debugChunks) {
      const pcm16 = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32768)));
      }
      this.debugChunks.push(pcm16);
    }

    const spotter = getSpotter();
    this.stream.acceptWaveform({ samples, sampleRate: TARGET_SAMPLE_RATE });

    while (spotter.isReady(this.stream)) {
      spotter.decode(this.stream);
    }

    const result = spotter.getResult(this.stream);
    if (result.keyword) {
      spotter.reset(this.stream);
      // Keyword labels are derived from the phrase text with spaces
      // replaced by underscores (see scripts/setup-voiceclip.sh) - reverse
      // that for a human-readable phrase to report back.
      const phrase = result.keyword.replace(/_/g, ' ').trim();
      console.log(`Wake word detected for ${this.debugLabel ?? 'unknown'} (phrase: "${phrase}")`);
      this.onDetected(phrase);
    }
  }

  // No explicit native handle to release - the underlying stream is
  // reclaimed by the addon's own finalizer once this is garbage collected.
  // If KWS_DEBUG_AUDIO_DIR is set, this is also where the buffered audio for
  // this speaking session gets flushed to a .wav file.
  destroy(): void {
    if (!this.debugChunks || this.debugChunks.length === 0) return;
    try {
      writeDebugWav(config.kwsDebugAudioDir!, this.debugLabel, this.debugChunks);
    } catch (err) {
      console.error('Failed to write wake-word debug audio:', err);
    }
  }
}

// Dumps exactly what was fed to the KWS model (mono, TARGET_SAMPLE_RATE,
// 16-bit PCM) as a standalone .wav file, so a person can listen to what the
// detector heard when diagnosing missed/false wake-word triggers.
function writeDebugWav(dir: string, label: string | undefined, chunks: Int16Array[]): void {
  const totalSamples = chunks.reduce((sum, c) => sum + c.length, 0);
  const dataSize = totalSamples * 2;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(TARGET_SAMPLE_RATE, 24);
  header.writeUInt32LE(TARGET_SAMPLE_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  const dataBuffers = chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength));

  fs.mkdirSync(dir, { recursive: true });
  const filename = `wakeword-${label ?? 'unknown'}-${Date.now()}.wav`;
  fs.writeFileSync(path.join(dir, filename), Buffer.concat([header, ...dataBuffers]));
}
