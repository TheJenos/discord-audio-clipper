require('dotenv').config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

module.exports = {
  token: requireEnv('DISCORD_TOKEN'),
  clientId: requireEnv('CLIENT_ID'),
  guildId: process.env.GUILD_ID || null,
  recordWindowSeconds: Number(process.env.RECORD_WINDOW_SECONDS) || 300,
  defaultClipSeconds: Number(process.env.DEFAULT_CLIP_SECONDS) || 300,
};
