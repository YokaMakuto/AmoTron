import type { Client, GuildMember, PartialGuildMember } from "discord.js";
import { writeAudit } from "../database/repositories/auditRepository.js";
import { getGuildSetup } from "../services/configurationService.js";
import { logger } from "../services/loggingService.js";
import { ensureRoom, handleTriggerRemoval } from "../services/privateRoomService.js";
import {
  getNewlyAddedTriggerRoles,
  getRemovedTriggerRoles,
} from "../services/roleService.js";

// Thin listener: diff old/new roles, delegate to services. Business logic
// lives in RoleService/PrivateRoomService, never here.
export function registerGuildMemberUpdateHandler(client: Client): void {
  client.on("guildMemberUpdate", async (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) => {
    try {
      const guild = newMember.guild;
      const { triggerRoleIds } = await getGuildSetup(guild.id);
      if (triggerRoleIds.length === 0) return;

      const fullOld = oldMember as GuildMember;
      if (!fullOld.roles?.cache) return; // partial without role data: skip safely

      const added = getNewlyAddedTriggerRoles(fullOld, newMember, triggerRoleIds);
      const removed = getRemovedTriggerRoles(fullOld, newMember, triggerRoleIds);
      if (added.length === 0 && removed.length === 0) return;

      for (const roleId of added) {
        logger.info("ROLE", `User ${newMember.id} received trigger role ${roleId}`);
        await writeAudit({ guildId: guild.id, action: "ROLE_ADDED", targetUserId: newMember.id, roleId });
      }
      for (const roleId of removed) {
        logger.info("ROLE", `User ${newMember.id} lost trigger role ${roleId}`);
        await writeAudit({ guildId: guild.id, action: "ROLE_REMOVED", targetUserId: newMember.id, roleId });
      }

      if (added.length > 0) {
        const result = await ensureRoom(guild, newMember);
        logger.info(
          "ROOM",
          result.outcome === "created"
            ? `Created channel ${result.channelId} for user ${newMember.id}`
            : `Existing channel found for user ${newMember.id}`,
        );
      } else if (removed.length > 0) {
        const outcome = await handleTriggerRemoval(guild, newMember);
        logger.info("ROOM", `Trigger removal for ${newMember.id}: ${outcome.action}`);
      }
    } catch (err) {
      logger.error("ERROR", "guildMemberUpdate handling failed", err);
    }
  });
}
