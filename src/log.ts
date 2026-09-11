import { config } from './config';

/** console.log, but only when --verbose/VERBOSE is on - for noisy, per-event debug output. */
export function debugLog(...args: unknown[]): void {
  if (config.verbose) console.log(...args);
}
