// sherpa-onnx-node ships no TypeScript types. This covers only the
// KeywordSpotter and OfflineRecognizer surface this project actually uses -
// see node_modules/sherpa-onnx-node/{keyword-spotter,non-streaming-asr,types}.js
// for the full (untyped) API.
declare module 'sherpa-onnx-node' {
  export interface Waveform {
    samples: Float32Array;
    sampleRate: number;
  }

  export class OnlineStream {
    acceptWaveform(waveform: Waveform): void;
    inputFinished(): void;
  }

  export interface KeywordResult {
    keyword: string;
    timestamps: number[];
    tokens: string[];
  }

  export interface KeywordSpotterConfig {
    featConfig?: { sampleRate?: number; featureDim?: number };
    modelConfig: {
      transducer: { encoder: string; decoder: string; joiner: string };
      tokens: string;
      numThreads?: number;
      provider?: string;
      debug?: boolean | number;
    };
    keywordsFile: string;
    keywordsScore?: number;
    keywordsThreshold?: number;
  }

  export class KeywordSpotter {
    constructor(config: KeywordSpotterConfig);
    createStream(): OnlineStream;
    isReady(stream: OnlineStream): boolean;
    decode(stream: OnlineStream): void;
    reset(stream: OnlineStream): void;
    getResult(stream: OnlineStream): KeywordResult;
  }

  export class OfflineStream {
    acceptWaveform(waveform: Waveform): void;
  }

  export interface OfflineRecognizerResult {
    text: string;
    tokens: string[];
    timestamps: number[];
  }

  export interface OfflineRecognizerConfig {
    featConfig?: { sampleRate?: number; featureDim?: number };
    modelConfig: {
      whisper: { encoder: string; decoder: string; language?: string; task?: string };
      tokens: string;
      numThreads?: number;
      provider?: string;
      debug?: boolean | number;
    };
  }

  export class OfflineRecognizer {
    constructor(config: OfflineRecognizerConfig);
    createStream(): OfflineStream;
    decode(stream: OfflineStream): void;
    decodeAsync(stream: OfflineStream): Promise<OfflineRecognizerResult>;
    getResult(stream: OfflineStream): OfflineRecognizerResult;
  }
}
