// Delays auto-leaving an emptied voice channel, in case everyone rejoins
// within a few seconds (e.g. a client hiccup or a quick channel hop).
const pendingLeaves = new Map<string, NodeJS.Timeout>();

export function scheduleLeave(guildId: string, delayMs: number, onLeave: () => void): void {
  if (pendingLeaves.has(guildId)) return;
  const timer = setTimeout(() => {
    pendingLeaves.delete(guildId);
    onLeave();
  }, delayMs);
  pendingLeaves.set(guildId, timer);
}

export function cancelScheduledLeave(guildId: string): void {
  const timer = pendingLeaves.get(guildId);
  if (timer) {
    clearTimeout(timer);
    pendingLeaves.delete(guildId);
  }
}
