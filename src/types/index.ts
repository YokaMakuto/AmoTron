// Shared domain types. The database is the source of truth for identity:
// guildId + discordUserId <-> channelId. Names are presentation only.

export type RoomStatus = "ACTIVE" | "CLOSED" | "DELETED" | "USER_LEFT";

export type RemovalAction =
  | "KEEP_CHANNEL"
  | "REMOVE_USER_ACCESS"
  | "CLOSE_CHANNEL"
  | "DELETE_CHANNEL";

export const ROOM_STATUSES: readonly RoomStatus[] = [
  "ACTIVE",
  "CLOSED",
  "DELETED",
  "USER_LEFT",
];

export const REMOVAL_ACTIONS: readonly RemovalAction[] = [
  "KEEP_CHANNEL",
  "REMOVE_USER_ACCESS",
  "CLOSE_CHANNEL",
  "DELETE_CHANNEL",
];

export function isRoomStatus(value: string): value is RoomStatus {
  return (ROOM_STATUSES as readonly string[]).includes(value);
}

export function isRemovalAction(value: string): value is RemovalAction {
  return (REMOVAL_ACTIONS as readonly string[]).includes(value);
}

export type AuditAction =
  | "CONFIG_TRIGGER_ROLE_ADDED"
  | "CONFIG_TRIGGER_ROLE_REMOVED"
  | "CONFIG_STAFF_ROLE_ADDED"
  | "CONFIG_STAFF_ROLE_REMOVED"
  | "CONFIG_CATEGORY_SET"
  | "CONFIG_REMOVAL_ACTION_SET"
  | "CONFIG_LOG_CHANNEL_SET"
  | "ROOM_CREATED"
  | "ROOM_REUSED"
  | "ROOM_CLOSED"
  | "ROOM_REOPENED"
  | "ROOM_DELETED"
  | "ROOM_RENAMED"
  | "ROOM_SYNCED"
  | "ROOM_MARKED_DELETED"
  | "ROLE_ADDED"
  | "ROLE_REMOVED"
  | "USER_LEFT"
  | "CONFIG_DAILY_CHANNEL_SET"
  | "CONFIG_DAILY_TIME_SET"
  | "CONFIG_DAILY_ENABLED"
  | "CONFIG_DAILY_DISABLED"
  | "DAILY_POSTED"
  | "DAILY_REQUESTED"
  | "DAILY_SOLUTION_REVEALED";

export interface EnsureRoomResult {
  /** "created" when a new channel was made, "reused" when an existing one was returned. */
  outcome: "created" | "reused";
  channelId: string;
}

export interface SyncRoomResult {
  outcome: "in-sync" | "repaired-permissions" | "marked-deleted" | "no-room";
  channelId?: string;
}
