import type { Client } from "discord.js";
import { startDailyScheduler } from "../services/dailyScheduler.js";
import { logger } from "../services/loggingService.js";
import { reconcileOnStartup } from "../services/recoveryService.js";

export function registerReadyHandler(client: Client): void {
  client.once("ready", async () => {
    logger.info("STARTUP", "==========================================");
    logger.info("STARTUP", "          AMO DISCORD BOT ONLINE");
    logger.info("STARTUP", "==========================================");
    logger.info("STARTUP", `Bot: ${client.user?.tag} (${client.user?.id})`);

    for (const [, guild] of client.guilds.cache) {
      try {
        await reconcileOnStartup(guild);
      } catch (err) {
        logger.error("STARTUP", `Recovery failed for guild ${guild.id}`, err);
      }
    }
    startDailyScheduler(client);
    logger.info("STARTUP", "Private room system is active.");
  });
}
