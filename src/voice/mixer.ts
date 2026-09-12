import os from 'os';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { PassThrough } from 'stream';
import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import { SAMPLE_RATE, BYTES_PER_SAMPLE } from './ringBuffer';
import type { GuildRecording } from './recorder';

if (!ffmpegPath) {
  throw new Error('ffmpeg-static did not resolve an ffmpeg binary for this platform.');
}
ffmpeg.setFfmpegPath(ffmpegPath);

export interface Clip {
  filePath: string;
  seconds: number;
}

/**
 * Reads the tail of the guild's mixed ring buffer over the requested window
 * and encodes it to an mp3 file in the OS temp directory. Resolves with the
 * file path; the caller is responsible for deleting it once sent.
 */
export async function createClip(guildRecording: GuildRecording, seconds: number): Promise<Clip | null> {
  const endMs = Date.now();
  // Never return audio from before the bot joined this session — the ring
  // buffer is zero-filled there, which would otherwise pad the clip with
  // silence instead of trimming it to what was actually recorded.
  const recordedMs = endMs - guildRecording.startedAtMs;
  const durationMs = Math.min(seconds * 1000, guildRecording.windowMs, recordedMs);
  const startMs = endMs - durationMs;

  if (!guildRecording.buffer.hasAudio) return null;

  const pcm = guildRecording.buffer.read(startMs, endMs, endMs);
  if (pcm.length === 0) return null;

  const outputPath = path.join(os.tmpdir(), `clip-${crypto.randomUUID()}.mp3`);

  await new Promise<void>((resolve, reject) => {
    const input = new PassThrough();
    input.end(pcm);

    ffmpeg(input)
      .inputFormat('s16le')
      .inputOptions(['-ar', String(SAMPLE_RATE), '-ac', '1'])
      .audioBitrate(128)
      .format('mp3')
      .on('error', reject)
      .on('end', () => resolve())
      .save(outputPath);
  });

  return { filePath: outputPath, seconds: Math.floor(pcm.length / BYTES_PER_SAMPLE / SAMPLE_RATE) };
}

export function cleanupClip(filePath: string | null | undefined): void {
  if (!filePath) return;
  fs.unlink(filePath, () => {});
}
