import type { Client } from "discord.js";
import { logger } from "../services/loggingService.js";
import { handleMemberLeave } from "../services/privateRoomService.js";

export function registerGuildMemberRemoveHandler(client: Client): void {
  client.on("guildMemberRemove", async (member) => {
    try {
      await handleMemberLeave(member.guild.id, member.id);
    } catch (err) {
      logger.error("ERROR", "guildMemberRemove handling failed", err);
    }
  });
}
