// Per-guild toggle for automatically joining a voice channel once enough
// members gather in it. Toggled via the /autojoin command.
const enabledGuilds = new Set<string>();

export function isEnabled(guildId: string): boolean {
  return enabledGuilds.has(guildId);
}

export function setEnabled(guildId: string, enabled: boolean): void {
  if (enabled) {
    enabledGuilds.add(guildId);
  } else {
    enabledGuilds.delete(guildId);
  }
}
