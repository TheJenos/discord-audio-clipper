import { Client, GatewayIntentBits, Collection } from 'discord.js';
import { getVoiceConnection } from '@discordjs/voice';
import { config } from './config';
import * as recorder from './voice/recorder';
import type { Command } from './types';
import joinCommand from './commands/join';
import leaveCommand from './commands/leave';
import clipCommand from './commands/clip';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.commands = new Collection<string, Command>();
for (const command of [joinCommand, leaveCommand, clipCommand]) {
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

// Leave and stop recording automatically once everyone else has left the channel.
client.on('voiceStateUpdate', (oldState) => {
  const guild = oldState.guild;
  const connection = getVoiceConnection(guild.id);
  if (!connection) return;

  const channel = guild.members.me?.voice.channel;
  if (!channel) return;

  const humansRemaining = channel.members.filter((m) => !m.user.bot).size;
  if (humansRemaining === 0) {
    recorder.stopRecording(guild.id);
    connection.destroy();
  }
});

client.login(config.token);
