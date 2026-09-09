import { AttachmentBuilder } from 'discord.js';
import type { VoiceBasedChannel, SendableChannels } from 'discord.js';
import type { GuildRecording } from './recorder';
import * as mixer from './mixer';
import * as settingsStore from '../store/settingsStore';
import { config } from '../config';

// Debounces repeated triggers (e.g. several people saying the phrase around
// the same time, or someone repeating it) into a single clip.
const DEBOUNCE_MS = 10_000;
const lastTriggerAtByGuild = new Map<string, number>();

// Wires a recording's "clip that" detections to posting a clip. Called once
// per connection, right after recording starts.
export function attachWakeWordHandler(channel: VoiceBasedChannel, recording: GuildRecording): void {
  recording.on('wakeword', () => {
    void handleWake(channel, recording).catch((err) => {
      console.error(`Failed to auto-clip on wake word in guild ${channel.guild.id}:`, err);
    });
  });
}

async function handleWake(channel: VoiceBasedChannel, recording: GuildRecording): Promise<void> {
  const guildId = channel.guild.id;
  const now = Date.now();
  if (now - (lastTriggerAtByGuild.get(guildId) ?? 0) < DEBOUNCE_MS) return;
  lastTriggerAtByGuild.set(guildId, now);

  const destination = await resolveDestination(channel);
  if (!destination) return;

  const clip = await mixer.createClip(recording, config.wakeWordClipSeconds);
  if (!clip) return;

  try {
    const attachment = new AttachmentBuilder(clip.filePath, { name: 'clip.mp3' });
    await destination.send({
      content: `🎙️ Someone said "clip that" — here's the last ${clip.seconds} seconds.`,
      files: [attachment],
    });
  } finally {
    mixer.cleanupClip(clip.filePath);
  }
}

// The configured channel, if set and still usable; otherwise the voice
// channel's own text chat.
async function resolveDestination(channel: VoiceBasedChannel): Promise<SendableChannels | null> {
  const { voiceClipChannelId } = settingsStore.getGuildSettings(channel.guild.id);

  if (voiceClipChannelId) {
    try {
      const configured = await channel.guild.channels.fetch(voiceClipChannelId);
      if (configured?.isSendable()) return configured;
      console.error(`Configured voice-clip channel ${voiceClipChannelId} in guild ${channel.guild.id} isn't sendable.`);
    } catch (err) {
      console.error(`Could not fetch configured voice-clip channel ${voiceClipChannelId}:`, err);
    }
  }

  return channel.isSendable() ? channel : null;
}
