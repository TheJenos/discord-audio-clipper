import { SlashCommandBuilder } from 'discord.js';
import { connectAndRecord } from '../voice/connect';
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

    try {
      await connectAndRecord(channel);
    } catch {
      await interaction.editReply('Could not connect to the voice channel in time.');
      return;
    }

    await interaction.editReply(
      `Joined **${channel.name}** and started recording. Use \`/clip\` any time to grab the last few minutes.`
    );
  },
};

export default command;
