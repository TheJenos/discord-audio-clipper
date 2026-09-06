import { EndBehaviorType, VoiceConnection, VoiceReceiver } from '@discordjs/voice';
import { opus as prismOpus } from 'prism-media';
import { PCMRingBuffer, SAMPLE_RATE, CHANNELS } from './ringBuffer';
import { config } from '../config';

const recordings = new Map<string, GuildRecording>();

export class GuildRecording {
  readonly connection: VoiceConnection;
  readonly windowMs: number;
  readonly userBuffers = new Map<string, PCMRingBuffer>();

  private readonly receiver: VoiceReceiver;
  private readonly activeSubscriptions = new Set<string>();
  private readonly onSpeakingStart: (userId: string) => void;

  constructor(connection: VoiceConnection) {
    this.connection = connection;
    this.windowMs = config.recordWindowSeconds * 1000;
    this.receiver = connection.receiver;
    this.onSpeakingStart = (userId: string) => this.subscribeToUser(userId);
    this.receiver.speaking.on('start', this.onSpeakingStart);
  }

  private subscribeToUser(userId: string): void {
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
      new prismOpus.Decoder({ rate: SAMPLE_RATE, channels: CHANNELS, frameSize: 960 })
    );

    const activeBuffer = buffer;
    pcmStream.on('data', (chunk: Buffer) => activeBuffer.write(chunk, Date.now()));

    const cleanup = () => this.activeSubscriptions.delete(userId);
    opusStream.on('end', cleanup);
    opusStream.on('error', cleanup);
    pcmStream.on('error', cleanup);
  }

  destroy(): void {
    this.receiver.speaking.removeListener('start', this.onSpeakingStart);
    this.userBuffers.clear();
    this.activeSubscriptions.clear();
  }
}

export function startRecording(guildId: string, connection: VoiceConnection): GuildRecording {
  stopRecording(guildId);
  const recording = new GuildRecording(connection);
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
