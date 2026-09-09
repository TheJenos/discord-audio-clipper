import { SlashCommandBuilder } from 'discord.js';
import { getVoiceConnection } from '@discordjs/voice';
import * as recorder from '../voice/recorder';
import * as leaveGrace from '../voice/leaveGrace';
import type { Command } from '../types';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Leave the voice channel and stop recording.'),

  async execute(interaction) {
    if (!interaction.guild) return;

    const connection = getVoiceConnection(interaction.guild.id);

    if (!connection) {
      await interaction.reply({ content: "I'm not in a voice channel.", ephemeral: true });
      return;
    }

    leaveGrace.cancelScheduledLeave(interaction.guild.id);
    recorder.stopRecording(interaction.guild.id);
    connection.destroy();

    await interaction.reply('Left the voice channel and cleared the recording buffer.');
  },
};

export default command;
