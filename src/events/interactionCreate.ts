import type { Client, Interaction } from "discord.js";
import { executeClose } from "../commands/close.js";
import { executeConfig } from "../commands/config.js";
import { executeDaily } from "../commands/daily.js";
import { executeRoom } from "../commands/room.js";
import { executeSetup } from "../commands/setup.js";
import { logger } from "../services/loggingService.js";

export function registerInteractionHandler(client: Client): void {
  client.on("interactionCreate", async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      switch (interaction.commandName) {
        case "setup":
          await executeSetup(interaction);
          break;
        case "config":
          await executeConfig(interaction);
          break;
        case "room":
          await executeRoom(interaction);
          break;
        case "close":
          await executeClose(interaction);
          break;
        case "daily":
          await executeDaily(interaction);
          break;
        default:
          await interaction.reply({ content: "Unknown command.", ephemeral: true });
      }
    } catch (err) {
      logger.error("ERROR", `Command ${interaction.commandName} failed`, err);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: "Something went wrong.", ephemeral: true }).catch(() => undefined);
      } else {
        await interaction.reply({ content: "Something went wrong.", ephemeral: true }).catch(() => undefined);
      }
    }
  });
}
