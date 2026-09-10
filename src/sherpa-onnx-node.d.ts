// sherpa-onnx-node ships no TypeScript types. This covers only the
// KeywordSpotter surface this project actually uses - see
// node_modules/sherpa-onnx-node/{keyword-spotter,streaming-asr,types}.js
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
}
