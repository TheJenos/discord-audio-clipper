import 'dotenv/config';
import path from 'node:path';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  token: requireEnv('DISCORD_TOKEN'),
  clientId: requireEnv('CLIENT_ID'),
  guildId: process.env.GUILD_ID || null,
  recordWindowSeconds: Number(process.env.RECORD_WINDOW_SECONDS) || 300,
  defaultClipSeconds: Number(process.env.DEFAULT_CLIP_SECONDS) || 300,
  // Auto-join triggers once a channel has at least this many humans in it
  // (default 4, i.e. "more than 3").
  autoJoinMinMembers: Number(process.env.AUTO_JOIN_MIN_MEMBERS) || 3,
  // How long to wait after a voice channel empties before actually leaving,
  // in case everyone just briefly dropped out.
  leaveGraceSeconds: Number(process.env.LEAVE_GRACE_SECONDS) || 10,
  // Where per-guild settings (auto-join on/off, excluded channels) are persisted.
  dataDir: process.env.DATA_DIR || path.join(process.cwd(), 'data'),
  // How many seconds "clip that" grabs, once /voiceclip is enabled for a server.
  wakeWordClipSeconds: Number(process.env.WAKE_WORD_CLIP_SECONDS) || 30,
  // Picovoice Porcupine wake-word engine, used to detect "clip that" being
  // spoken. Both must be set for /voiceclip to be usable - see docs/GUIDE.md.
  porcupineAccessKey: process.env.PORCUPINE_ACCESS_KEY || null,
  porcupineKeywordPath: process.env.PORCUPINE_KEYWORD_PATH || null,
  porcupineSensitivity: Number(process.env.PORCUPINE_SENSITIVITY) || 0.5,
};
