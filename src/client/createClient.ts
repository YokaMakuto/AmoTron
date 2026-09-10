import { Client, GatewayIntentBits, Partials } from "discord.js";

export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers, // privileged: must be enabled in portal
      GatewayIntentBits.GuildMessages,
    ],
    partials: [Partials.GuildMember, Partials.Channel],
  });
}
