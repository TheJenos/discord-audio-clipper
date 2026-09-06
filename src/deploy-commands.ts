import { REST, Routes } from 'discord.js';
import { config } from './config';
import joinCommand from './commands/join';
import leaveCommand from './commands/leave';
import clipCommand from './commands/clip';

const commands = [joinCommand, leaveCommand, clipCommand].map((command) => command.data.toJSON());

const rest = new REST().setToken(config.token);

(async () => {
  try {
    const route = config.guildId
      ? Routes.applicationGuildCommands(config.clientId, config.guildId)
      : Routes.applicationCommands(config.clientId);

    await rest.put(route, { body: commands });

    console.log(
      `Registered ${commands.length} slash command(s)${config.guildId ? ` to guild ${config.guildId}` : ' globally'}.`
    );
  } catch (err) {
    console.error('Failed to register slash commands:', err);
    process.exitCode = 1;
  }
})();
