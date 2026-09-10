import type { Guild } from "discord.js";
import { listActiveRooms, updateRoomStatus } from "../database/repositories/roomRepository.js";
import { getGuildSetup } from "./configurationService.js";
import { logger } from "./loggingService.js";
import { ensureRoom } from "./privateRoomService.js";
import { hasAnyTriggerRole } from "./roleService.js";
import { validateGuildSetup } from "../utils/validation.js";

/**
 * Startup reconciliation (for bots that are not online 24/7):
 *
 * Phase 1 — stale check: mark ACTIVE rows DELETED when their Discord
 * channel is gone. Never blindly recreates.
 *
 * Phase 2 — catch-up sweep: Discord does NOT replay missed
 * guildMemberUpdate events, so anyone granted a trigger role while the
 * bot was offline would never get a room. Fetch all members and run the
 * idempotent ensureRoom() for every trigger-role holder missing a room.
 */
export async function reconcileOnStartup(guild: Guild): Promise<void> {
  const { config, triggerRoleIds, staffRoleIds } = await getGuildSetup(guild.id);

  for (const w of validateGuildSetup(guild, {
    categoryId: config.privateCategoryId,
    staffRoleIds,
    triggerRoleIds,
  })) {
    logger.warn("STARTUP", w.message);
  }

  let checked = 0;
  let stale = 0;
  for (const room of await listActiveRooms(guild.id)) {
    checked += 1;
    try {
      await guild.channels.fetch(room.channelId);
    } catch {
      await updateRoomStatus(room.id, "DELETED", { deletedAt: new Date() });
      stale += 1;
      logger.warn("RECOVERY", `Stale room ${room.channelId} (user ${room.discordUserId}) marked DELETED.`);
    }
  }
  logger.info("RECOVERY", `Reconciled ${checked} active rooms, ${stale} stale.`);

  if (triggerRoleIds.length === 0 || !config.privateCategoryId) {
    logger.info("RECOVERY", "Catch-up sweep skipped (no trigger roles or no category configured).");
    return;
  }

  let members;
  try {
    members = await guild.members.fetch();
  } catch (err) {
    logger.warn("RECOVERY", `Catch-up sweep skipped: could not fetch members: ${String(err)}`);
    return;
  }

  let created = 0;
  let reused = 0;
  let failed = 0;
  for (const [, member] of members) {
    if (member.user.bot) continue;
    if (!hasAnyTriggerRole(member, triggerRoleIds)) continue;
    try {
      const result = await ensureRoom(guild, member);
      if (result.outcome === "created") {
        created += 1;
      } else {
        reused += 1;
      }
    } catch (err) {
      failed += 1;
      logger.warn(
        "RECOVERY",
        `Catch-up failed for user ${member.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  logger.info(
    "RECOVERY",
    `Catch-up sweep done: ${created} created, ${reused} already had rooms, ${failed} failed.`,
  );
}
