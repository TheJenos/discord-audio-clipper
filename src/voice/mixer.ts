import os from 'os';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { PassThrough } from 'stream';
import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import { SAMPLE_RATE, CHANNELS, FRAME_BYTES } from './ringBuffer';
import type { GuildRecording } from './recorder';

if (!ffmpegPath) {
  throw new Error('ffmpeg-static did not resolve an ffmpeg binary for this platform.');
}
ffmpeg.setFfmpegPath(ffmpegPath);

function mixPCM(buffers: Buffer[], byteLength: number): Buffer {
  const sampleCount = byteLength / 2; // 16-bit samples
  const mixed = new Int32Array(sampleCount);

  for (const buf of buffers) {
    const samples = Math.min(sampleCount, Math.floor(buf.length / 2));
    for (let i = 0; i < samples; i++) {
      mixed[i] += buf.readInt16LE(i * 2);
    }
  }

  const out = Buffer.alloc(byteLength);
  for (let i = 0; i < sampleCount; i++) {
    let v = mixed[i];
    if (v > 32767) v = 32767;
    else if (v < -32768) v = -32768;
    out.writeInt16LE(v, i * 2);
  }
  return out;
}

/**
 * Mixes every speaker's ring buffer over the requested window and encodes
 * the result to an mp3 file in the OS temp directory. Resolves with the
 * file path; the caller is responsible for deleting it once sent.
 */
export async function createClip(guildRecording: GuildRecording, seconds: number): Promise<string | null> {
  const durationMs = Math.min(seconds * 1000, guildRecording.windowMs);
  const endMs = Date.now();
  const startMs = endMs - durationMs;

  const byteLength =
    Math.floor((durationMs * SAMPLE_RATE * FRAME_BYTES) / 1000 / FRAME_BYTES) * FRAME_BYTES;

  const perUserBuffers: Buffer[] = [];
  for (const ring of guildRecording.userBuffers.values()) {
    perUserBuffers.push(ring.read(startMs, endMs));
  }

  if (perUserBuffers.length === 0 || byteLength <= 0) {
    return null;
  }

  const mixed = mixPCM(perUserBuffers, byteLength);
  const outputPath = path.join(os.tmpdir(), `clip-${crypto.randomUUID()}.mp3`);

  await new Promise<void>((resolve, reject) => {
    const input = new PassThrough();
    input.end(mixed);

    ffmpeg(input)
      .inputFormat('s16le')
      .inputOptions(['-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS)])
      .audioBitrate(128)
      .format('mp3')
      .on('error', reject)
      .on('end', () => resolve())
      .save(outputPath);
  });

  return outputPath;
}

export function cleanupClip(filePath: string | null | undefined): void {
  if (!filePath) return;
  fs.unlink(filePath, () => {});
}
