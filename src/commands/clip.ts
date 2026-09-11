import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import * as recorder from '../voice/recorder';
import * as mixer from '../voice/mixer';
import { config } from '../config';
import type { Command } from '../types';
import { playClipNotification } from '../voice/notifySound';

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

    let clip: mixer.Clip | null;
    try {
      clip = await mixer.createClip(recording, seconds);
    } catch (err) {
      console.error('Failed to create clip:', err);
      await interaction.editReply('Something went wrong while creating the clip.');
      return;
    }

    if (!clip) {
      await interaction.editReply("There's no audio recorded yet.");
      return;
    }

    playClipNotification(recording.connection);

    try {
      const attachment = new AttachmentBuilder(clip.filePath, { name: 'clip.mp3' });
      const content =
        clip.seconds < seconds
          ? `Here's the last ${clip.seconds} seconds (I've only been recording that long).`
          : `Here's the last ${seconds} seconds.`;
      await interaction.editReply({ content, files: [attachment] });
    } finally {
      mixer.cleanupClip(clip.filePath);
    }
  },
};

export default command;
