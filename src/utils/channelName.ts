// Channel names are presentation only — never identity. The database
// (guildId + discordUserId <-> channelId) is authoritative.
// Names are just the member's server display name, sanitized.

const MAX_NAME_LENGTH = 90;

/** Convert an arbitrary display name into a safe Discord channel name. */
export function sanitizeChannelName(username: string): string {
  let safe = username
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!safe) safe = "user";
  return safe.substring(0, MAX_NAME_LENGTH);
}

/** Recovery topic format: private-room:user:<discordUserId> */
export function buildRoomTopic(discordUserId: string): string {
  return `private-room:user:${discordUserId}`;
}

/** Parse a recovery topic back into a user id, or null. */
export function parseRoomTopic(topic: string | null | undefined): string | null {
  if (!topic) return null;
  const match = /^private-room:user:(\d+)$/.exec(topic.trim());
  return match?.[1] ?? null;
}
