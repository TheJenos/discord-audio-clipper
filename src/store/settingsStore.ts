import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';

// Per-guild settings, persisted to a JSON file so they survive restarts.
export interface GuildSettings {
  autoJoinEnabled: boolean;
  autoJoinExcludedChannelIds: string[];
}

const DEFAULT_SETTINGS: GuildSettings = {
  autoJoinEnabled: false,
  autoJoinExcludedChannelIds: [],
};

const dataFile = path.join(config.dataDir, 'settings.json');

type StoreShape = Record<string, GuildSettings>;

function load(): StoreShape {
  try {
    return JSON.parse(fs.readFileSync(dataFile, 'utf8')) as StoreShape;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`Failed to read settings file at ${dataFile}, starting with empty settings:`, err);
    }
    return {};
  }
}

let cache: StoreShape = load();

function persist(): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmpFile = `${dataFile}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(cache, null, 2));
  fs.renameSync(tmpFile, dataFile);
}

export function getGuildSettings(guildId: string): GuildSettings {
  return cache[guildId] ?? DEFAULT_SETTINGS;
}

function updateGuildSettings(guildId: string, update: Partial<GuildSettings>): GuildSettings {
  const next = { ...getGuildSettings(guildId), ...update };
  cache[guildId] = next;
  persist();
  return next;
}

export function setAutoJoinEnabled(guildId: string, enabled: boolean): void {
  updateGuildSettings(guildId, { autoJoinEnabled: enabled });
}

export function isAutoJoinEnabled(guildId: string): boolean {
  return getGuildSettings(guildId).autoJoinEnabled;
}

export function excludeChannel(guildId: string, channelId: string): void {
  const { autoJoinExcludedChannelIds } = getGuildSettings(guildId);
  if (autoJoinExcludedChannelIds.includes(channelId)) return;
  updateGuildSettings(guildId, {
    autoJoinExcludedChannelIds: [...autoJoinExcludedChannelIds, channelId],
  });
}

export function includeChannel(guildId: string, channelId: string): void {
  const { autoJoinExcludedChannelIds } = getGuildSettings(guildId);
  updateGuildSettings(guildId, {
    autoJoinExcludedChannelIds: autoJoinExcludedChannelIds.filter((id) => id !== channelId),
  });
}

export function isChannelExcluded(guildId: string, channelId: string): boolean {
  return getGuildSettings(guildId).autoJoinExcludedChannelIds.includes(channelId);
}
