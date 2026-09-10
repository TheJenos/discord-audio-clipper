import { AttachmentBuilder } from 'discord.js';
import type { VoiceBasedChannel } from 'discord.js';
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

  const clip = await mixer.createClip(recording, config.wakeWordClipSeconds);
  if (!clip) return;

  try {
    const content = `🎙️ Someone said "clip that" — here's the last ${clip.seconds} seconds.`;
    const posted = await postToFirstAvailable(channel, clip.filePath, content);
    if (!posted) {
      console.error(
        `Could not post the "clip that" clip anywhere in guild ${guildId} - the bot has no channel ` +
          'it can send to there (check View Channel + Send Messages permissions).'
      );
    }
  } finally {
    mixer.cleanupClip(clip.filePath);
  }
}

// Tries the configured channel first (if set), then falls back to the voice
// channel's own text chat, so a misconfigured or permission-denied custom
// channel doesn't silently drop the clip.
async function postToFirstAvailable(channel: VoiceBasedChannel, filePath: string, content: string): Promise<boolean> {
  const guildId = channel.guild.id;
  const { voiceClipChannelId } = settingsStore.getGuildSettings(guildId);

  if (voiceClipChannelId) {
    try {
      const configured = await channel.guild.channels.fetch(voiceClipChannelId);
      if (configured?.isSendable()) {
        await configured.send({ content, files: [new AttachmentBuilder(filePath, { name: 'clip.mp3' })] });
        return true;
      }
      console.error(`Configured voice-clip channel ${voiceClipChannelId} in guild ${guildId} isn't sendable.`);
    } catch (err) {
      console.error(
        `Could not post to the configured voice-clip channel (${voiceClipChannelId}) in guild ${guildId} ` +
          "- check the bot has View Channel + Send Messages there. Falling back to the voice channel's own chat:",
        err
      );
    }
  }

  if (channel.isSendable()) {
    try {
      await channel.send({ content, files: [new AttachmentBuilder(filePath, { name: 'clip.mp3' })] });
      return true;
    } catch (err) {
      console.error(`Could not post to voice channel ${channel.id} in guild ${guildId}:`, err);
    }
  }

  return false;
}
