const { EndBehaviorType } = require('@discordjs/voice');
const prism = require('prism-media');
const { PCMRingBuffer, SAMPLE_RATE, CHANNELS } = require('./ringBuffer');
const config = require('../config');

/** @type {Map<string, GuildRecording>} */
const recordings = new Map();

class GuildRecording {
  constructor(connection) {
    this.connection = connection;
    this.windowMs = config.recordWindowSeconds * 1000;
    /** @type {Map<string, PCMRingBuffer>} */
    this.userBuffers = new Map();
    /** @type {Set<string>} */
    this.activeSubscriptions = new Set();

    this.receiver = connection.receiver;
    this._onSpeakingStart = (userId) => this._subscribeToUser(userId);
    this.receiver.speaking.on('start', this._onSpeakingStart);
  }

  _subscribeToUser(userId) {
    if (this.activeSubscriptions.has(userId)) return;
    this.activeSubscriptions.add(userId);

    let buffer = this.userBuffers.get(userId);
    if (!buffer) {
      buffer = new PCMRingBuffer(this.windowMs);
      this.userBuffers.set(userId, buffer);
    }

    const opusStream = this.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 100 },
    });
    const pcmStream = opusStream.pipe(
      new prism.opus.Decoder({ rate: SAMPLE_RATE, channels: CHANNELS, frameSize: 960 })
    );

    pcmStream.on('data', (chunk) => buffer.write(chunk, Date.now()));

    const cleanup = () => this.activeSubscriptions.delete(userId);
    opusStream.on('end', cleanup);
    opusStream.on('error', cleanup);
    pcmStream.on('error', cleanup);
  }

  destroy() {
    this.receiver.speaking.removeListener('start', this._onSpeakingStart);
    this.userBuffers.clear();
    this.activeSubscriptions.clear();
  }
}

function startRecording(guildId, connection) {
  stopRecording(guildId);
  const recording = new GuildRecording(connection);
  recordings.set(guildId, recording);
  return recording;
}

function stopRecording(guildId) {
  const recording = recordings.get(guildId);
  if (recording) {
    recording.destroy();
    recordings.delete(guildId);
  }
}

function getRecording(guildId) {
  return recordings.get(guildId);
}

module.exports = { startRecording, stopRecording, getRecording };
