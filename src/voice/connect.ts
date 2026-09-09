import { joinVoiceChannel, VoiceConnectionStatus, entersState, VoiceConnection } from '@discordjs/voice';
import type { VoiceBasedChannel } from 'discord.js';
import * as recorder from './recorder';

// Joins a voice channel and starts recording. Shared by /join and auto-join so
// both paths connect the same way.
export async function connectAndRecord(channel: VoiceBasedChannel): Promise<VoiceConnection> {
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
  } catch (err) {
    connection.destroy();
    throw err;
  }

  recorder.startRecording(channel.guild.id, connection);
  return connection;
}
