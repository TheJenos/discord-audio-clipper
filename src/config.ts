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
  // sherpa-onnx keyword-spotting model (free, offline, no account needed),
  // used to detect "clip that" being spoken. All five KWS_* paths must be
  // set for /voiceclip to be usable - see docs/GUIDE.md.
  kwsEncoderPath: process.env.KWS_ENCODER_PATH || null,
  kwsDecoderPath: process.env.KWS_DECODER_PATH || null,
  kwsJoinerPath: process.env.KWS_JOINER_PATH || null,
  kwsTokensPath: process.env.KWS_TOKENS_PATH || null,
  kwsKeywordsPath: process.env.KWS_KEYWORDS_PATH || null,
  // Optional overrides for the boosting score / triggering threshold baked
  // into the keywords file - leave unset to use the file's own values.
  kwsScore: process.env.KWS_SCORE ? Number(process.env.KWS_SCORE) : undefined,
  kwsThreshold: process.env.KWS_THRESHOLD ? Number(process.env.KWS_THRESHOLD) : undefined,
};
