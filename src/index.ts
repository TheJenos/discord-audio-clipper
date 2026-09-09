import { Client, GatewayIntentBits, Collection } from 'discord.js';
import { getVoiceConnection } from '@discordjs/voice';
import { config } from './config';
import * as recorder from './voice/recorder';
import { connectAndRecord } from './voice/connect';
import * as autoJoinState from './voice/autoJoinState';
import type { Command } from './types';
import joinCommand from './commands/join';
import leaveCommand from './commands/leave';
import clipCommand from './commands/clip';
import autojoinCommand from './commands/autojoin';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.commands = new Collection<string, Command>();
for (const command of [joinCommand, leaveCommand, clipCommand, autojoinCommand]) {
  client.commands.set(command.data.name, command);
}

client.once('clientReady', (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  // The app can be installed in a server with only the `applications.commands`
  // scope, in which case the commands show up but the bot user is not a member
  // and `interaction.guild` is null. Answer explicitly rather than falling
  // through to a silent 3-second interaction timeout.
  if (!interaction.guild) {
    await interaction.reply({
      content:
        "I'm not a member of this server, so I can't use its voice channels. " +
        'Ask an admin to re-invite me with the `bot` scope.',
      ephemeral: true,
    });
    return;
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`Error executing /${interaction.commandName}:`, err);
    const content = 'There was an error running this command.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ content, ephemeral: true });
    }
  }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  const guild = newState.guild;
  const connection = getVoiceConnection(guild.id);

  // Leave and stop recording automatically once everyone else has left the channel.
  if (connection) {
    const channel = guild.members.me?.voice.channel;
    if (channel) {
      const humansRemaining = channel.members.filter((m) => !m.user.bot).size;
      if (humansRemaining === 0) {
        recorder.stopRecording(guild.id);
        connection.destroy();
      }
    }
    return;
  }

  // Auto-join a channel once enough members have gathered in it, if enabled for this guild.
  if (!autoJoinState.isEnabled(guild.id)) return;

  const channel = newState.channel;
  if (!channel) return;

  const humanCount = channel.members.filter((m) => !m.user.bot).size;
  if (humanCount < config.autoJoinMinMembers) return;

  try {
    await connectAndRecord(channel);
  } catch (err) {
    console.error(`Auto-join failed in guild ${guild.id}:`, err);
  }
});

client.login(config.token);
