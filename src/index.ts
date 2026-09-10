import { env } from "./config/env.js";
import { createClient } from "./client/createClient.js";
import { prisma } from "./database/prisma.js";
import { registerChannelDeleteHandler } from "./events/channelDelete.js";
import { registerGuildMemberUpdateHandler } from "./events/guildMemberUpdate.js";
import { registerGuildMemberRemoveHandler } from "./events/guildMemberRemove.js";
import { registerInteractionHandler } from "./events/interactionCreate.js";
import { registerReadyHandler } from "./events/ready.js";
import { logger } from "./services/loggingService.js";

async function main(): Promise<void> {
  logger.info("STARTUP", "Connecting to database...");
  await prisma.$connect();

  const client = createClient();
  registerReadyHandler(client);
  registerGuildMemberUpdateHandler(client);
  registerChannelDeleteHandler(client);
  registerGuildMemberRemoveHandler(client);
  registerInteractionHandler(client);

  client.on("error", (err) => logger.error("CLIENT", "Client error", err));
  process.on("unhandledRejection", (err) => logger.error("UNHANDLED", "Unhandled rejection", err));

  const shutdown = async (signal: string) => {
    logger.info("SHUTDOWN", `Received ${signal}, disconnecting...`);
    await prisma.$disconnect().catch(() => undefined);
    client.destroy();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await client.login(env.discordToken);
}

main().catch((err) => {
  logger.error("STARTUP", "Fatal startup error", err);
  process.exit(1);
});
