const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PassThrough } = require('stream');
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const { SAMPLE_RATE, CHANNELS, FRAME_BYTES } = require('./ringBuffer');

ffmpeg.setFfmpegPath(ffmpegPath);

function mixPCM(buffers, byteLength) {
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
async function createClip(guildRecording, seconds) {
  const durationMs = Math.min(seconds * 1000, guildRecording.windowMs);
  const endMs = Date.now();
  const startMs = endMs - durationMs;

  const byteLength =
    Math.floor((durationMs * SAMPLE_RATE * FRAME_BYTES) / 1000 / FRAME_BYTES) * FRAME_BYTES;

  const perUserBuffers = [];
  for (const ring of guildRecording.userBuffers.values()) {
    perUserBuffers.push(ring.read(startMs, endMs));
  }

  if (perUserBuffers.length === 0 || byteLength <= 0) {
    return null;
  }

  const mixed = mixPCM(perUserBuffers, byteLength);
  const outputPath = path.join(os.tmpdir(), `clip-${crypto.randomUUID()}.mp3`);

  await new Promise((resolve, reject) => {
    const input = new PassThrough();
    input.end(mixed);

    ffmpeg(input)
      .inputFormat('s16le')
      .inputOptions(['-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS)])
      .audioBitrate(128)
      .format('mp3')
      .on('error', reject)
      .on('end', resolve)
      .save(outputPath);
  });

  return outputPath;
}

function cleanupClip(filePath) {
  if (!filePath) return;
  fs.unlink(filePath, () => {});
}

module.exports = { createClip, cleanupClip };
