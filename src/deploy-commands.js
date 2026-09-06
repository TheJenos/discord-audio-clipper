const { REST, Routes } = require('discord.js');
const config = require('./config');

const commands = ['join', 'leave', 'clip'].map((name) => require(`./commands/${name}`).data.toJSON());

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
