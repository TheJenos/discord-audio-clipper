import { EventEmitter } from 'node:events';
import { EndBehaviorType, VoiceConnection, VoiceReceiver } from '@discordjs/voice';
import { opus as prismOpus } from 'prism-media';
import { MixingRingBuffer, MAX_WINDOW_MS, SAMPLE_RATE, CHANNELS } from './ringBuffer';
import { WakeWordEngine, createWakeWordEngine, isConfigured as isWakeWordConfigured } from './wakeWordEngine';
import * as settingsStore from '../store/settingsStore';
import { config } from '../config';

const recordings = new Map<string, GuildRecording>();

export interface GuildRecordingEvents {
  wakeword: [{ userId: string; phrase: string }];
}

// Emits 'wakeword' (with the speaking userId and the matched phrase)
// whenever a configured trigger phrase is detected in an active speaker's
// audio, if /voiceclip is enabled for this guild. See voice/wakeWord.ts,
// voice/transcriber.ts, and voice/wakeClip.ts.
export class GuildRecording extends EventEmitter<GuildRecordingEvents> {
  readonly connection: VoiceConnection;
  readonly guildId: string;
  readonly windowMs: number;
  readonly startedAtMs: number;
  /** One mixed stream for the whole guild, not one buffer per speaker. */
  readonly buffer: MixingRingBuffer;

  private readonly receiver: VoiceReceiver;
  private readonly activeSubscriptions = new Set<string>();
  private readonly onSpeakingStart: (userId: string) => void;

  constructor(connection: VoiceConnection, guildId: string) {
    super();
    this.connection = connection;
    this.guildId = guildId;
    this.windowMs = Math.min(config.recordWindowSeconds * 1000, MAX_WINDOW_MS);
    this.startedAtMs = Date.now();
    this.buffer = new MixingRingBuffer(this.windowMs, this.startedAtMs);
    this.receiver = connection.receiver;
    this.onSpeakingStart = (userId: string) => this.subscribeToUser(userId);
    this.receiver.speaking.on('start', this.onSpeakingStart);
  }

  private subscribeToUser(userId: string): void {
    if (this.activeSubscriptions.has(userId)) return;
    this.activeSubscriptions.add(userId);

    const opusStream = this.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 100 },
    });
    const pcmStream = opusStream.pipe(
      new prismOpus.Decoder({ rate: SAMPLE_RATE, channels: CHANNELS, frameSize: 960 })
    );

    const detector = this.createWakeWordDetector(userId);

    pcmStream.on('data', (chunk: Buffer) => {
      this.buffer.mix(userId, chunk, Date.now());
      detector?.push(chunk);
    });

    const cleanup = () => {
      this.activeSubscriptions.delete(userId);
      this.buffer.endSpeaker(userId);
      detector?.destroy();
    };
    opusStream.on('end', cleanup);
    opusStream.on('error', cleanup);
    pcmStream.on('error', cleanup);
  }

  private createWakeWordDetector(userId: string): WakeWordEngine | null {
    if (!settingsStore.isVoiceClipEnabled(this.guildId) || !isWakeWordConfigured()) return null;
    return createWakeWordEngine(userId, (phrase) => this.emit('wakeword', { userId, phrase }));
  }

  destroy(): void {
    this.receiver.speaking.removeListener('start', this.onSpeakingStart);
    this.activeSubscriptions.clear();
    this.removeAllListeners();
  }
}

export function startRecording(guildId: string, connection: VoiceConnection): GuildRecording {
  if (recordings.has(guildId)) {
    console.log(`Restarting recording for guild ${guildId} (buffers so far are lost).`);
  }
  stopRecording(guildId);
  const recording = new GuildRecording(connection, guildId);
  recordings.set(guildId, recording);
  return recording;
}

export function stopRecording(guildId: string): void {
  const recording = recordings.get(guildId);
  if (recording) {
    recording.destroy();
    recordings.delete(guildId);
  }
}

export function getRecording(guildId: string): GuildRecording | undefined {
  return recordings.get(guildId);
}
