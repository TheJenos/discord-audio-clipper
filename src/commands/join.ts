import { SlashCommandBuilder } from 'discord.js';
import { joinVoiceChannel, VoiceConnectionStatus, entersState } from '@discordjs/voice';
import * as recorder from '../voice/recorder';
import type { Command } from '../types';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('join')
    .setDescription('Join your voice channel and start recording a rolling buffer of the conversation.'),

  async execute(interaction) {
    if (!interaction.guild) return;

    const member = await interaction.guild.members.fetch(interaction.user.id);
    const channel = member.voice.channel;

    if (!channel) {
      await interaction.reply({
        content: 'You need to be in a voice channel first.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    } catch {
      connection.destroy();
      await interaction.editReply('Could not connect to the voice channel in time.');
      return;
    }

    recorder.startRecording(channel.guild.id, connection);

    await interaction.editReply(
      `Joined **${channel.name}** and started recording. Use \`/clip\` any time to grab the last few minutes.`
    );
  },
};

export default command;
