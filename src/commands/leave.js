const { SlashCommandBuilder } = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');
const recorder = require('../voice/recorder');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Leave the voice channel and stop recording.'),

  async execute(interaction) {
    const connection = getVoiceConnection(interaction.guild.id);

    if (!connection) {
      await interaction.reply({ content: "I'm not in a voice channel.", ephemeral: true });
      return;
    }

    recorder.stopRecording(interaction.guild.id);
    connection.destroy();

    await interaction.reply('Left the voice channel and cleared the recording buffer.');
  },
};
