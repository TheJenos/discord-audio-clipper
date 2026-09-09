import { SlashCommandBuilder } from 'discord.js';
import * as autoJoinState from '../voice/autoJoinState';
import { config } from '../config';
import type { Command } from '../types';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('autojoin')
    .setDescription('Toggle automatically joining a voice channel once enough members gather in it.')
    .addBooleanOption((option) =>
      option.setName('enabled').setDescription('Whether auto-join should be on').setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.guild) return;

    const enabled = interaction.options.getBoolean('enabled', true);
    autoJoinState.setEnabled(interaction.guild.id, enabled);

    await interaction.reply(
      enabled
        ? `Auto-join is now **on**. I'll join and start recording once more than ${config.autoJoinMinMembers - 1} people are in a voice channel.`
        : 'Auto-join is now **off**.'
    );
  },
};

export default command;
