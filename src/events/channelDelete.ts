import type { Client } from "discord.js";
import { logger } from "../services/loggingService.js";
import { handleChannelDelete } from "../services/privateRoomService.js";

export function registerChannelDeleteHandler(client: Client): void {
  client.on("channelDelete", async (channel) => {
    try {
      if (!("guild" in channel) || !channel.guild) return;
      await handleChannelDelete(channel.guild.id, channel.id);
    } catch (err) {
      logger.error("ERROR", "channelDelete handling failed", err);
    }
  });
}
