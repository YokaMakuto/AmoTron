import {
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type TextChannel,
} from "discord.js";
import { writeAudit } from "../database/repositories/auditRepository.js";
import { upsertUser } from "../database/repositories/userRepository.js";
import {
  createActiveRoom,
  findActiveRoom,
  findClosedRoom,
  findRoomByChannel,
  listSyncableRooms,
  updateRoomChannel,
  updateRoomStatus,
} from "../database/repositories/roomRepository.js";
import { getGuildSetup, getRemovalAction } from "./configurationService.js";
import { logger } from "./loggingService.js";
import { applyClosedPermissions, applyOpenPermissions } from "./permissionService.js";
import { hasAnyTriggerRole } from "./roleService.js";
import type { EnsureRoomResult, SyncRoomResult } from "../types/index.js";
import { buildRoomTopic, sanitizeChannelName } from "../utils/channelName.js";
import { BotError, describeDiscordError } from "../utils/errors.js";
import { buildPrivateOverwrites } from "../utils/permissions.js";

// Per-user in-memory lock: Map<guildId:userId, Promise>. Serialises concurrent
// guildMemberUpdate bursts so two simultaneous trigger-role events cannot both
// pass the "no active room" check and create duplicates. The DB unique
// constraint remains the final guard for multi-instance deployments.
const locks = new Map<string, Promise<unknown>>();

function lockKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

async function withUserLock<T>(guildId: string, userId: string, fn: () => Promise<T>): Promise<T> {
  const key = lockKey(guildId, userId);
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(key, previous.then(() => current));
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key)?.then) {
      // Only delete if no newer waiter replaced it.
      locks.delete(key);
    }
  }
}

async function fetchTextChannel(guild: Guild, channelId: string): Promise<TextChannel | null> {
  try {
    const channel = await guild.channels.fetch(channelId);
    if (channel && channel.type === ChannelType.GuildText) return channel as TextChannel;
    return null;
  } catch {
    return null;
  }
}

/**
 * Idempotent ensure: qualifies member -> DB lookup -> Discord verify ->
 * repair stale state -> create only if necessary.
 */
export async function ensureRoom(
  guild: Guild,
  member: GuildMember,
  opts: { actorUserId?: string; skipQualification?: boolean } = {},
): Promise<EnsureRoomResult> {
  return withUserLock(guild.id, member.id, async () => {
    const { config, triggerRoleIds, staffRoleIds } = await getGuildSetup(guild.id);

    if (!opts.skipQualification && !hasAnyTriggerRole(member, triggerRoleIds)) {
      throw new BotError(
        "NOT_QUALIFIED",
        "Member has no trigger role",
        `${member} does not have a private-room trigger role.`,
      );
    }

    if (!config.privateCategoryId) {
      throw new BotError(
        "NO_CATEGORY",
        "No private category configured",
        "No private category is configured. An admin must run `/setup category`.",
      );
    }

    await upsertUser({
      guildId: guild.id,
      discordUserId: member.id,
      usernameSnapshot: member.user.username,
    });

    const existing = await findActiveRoom(guild.id, member.id);
    if (existing) {
      const channel = await fetchTextChannel(guild, existing.channelId);
      if (channel) {
        logger.info("ROOM", `Existing channel found for user ${member.id}`);
        return { outcome: "reused", channelId: channel.id };
      }
      // DB says ACTIVE but Discord channel is gone -> mark DELETED, fall through.
      await updateRoomStatus(existing.id, "DELETED", { deletedAt: new Date() });
      await writeAudit({
        guildId: guild.id,
        action: "ROOM_MARKED_DELETED",
        targetUserId: member.id,
        channelId: existing.channelId,
        metadata: { reason: "channel-missing-during-ensure" },
      });
      logger.warn("ROOM", `Stale room for ${member.id} marked DELETED; recreating.`);
    }

    // Verify the category still exists and the bot can manage it there.
    // Guild-wide permission is NOT enough: category overwrites can deny the bot.
    const category = await guild.channels.fetch(config.privateCategoryId).catch(() => null);
    if (!category || category.type !== ChannelType.GuildCategory) {
      throw new BotError(
        "NO_CATEGORY",
        "Configured category missing",
        "The configured private category no longer exists. An admin must run `/setup category` again.",
      );
    }
    const me = guild.members.me;
    const canManageHere = me?.permissionsIn(category).has(PermissionFlagsBits.ManageChannels) ?? false;
    if (!canManageHere) {
      throw new BotError(
        "NO_PERMISSION",
        "Missing ManageChannels in category",
        "I don't have Manage Channels permission inside the private category. " +
          "Server Settings → Roles → enable it for my role, and check the category's ⚙ → Permissions don't deny me.",
      );
    }

    try {
      const channel = await guild.channels.create({
        // Display name = server nickname when set, otherwise the username.
        // Presentation only: the DB (guildId + discordUserId <-> channelId) is the identity.
        name: sanitizeChannelName(member.displayName),
        type: ChannelType.GuildText,
        parent: config.privateCategoryId,
        topic: buildRoomTopic(member.id),
        permissionOverwrites: buildPrivateOverwrites({
          guildEveryoneId: guild.roles.everyone.id,
          ownerUserId: member.id,
          staffRoleIds,
        }),
      });

      try {
        await createActiveRoom({
          guildId: guild.id,
          discordUserId: member.id,
          channelId: channel.id,
          categoryId: config.privateCategoryId ?? undefined,
        });
      } catch (dbErr: unknown) {
        // Lost a race (e.g. two instances): clean up the just-created channel
        // and reuse whatever won.
        const isUnique = dbErr instanceof Error && dbErr.message.includes("UNIQUE");
        logger.error("ROOM", `DB insert failed for ${member.id}, cleaning up`, dbErr);
        await channel.delete().catch(() => undefined);
        if (isUnique) {
          const winner = await findActiveRoom(guild.id, member.id);
          if (winner) return { outcome: "reused", channelId: winner.channelId };
        }
        throw dbErr;
      }

      await writeAudit({
        guildId: guild.id,
        action: "ROOM_CREATED",
        actorUserId: opts.actorUserId,
        targetUserId: member.id,
        channelId: channel.id,
      });
      logger.info("ROOM", `Created channel ${channel.id} for user ${member.id}`);

      await channel
        .send(
          `Welcome ${member}! 👋\n\nThis is your private channel.\nYou can use it to communicate privately with the staff.`,
        )
        .catch((err: unknown) => logger.warn("ROOM", `Welcome message failed: ${String(err)}`));

      return { outcome: "created", channelId: channel.id };
    } catch (err) {
      if (err instanceof BotError) throw err;
      logger.error("ROOM", `Failed to create channel for user ${member.id}`, err);
      const detail = describeDiscordError(err);
      throw new BotError(
        "CREATE_FAILED",
        `Channel creation failed: ${String(err)}`,
        detail ?? "I couldn't create the private room due to a Discord API error.",
      );
    }
  });
}

/** Called when a member lost trigger role(s); applies the configured removal policy. */
export async function handleTriggerRemoval(
  guild: Guild,
  member: GuildMember,
): Promise<{ action: string; channelId?: string }> {
  const { triggerRoleIds, staffRoleIds } = await getGuildSetup(guild.id);
  if (hasAnyTriggerRole(member, triggerRoleIds)) {
    return { action: "kept-still-qualified" };
  }

  const room = await findActiveRoom(guild.id, member.id);
  if (!room) return { action: "no-room" };

  const removalAction = await getRemovalAction(guild.id);
  const channel = await fetchTextChannel(guild, room.channelId);

  switch (removalAction) {
    case "KEEP_CHANNEL":
      return { action: "kept", channelId: room.channelId };
    case "REMOVE_USER_ACCESS":
    case "CLOSE_CHANNEL": {
      if (channel) {
        await applyClosedPermissions(channel, guild, member.id, staffRoleIds);
        await updateRoomStatus(room.id, "CLOSED", { closedAt: new Date() });
        await writeAudit({
          guildId: guild.id,
          action: "ROOM_CLOSED",
          targetUserId: member.id,
          channelId: room.channelId,
          metadata: { reason: "trigger-roles-removed", policy: removalAction },
        });
      }
      return { action: "closed", channelId: room.channelId };
    }
    case "DELETE_CHANNEL": {
      if (channel) await channel.delete().catch(() => undefined);
      await updateRoomStatus(room.id, "DELETED", { deletedAt: new Date() });
      await writeAudit({
        guildId: guild.id,
        action: "ROOM_DELETED",
        targetUserId: member.id,
        channelId: room.channelId,
        metadata: { reason: "trigger-roles-removed" },
      });
      return { action: "deleted", channelId: room.channelId };
    }
    default:
      return { action: "kept", channelId: room.channelId };
  }
}

export async function closeRoom(guild: Guild, discordUserId: string, actorUserId?: string) {
  const room = await findActiveRoom(guild.id, discordUserId);
  if (!room) throw new BotError("NO_ROOM", "No active room", "That user has no active private room.");
  const { staffRoleIds } = await getGuildSetup(guild.id);
  const channel = await fetchTextChannel(guild, room.channelId);
  if (!channel) {
    await updateRoomStatus(room.id, "DELETED", { deletedAt: new Date() });
    throw new BotError("CHANNEL_MISSING", "Channel missing", "The channel was already deleted; record marked DELETED.");
  }
  await applyClosedPermissions(channel, guild, discordUserId, staffRoleIds);
  await updateRoomStatus(room.id, "CLOSED", { closedAt: new Date() });
  await writeAudit({ guildId: guild.id, action: "ROOM_CLOSED", actorUserId, targetUserId: discordUserId, channelId: room.channelId });
  return channel;
}

export async function reopenRoom(guild: Guild, discordUserId: string, actorUserId?: string) {
  const { prisma } = await import("../database/prisma.js");
  const room = await prisma.privateRoom.findFirst({
    where: { guildId: guild.id, discordUserId, status: "CLOSED" },
    orderBy: { updatedAt: "desc" },
  });
  if (!room) throw new BotError("NO_ROOM", "No closed room", "That user has no closed private room to reopen.");
  const { staffRoleIds } = await getGuildSetup(guild.id);
  const channel = await fetchTextChannel(guild, room.channelId);
  if (!channel) {
    await updateRoomStatus(room.id, "DELETED", { deletedAt: new Date() });
    throw new BotError("CHANNEL_MISSING", "Channel missing", "The channel was deleted; record marked DELETED.");
  }
  await applyOpenPermissions(channel, guild, discordUserId, staffRoleIds);
  await updateRoomStatus(room.id, "ACTIVE", { closedAt: null });
  await writeAudit({ guildId: guild.id, action: "ROOM_REOPENED", actorUserId, targetUserId: discordUserId, channelId: room.channelId });
  return channel;
}

export async function deleteRoom(
  guild: Guild,
  discordUserId: string,
  opts: { actorUserId?: string; confirmed?: boolean } = {},
) {
  if (!opts.confirmed) {
    throw new BotError("CONFIRM_REQUIRED", "Confirmation required", "Deletion requires confirmation: `/room delete user:… confirm:True`.");
  }
  const room = await findActiveRoom(guild.id, discordUserId);
  if (!room) throw new BotError("NO_ROOM", "No active room", "That user has no active private room.");
  const channel = await fetchTextChannel(guild, room.channelId);
  if (channel) await channel.delete().catch(() => undefined);
  await updateRoomStatus(room.id, "DELETED", { deletedAt: new Date() });
  await writeAudit({ guildId: guild.id, action: "ROOM_DELETED", actorUserId: opts.actorUserId, targetUserId: discordUserId, channelId: room.channelId });
}

export async function renameRoom(guild: Guild, discordUserId: string, name: string, actorUserId?: string) {
  const room = await findActiveRoom(guild.id, discordUserId);
  if (!room) throw new BotError("NO_ROOM", "No active room", "That user has no active private room.");
  const channel = await fetchTextChannel(guild, room.channelId);
  if (!channel) {
    await updateRoomStatus(room.id, "DELETED", { deletedAt: new Date() });
    throw new BotError("CHANNEL_MISSING", "Channel missing", "The channel was already deleted; record marked DELETED.");
  }
  await channel.setName(sanitizeChannelName(name));
  await writeAudit({ guildId: guild.id, action: "ROOM_RENAMED", actorUserId, targetUserId: discordUserId, channelId: room.channelId, metadata: { name } });
  return channel;
}

/** Reconcile one user's DB record against Discord reality (ACTIVE or CLOSED). */
export async function syncRoom(guild: Guild, discordUserId: string): Promise<SyncRoomResult> {
  const activeRoom = await findActiveRoom(guild.id, discordUserId);
  const room = activeRoom ?? (await findClosedRoom(guild.id, discordUserId));
  if (!room) return { outcome: "no-room" };
  const isClosed = room.status === "CLOSED";
  const { staffRoleIds } = await getGuildSetup(guild.id);
  const channel = await fetchTextChannel(guild, room.channelId);
  if (!channel) {
    await updateRoomStatus(room.id, "DELETED", { deletedAt: new Date() });
    await writeAudit({ guildId: guild.id, action: "ROOM_SYNCED", targetUserId: discordUserId, channelId: room.channelId, metadata: { outcome: "marked-deleted" } });
    return { outcome: "marked-deleted", channelId: room.channelId };
  }
  // discord.js resolves overwrite IDs via cache; ensure owner + roles are cached.
  await guild.roles.fetch().catch(() => null);
  await guild.members.fetch(discordUserId).catch(() => null);
  if (isClosed) {
    await applyClosedPermissions(channel, guild, discordUserId, staffRoleIds);
  } else {
    await applyOpenPermissions(channel, guild, discordUserId, staffRoleIds);
  }
  await writeAudit({ guildId: guild.id, action: "ROOM_SYNCED", targetUserId: discordUserId, channelId: room.channelId, metadata: { outcome: "repaired-permissions" } });
  return { outcome: "repaired-permissions", channelId: room.channelId };
}

/** Repair permissions on every syncable room (ACTIVE + CLOSED). Used after staff-role changes. */
export async function syncAllRooms(guild: Guild): Promise<{ synced: number; missing: number; failed: number }> {
  const rooms = await listSyncableRooms(guild.id);
  const { staffRoleIds } = await getGuildSetup(guild.id);
  // discord.js resolves overwrite IDs via cache; warm it once so owner
  // user IDs and staff role IDs don't throw "not a cached User or Role".
  await guild.roles.fetch().catch(() => null);
  await guild.members.fetch().catch(() => undefined);
  let synced = 0;
  let missing = 0;
  let failed = 0;
  for (const room of rooms) {
    const channel = await fetchTextChannel(guild, room.channelId);
    if (!channel) {
      await updateRoomStatus(room.id, "DELETED", { deletedAt: new Date() });
      missing += 1;
      continue;
    }
    try {
      if (room.status === "CLOSED") {
        await applyClosedPermissions(channel, guild, room.discordUserId, staffRoleIds);
      } else {
        await applyOpenPermissions(channel, guild, room.discordUserId, staffRoleIds);
      }
      synced += 1;
    } catch (err: unknown) {
      failed += 1;
      logger.warn("ROOM", `sync-all failed for ${room.channelId}: ${String(err)}`);
    }
  }
  return { synced, missing, failed };
}

export async function handleChannelDelete(guildId: string, channelId: string): Promise<void> {
  const room = await findRoomByChannel(channelId);
  if (!room || room.status === "DELETED") return;
  await updateRoomStatus(room.id, "DELETED", { deletedAt: new Date() });
  await writeAudit({ guildId, action: "ROOM_MARKED_DELETED", targetUserId: room.discordUserId, channelId, metadata: { reason: "manual-delete" } });
  logger.info("ROOM", `Channel ${channelId} manually deleted; DB marked DELETED.`);
}

export async function handleMemberLeave(guildId: string, discordUserId: string): Promise<void> {
  const room = await findActiveRoom(guildId, discordUserId);
  if (!room) return;
  await updateRoomStatus(room.id, "USER_LEFT");
  await writeAudit({ guildId, action: "USER_LEFT", targetUserId: discordUserId, channelId: room.channelId });
  logger.info("ROOM", `User ${discordUserId} left; room ${room.channelId} marked USER_LEFT.`);
}

export { updateRoomChannel };
