import { ChannelType, SlashCommandBuilder } from 'discord.js';
import * as settingsStore from '../store/settingsStore';
import * as wakeWord from '../voice/wakeWord';
import { config } from '../config';
import type { Command } from '../types';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('voiceclip')
    .setDescription('Configure auto-clipping when someone says "clip that" in voice.')
    .addSubcommand((sub) =>
      sub.setName('enable').setDescription('Turn on auto-clipping for "clip that" in this server')
    )
    .addSubcommand((sub) =>
      sub.setName('disable').setDescription('Turn off auto-clipping for "clip that" in this server')
    )
    .addSubcommand((sub) => sub.setName('status').setDescription('Show the current voice-clip settings'))
    .addSubcommandGroup((group) =>
      group
        .setName('channel')
        .setDescription('Where "clip that" clips get posted')
        .addSubcommand((sub) =>
          sub
            .setName('set')
            .setDescription('Post "clip that" clips to a specific channel instead of the voice chat')
            .addChannelOption((option) =>
              option
                .setName('channel')
                .setDescription('The text channel to post clips to')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(true)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName('clear')
            .setDescription("Go back to posting in the voice channel's own text chat")
        )
    ),

  async execute(interaction) {
    if (!interaction.guild) return;
    const guildId = interaction.guild.id;

    if (interaction.options.getSubcommandGroup(false) === 'channel') {
      if (interaction.options.getSubcommand() === 'set') {
        const channel = interaction.options.getChannel('channel', true);
        settingsStore.setVoiceClipChannel(guildId, channel.id);
        await interaction.reply(`"clip that" clips will now be posted in **#${channel.name}**.`);
      } else {
        settingsStore.setVoiceClipChannel(guildId, null);
        await interaction.reply(
          "\"clip that\" clips will now be posted in whichever voice channel's chat it was said in."
        );
      }
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'enable' || sub === 'disable') {
      if (sub === 'enable' && !wakeWord.isConfigured()) {
        await interaction.reply({
          content:
            'This bot has not been set up for wake-word detection yet — the KWS_* environment ' +
            'variables need to be configured by whoever runs it. See docs/GUIDE.md for how to set ' +
            'those up (free, no account needed).',
          ephemeral: true,
        });
        return;
      }

      const enabled = sub === 'enable';
      settingsStore.setVoiceClipEnabled(guildId, enabled);
      await interaction.reply(
        enabled
          ? `"clip that" detection is now **on**. Say it while I'm recording and I'll post the last ` +
              `${config.wakeWordClipSeconds} seconds.`
          : '"clip that" detection is now **off**.'
      );
      return;
    }

    // status
    const settings = settingsStore.getGuildSettings(guildId);
    const destination = settings.voiceClipChannelId
      ? `<#${settings.voiceClipChannelId}>`
      : "the voice channel's own chat";

    await interaction.reply(
      `"clip that" detection is **${settings.voiceClipEnabled ? 'on' : 'off'}** ` +
        `(grabs the last ${config.wakeWordClipSeconds} seconds).\n` +
        `Posts to: ${destination}.\n` +
        `Wake-word engine configured on this bot: ${wakeWord.isConfigured() ? 'yes' : 'no'}.`
    );
  },
};

export default command;
