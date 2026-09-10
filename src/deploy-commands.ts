import "dotenv/config";
import { REST, Routes } from "discord.js";
import { closeData } from "./commands/close.js";
import { configData } from "./commands/config.js";
import { dailyData } from "./commands/daily.js";
import { roomData } from "./commands/room.js";
import { setupData } from "./commands/setup.js";

const token: string | undefined = process.env["DISCORD_TOKEN"];
const clientId: string | undefined = process.env["CLIENT_ID"];
const guildId: string | undefined = process.env["GUILD_ID"];

if (!token || !clientId) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID. See .env.example.");
  process.exit(1);
}

const authToken: string = token;
const appId: string = clientId;

const body = [setupData.toJSON(), configData.toJSON(), roomData.toJSON(), closeData.toJSON(), dailyData.toJSON()];
const rest = new REST({ version: "10" }).setToken(authToken);

async function main(): Promise<void> {
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(appId, guildId), { body });
    console.log(`[DEPLOY] Registered ${body.length} guild commands for ${guildId}.`);
  } else {
    await rest.put(Routes.applicationCommands(appId), { body });
    console.log(`[DEPLOY] Registered ${body.length} global commands (may take up to 1h to propagate).`);
  }
}

main().catch((err) => {
  console.error("[DEPLOY] Failed:", err);
  process.exitCode = 1;
});
