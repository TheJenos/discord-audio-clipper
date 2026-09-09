import { ChannelType, SlashCommandBuilder } from 'discord.js';
import * as settingsStore from '../store/settingsStore';
import { config } from '../config';
import type { Command } from '../types';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('autojoin')
    .setDescription('Configure automatically joining busy voice channels.')
    .addSubcommand((sub) => sub.setName('enable').setDescription('Turn auto-join on for this server'))
    .addSubcommand((sub) => sub.setName('disable').setDescription('Turn auto-join off for this server'))
    .addSubcommand((sub) => sub.setName('status').setDescription('Show the current auto-join settings'))
    .addSubcommandGroup((group) =>
      group
        .setName('exclude')
        .setDescription('Manage voice channels that never trigger auto-join')
        .addSubcommand((sub) =>
          sub
            .setName('add')
            .setDescription('Exclude a voice channel from auto-join')
            .addChannelOption((option) =>
              option
                .setName('channel')
                .setDescription('The voice channel to exclude')
                .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
                .setRequired(true)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName('remove')
            .setDescription('Let a previously excluded voice channel trigger auto-join again')
            .addChannelOption((option) =>
              option
                .setName('channel')
                .setDescription('The voice channel to re-allow')
                .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
                .setRequired(true)
            )
        )
    ),

  async execute(interaction) {
    if (!interaction.guild) return;
    const guildId = interaction.guild.id;

    if (interaction.options.getSubcommandGroup(false) === 'exclude') {
      const channel = interaction.options.getChannel('channel', true);

      if (interaction.options.getSubcommand() === 'add') {
        settingsStore.excludeChannel(guildId, channel.id);
        await interaction.reply(`**${channel.name}** is now excluded from auto-join.`);
      } else {
        settingsStore.includeChannel(guildId, channel.id);
        await interaction.reply(`**${channel.name}** can trigger auto-join again.`);
      }
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'enable' || sub === 'disable') {
      const enabled = sub === 'enable';
      settingsStore.setAutoJoinEnabled(guildId, enabled);
      await interaction.reply(
        enabled
          ? `Auto-join is now **on**. I'll join and start recording once more than ${
              config.autoJoinMinMembers - 1
            } people are in a voice channel (unless it's excluded).`
          : 'Auto-join is now **off**.'
      );
      return;
    }

    // status
    const settings = settingsStore.getGuildSettings(guildId);
    const excludedList = settings.autoJoinExcludedChannelIds.length
      ? settings.autoJoinExcludedChannelIds.map((id) => `<#${id}>`).join(', ')
      : 'none';

    await interaction.reply(
      `Auto-join is **${settings.autoJoinEnabled ? 'on' : 'off'}** ` +
        `(triggers once a channel has more than ${config.autoJoinMinMembers - 1} people).\n` +
        `Excluded channels: ${excludedList}`
    );
  },
};

export default command;
