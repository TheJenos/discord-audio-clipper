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

client.once('ready', (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`Error executing /${interaction.commandName}:`, err);
    const payload = { content: 'There was an error running this command.', ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload);
    } else {
      await interaction.reply(payload);
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
