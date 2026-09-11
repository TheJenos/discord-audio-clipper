import { OfflineRecognizer } from 'sherpa-onnx-node';
import { config } from '../config';
import { debugLog } from '../log';
import { TARGET_SAMPLE_RATE, downsampleToMono16k } from './downsample';

export function isConfigured(): boolean {
  return Boolean(
    config.asrEncoderPath && config.asrDecoderPath && config.asrTokensPath && config.wakeWordPhrases.length > 0
  );
}

// Lowercases and strips punctuation so a transcript like "Please, clip
// that!" matches a configured phrase of "please clip that".
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// The ONNX model itself is heavy to load, so it's created once and shared
// across every speaker; only the lightweight per-speaker audio buffer below
// is created and torn down per speaking session. Mirrors wakeWord.ts's
// getSpotter().
let sharedRecognizer: OfflineRecognizer | null = null;

function getRecognizer(): OfflineRecognizer {
  if (sharedRecognizer) return sharedRecognizer;

  if (!config.asrEncoderPath || !config.asrDecoderPath || !config.asrTokensPath) {
    throw new Error(
      'Transcription-based wake-word detection is not configured (ASR_ENCODER_PATH / ASR_DECODER_PATH / ASR_TOKENS_PATH).'
    );
  }

  sharedRecognizer = new OfflineRecognizer({
    featConfig: { sampleRate: TARGET_SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      whisper: {
        encoder: config.asrEncoderPath,
        decoder: config.asrDecoderPath,
        language: 'en',
        task: 'transcribe',
      },
      tokens: config.asrTokensPath,
      numThreads: 1,
      provider: 'cpu',
    },
  });
  return sharedRecognizer;
}

/**
 * Buffers a single speaker's audio for one speaking session and, once they
 * stop talking (destroy(), called when the recorder's silence-triggered
 * subscription closes), transcribes the whole utterance in one shot with an
 * offline Whisper model and checks it for any of config.wakeWordPhrases - a
 * second, general-purpose way of catching "please clip that" alongside the
 * narrow, continuously-streaming KWS model in wakeWord.ts.
 *
 * A continuously-streaming ASR model was tried here first (matching KWS's
 * design), but testing against real "please clip that" recordings showed it
 * missing or garbling short, quiet trigger phrases far more often than an
 * offline whole-utterance Whisper decode does - the tradeoff is that
 * detection only fires after the speaker pauses, not mid-sentence.
 */
export class TranscriptionWakeWordDetector {
  private readonly phrases: string[];
  private readonly chunks: Float32Array[] = [];
  private sampleCount = 0;

  constructor(
    private readonly onDetected: () => void,
    private readonly debugLabel?: string
  ) {
    // Touch the shared recognizer eagerly so a broken/misconfigured model
    // throws here, in the constructor, instead of silently doing nothing
    // until the first destroy().
    getRecognizer();
    this.phrases = config.wakeWordPhrases.map(normalize);
  }

  /** Feed a chunk of 48kHz stereo, 16-bit PCM as decoded by the recorder. */
  push(chunk: Buffer): void {
    const samples = downsampleToMono16k(chunk);
    if (samples.length === 0) return;
    this.chunks.push(samples);
    this.sampleCount += samples.length;
  }

  // Decoding a whole utterance takes on the order of tens of milliseconds
  // for a tiny Whisper model, but runs via decodeAsync (a native worker
  // thread) regardless, so it never blocks the event loop that voice I/O and
  // Discord's heartbeats also run on - see the CPU note in docs/GUIDE.md §10.
  destroy(): void {
    if (this.sampleCount === 0) return;

    const audio = new Float32Array(this.sampleCount);
    let offset = 0;
    for (const chunk of this.chunks) {
      audio.set(chunk, offset);
      offset += chunk.length;
    }

    const recognizer = getRecognizer();
    const stream = recognizer.createStream();
    stream.acceptWaveform({ samples: audio, sampleRate: TARGET_SAMPLE_RATE });

    recognizer
      .decodeAsync(stream)
      .then((result) => {
        const text = normalize(result.text);
        if (text) {
          debugLog(`Transcription: ${text}`);
        }
        if (text && this.phrases.some((phrase) => text.includes(phrase))) {
          console.log(`Wake word detected via transcription for ${this.debugLabel ?? 'unknown'}: "${result.text}"`);
          this.onDetected();
        }
      })
      .catch((err) => {
        console.error(`Transcription decode failed for ${this.debugLabel ?? 'unknown'}:`, err);
      });
  }
}
