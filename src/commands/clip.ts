import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import * as recorder from '../voice/recorder';
import * as mixer from '../voice/mixer';
import { config } from '../config';
import type { Command } from '../types';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('clip')
    .setDescription('Create an audio clip from the recorded conversation.')
    .addIntegerOption((option) =>
      option
        .setName('seconds')
        .setDescription(
          `How many seconds back to clip (default ${config.defaultClipSeconds}, max ${config.recordWindowSeconds}).`
        )
        .setMinValue(1)
        .setMaxValue(config.recordWindowSeconds)
    ),

  async execute(interaction) {
    if (!interaction.guild) return;

    const recording = recorder.getRecording(interaction.guild.id);

    if (!recording) {
      await interaction.reply({
        content: "I'm not currently recording in this server. Use `/join` first.",
        ephemeral: true,
      });
      return;
    }

    const seconds = interaction.options.getInteger('seconds') ?? config.defaultClipSeconds;

    await interaction.deferReply();

    let filePath: string | null;
    try {
      filePath = await mixer.createClip(recording, seconds);
    } catch (err) {
      console.error('Failed to create clip:', err);
      await interaction.editReply('Something went wrong while creating the clip.');
      return;
    }

    if (!filePath) {
      await interaction.editReply("There's no audio recorded yet.");
      return;
    }

    try {
      const attachment = new AttachmentBuilder(filePath, { name: 'clip.mp3' });
      await interaction.editReply({
        content: `Here's the last ${seconds} seconds.`,
        files: [attachment],
      });
    } finally {
      mixer.cleanupClip(filePath);
    }
  },
};

export default command;
