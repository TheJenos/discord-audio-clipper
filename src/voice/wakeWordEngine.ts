import { WakeWordDetector, isConfigured as isKwsConfigured } from './wakeWord';
import { TranscriptionWakeWordDetector, isConfigured as isTranscriptionConfigured } from './transcriber';

export function isConfigured(): boolean {
  return isKwsConfigured() || isTranscriptionConfigured();
}

export { isKwsConfigured, isTranscriptionConfigured };

export interface WakeWordEngine {
  push(chunk: Buffer): void;
  destroy(): void;
}

/**
 * Fans a speaker's PCM out to whichever wake-word engines are configured -
 * the fast, narrow KWS model (wakeWord.ts) and/or the general-purpose
 * transcription check (transcriber.ts) - firing onDetected if either one
 * hears "please clip that". Only guild-level enablement and per-engine
 * config gate creation; callers don't need to know which engine(s) are on.
 */
export function createWakeWordEngine(userId: string, onDetected: () => void): WakeWordEngine | null {
  const detectors: WakeWordEngine[] = [];

  if (isKwsConfigured()) {
    try {
      detectors.push(new WakeWordDetector(onDetected, userId));
    } catch (err) {
      console.error(`Failed to start KWS wake-word detector for user ${userId}:`, err);
    }
  }

  if (isTranscriptionConfigured()) {
    try {
      detectors.push(new TranscriptionWakeWordDetector(onDetected, userId));
    } catch (err) {
      console.error(`Failed to start transcription wake-word detector for user ${userId}:`, err);
    }
  }

  if (detectors.length === 0) return null;

  return {
    push: (chunk) => detectors.forEach((detector) => detector.push(chunk)),
    destroy: () => detectors.forEach((detector) => detector.destroy()),
  };
}
